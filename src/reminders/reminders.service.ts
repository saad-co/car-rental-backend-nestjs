import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { addDays, chicagoDate } from "../common/chicago-date.js";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import { rentSchedule } from "../contracts/contract-ledger.js";
import { ContractSchedule } from "../contracts/contract.entity.js";
import {
  DailyOperationsService,
  type DriverFigures,
} from "../dashboard/daily-ops.service.js";
import { DriverStatus } from "../drivers/driver.entity.js";
import { TemplateKind } from "../message-templates/message-template.entity.js";
import { MessageTemplatesService } from "../message-templates/message-templates.service.js";
import {
  SettingsService,
  type ReminderSettings,
} from "../settings/settings.service.js";
import { SmsMode } from "../sms/sms-message.entity.js";
import { describeQuoFailure } from "../sms/quo/quo-failure-message.js";
import { SmsService } from "../sms/sms.service.js";
import { ReminderLogDto, ReminderLogListDto } from "./dto/reminder.dto.js";
import { ReminderStatus } from "./reminder-log.entity.js";
import {
  nextReminder,
  ReminderKind,
  type DueReminder,
  type ReminderFacts,
  type UpcomingDue,
} from "./reminder-rules.js";

/** Which template each kind of reminder is written from (editable in Settings, D58/D62). */
const TEMPLATE_OF: Record<ReminderKind, TemplateKind> = {
  [ReminderKind.upcoming]: TemplateKind.reminder_upcoming,
  [ReminderKind.late]: TemplateKind.reminder_late,
  [ReminderKind.high_balance]: TemplateKind.reminder_high_balance,
  [ReminderKind.balance]: TemplateKind.reminder_balance,
  [ReminderKind.payment_received]: TemplateKind.reminder_payment_received,
};

/** A failed send is tried again after this long, and given up after this many failures: Quo is not hammered. */
const RETRY_AFTER_MS = 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
/** The confirmation after a payment looks at payments credited in the last day (and since the switch was turned on). */
const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Reminder keys older than this can no longer matter. */
const KEY_HORIZON_MS = 200 * 24 * 60 * 60 * 1000;

/** What one run did, for the log and the tests. */
export interface RemindersSummary {
  /** Why nothing was done (switched off, texting off); null when the run went through the drivers. */
  skipped: string | null;
  checked: number;
  /** Texts really sent (live). */
  sent: number;
  /** Texts only composed and saved (dry run). */
  composed: number;
  /** Sends Quo refused: recorded on the driver's page. */
  failed: number;
  /** Drivers whose processing broke: logged with the driver id, tried again next run. */
  errors: number;
}

/**
 * The payment reminders (Fleet revisions section 6, the original M6): works out, for every active driver, which text is due
 * now (`nextReminder`, the pure rules) and sends it, once.
 *
 * Safety, in the order a text meets it: the switch in Settings (off by default) and SMS_MODE (`off` composes nothing,
 * `dry_run` composes and saves, `live` sends); only active, not archived, not-in-collections drivers who have not texted
 * STOP; the driver's late and balance figures are worked out again right before the send, so a driver who paid a moment
 * ago is not texted; one text per driver per Chicago day; and a unique key per reminder, so a retry or a second run can
 * never send the same one twice. Every attempt, a failure included, is written to `reminder_logs` for the driver's page.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ops: DailyOperationsService,
    private readonly sms: SmsService,
    private readonly templates: MessageTemplatesService,
    private readonly settings: SettingsService,
  ) {}

  /** One run at `now`. The caller holds the advisory lock (`RemindersJob`). */
  async run(now: Date = new Date()): Promise<RemindersSummary> {
    const summary: RemindersSummary = {
      skipped: null,
      checked: 0,
      sent: 0,
      composed: 0,
      failed: 0,
      errors: 0,
    };
    const settings = await this.settings.reminders();
    if (!settings.enabled) return { ...summary, skipped: "switched off" };
    const mode = this.sms.status().mode;
    if (mode === "off") {
      return { ...summary, skipped: "texting is off (SMS_MODE=off)" };
    }

    const figures = (await this.ops.driverFigures(now)).filter(
      (f) => f.driver.status === DriverStatus.active,
    );
    for (const driver of figures) {
      summary.checked++;
      try {
        const status = await this.handleDriver(driver, now, mode, settings);
        if (status === ReminderStatus.sent) summary.sent++;
        else if (status === ReminderStatus.composed) summary.composed++;
        else if (status === ReminderStatus.failed) summary.failed++;
      } catch (error) {
        // One driver's failure never stops the others; it is logged with the driver id and tried again next run.
        summary.errors++;
        this.logger.error(
          `Reminder for driver ${driver.driver.id} could not be processed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return summary;
  }

  /** One page of a driver's reminders, newest first. @throws NotFoundException unknown driver. */
  async listForDriver(
    driverId: string,
    query: PaginationQueryDto,
  ): Promise<ReminderLogListDto> {
    const exists: unknown[] = await this.db.query(
      `SELECT 1 FROM drivers WHERE id = $1`,
      [driverId],
    );
    if (exists.length === 0) throw new NotFoundException("Driver not found.");
    const rows = (await this.db.query(
      `SELECT id, kind, tier, mode, status, error, body, past_due_cents AS "pastDueCents",
              balance_cents AS "balanceCents", created_at AS "createdAt"
       FROM reminder_logs WHERE driver_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [driverId, query.limit, (query.page - 1) * query.limit],
    )) as ReminderLogDto[];
    const [{ total }] = (await this.db.query(
      `SELECT count(*)::int AS total FROM reminder_logs WHERE driver_id = $1`,
      [driverId],
    )) as [{ total: number }];
    return { items: rows, total, page: query.page, limit: query.limit };
  }

  /** @returns the status of the reminder written, or null when none was due. */
  private async handleDriver(
    figures: DriverFigures,
    now: Date,
    mode: "dry_run" | "live",
    settings: ReminderSettings,
  ): Promise<ReminderStatus | null> {
    if (figures.driver.smsOptedOut) return null;
    await this.trackEpisode(figures, now);

    const first = nextReminder(await this.facts(figures, now, mode, settings));
    if (!first) return null;

    // The balance is worked out again, right before the send: a payment recorded since the pass above, or a driver who
    // is archived or opted out a moment ago, must not be texted.
    const [fresh] = await this.ops.driverFigures(now, [figures.driver.id]);
    if (
      !fresh ||
      fresh.driver.status !== DriverStatus.active ||
      fresh.driver.smsOptedOut
    ) {
      return null;
    }
    const facts = await this.facts(fresh, now, mode, settings);
    const due = nextReminder(facts);
    if (!due || due.dedupeKey !== first.dedupeKey) return null;

    if (await this.shouldWaitToRetry(due.dedupeKey, mode, now)) return null;
    return this.send(fresh, due, facts, now, mode, settings);
  }

  /**
   * Keeps `late_episode_started_at` true to the ledger: set when the driver first has a late rent charge, cleared when
   * they have none. "Each threshold sends once" then means once per time the driver falls behind.
   */
  private async trackEpisode(f: DriverFigures, now: Date): Promise<void> {
    const behind = f.lateness.lateCharges.length > 0;
    const started = f.driver.lateEpisodeStartedAt;
    if (behind && started === null) {
      await this.db.query(
        `UPDATE drivers SET late_episode_started_at = $2 WHERE id = $1 AND late_episode_started_at IS NULL`,
        [f.driver.id, now],
      );
      f.driver.lateEpisodeStartedAt = now;
    } else if (!behind && started !== null) {
      await this.db.query(
        `UPDATE drivers SET late_episode_started_at = NULL WHERE id = $1`,
        [f.driver.id],
      );
      f.driver.lateEpisodeStartedAt = null;
    }
  }

  /** Reads what the pure rules need that is not already in `figures`: the reminder log and the payments. */
  private async facts(
    f: DriverFigures,
    now: Date,
    mode: "dry_run" | "live",
    settings: ReminderSettings,
  ): Promise<ReminderFacts> {
    const driverId = f.driver.id;
    const [logs] = (await this.db.query(
      `SELECT
         COALESCE((SELECT array_agg(dedupe_key) FROM reminder_logs
                   WHERE driver_id = $1 AND mode = $2 AND status <> 'failed' AND created_at > $4), '{}') AS keys,
         (SELECT max(created_at) FROM reminder_logs
          WHERE driver_id = $1 AND mode = $2 AND status <> 'failed' AND kind IN ('late', 'high_balance', 'balance')) AS "lastChaseAt",
         EXISTS (SELECT 1 FROM reminder_logs
                 WHERE driver_id = $1 AND mode = $2 AND status <> 'failed'
                   AND (created_at AT TIME ZONE 'America/Chicago')::date = $3::date) AS "textedToday"`,
      [
        driverId,
        mode,
        chicagoDate(now),
        new Date(now.getTime() - KEY_HORIZON_MS),
      ],
    )) as [{ keys: string[]; lastChaseAt: Date | null; textedToday: boolean }];

    const windowStart = new Date(
      Math.max(
        now.getTime() - CONFIRMATION_WINDOW_MS,
        settings.enabledAt?.getTime() ?? 0,
      ),
    );
    const [payments] = (await this.db.query(
      `SELECT
         (SELECT max(e.created_at) FROM ledger_entries e
          WHERE e.driver_id = $1 AND e.kind = 'payment'
            AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = e.id)) AS "lastPaymentAt",
         (SELECT e.id FROM ledger_entries e
          WHERE e.driver_id = $1 AND e.kind = 'payment' AND e.created_at >= $2
            AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = e.id)
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS "latestId",
         (SELECT e.created_at FROM ledger_entries e
          WHERE e.driver_id = $1 AND e.kind = 'payment' AND e.created_at >= $2
            AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = e.id)
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS "latestAt"`,
      [driverId, windowStart],
    )) as [
      {
        lastPaymentAt: Date | null;
        latestId: string | null;
        latestAt: Date | null;
      },
    ];

    return {
      driverId,
      now,
      schedule: f.contract?.schedule ?? null,
      rentDueTime: f.driver.rentDueTime,
      lateCount: f.lateness.lateCharges.length,
      pastDueCents: f.lateness.pastDueCents,
      balanceCents: f.balanceCents,
      episode: f.driver.lateEpisodeStartedAt?.toISOString() ?? null,
      upcomingRemindersEnabled: f.driver.upcomingRemindersEnabled,
      balanceRemindersEnabled: f.driver.balanceRemindersEnabled,
      upcoming: this.upcomingDue(f, now),
      sentKeys: new Set(logs.keys),
      lastChaseAt: logs.lastChaseAt,
      lastPaymentAt: payments.lastPaymentAt,
      textedToday: logs.textedToday,
      latestPayment:
        payments.latestId && payments.latestAt
          ? { entryId: payments.latestId, at: payments.latestAt }
          : null,
    };
  }

  /**
   * A weekly driver's next rent due date in the coming days, from the contract in force: the same schedule the rent job
   * bills from (`rentSchedule`), never before the day billing starts. The reminder goes out before the rent is posted, so
   * the date comes from the contract, not from the ledger.
   */
  private upcomingDue(f: DriverFigures, now: Date): UpcomingDue | null {
    const contract = f.contract;
    const rentFrom = f.driver.rentFrom;
    if (!contract || contract.schedule !== ContractSchedule.weekly) return null;
    if (rentFrom === null) return null;
    const today = chicagoDate(now);
    const from = rentFrom > today ? rentFrom : today;
    const [next] = rentSchedule([contract], from, addDays(today, 3));
    return next
      ? { dueDate: next.effectiveDate, amountCents: next.amountCents }
      : null;
  }

  /** True when this reminder already failed recently or too often: tried again after an hour, given up after 5 failures. */
  private async shouldWaitToRetry(
    dedupeKey: string,
    mode: "dry_run" | "live",
    now: Date,
  ): Promise<boolean> {
    const [{ failures, lastFailedAt }] = (await this.db.query(
      `SELECT count(*)::int AS failures, max(created_at) AS "lastFailedAt"
       FROM reminder_logs WHERE dedupe_key = $1 AND mode = $2 AND status = 'failed'`,
      [dedupeKey, mode],
    )) as [{ failures: number; lastFailedAt: Date | null }];
    if (failures >= MAX_FAILED_ATTEMPTS) return true;
    return (
      lastFailedAt !== null &&
      now.getTime() - lastFailedAt.getTime() < RETRY_AFTER_MS
    );
  }

  /** Composes the text, sends it (or saves it, in a dry run) and records the outcome. */
  private async send(
    f: DriverFigures,
    due: DueReminder,
    facts: ReminderFacts,
    now: Date,
    mode: "dry_run" | "live",
    settings: ReminderSettings,
  ): Promise<ReminderStatus> {
    const body = await this.templates.render(TEMPLATE_OF[due.kind], {
      firstName: f.driver.firstName,
      paymentLink: settings.paymentLink ?? "",
      ...due.values,
    });

    let status: ReminderStatus;
    let error: string | null = null;
    let smsMessageId: string | null = null;
    try {
      const message = await this.sms.sendSystem(f.driver.phone, body);
      smsMessageId = message.id;
      status =
        message.mode === SmsMode.live
          ? ReminderStatus.sent
          : ReminderStatus.composed;
    } catch (caught) {
      // Quo may refuse (no credits, daily cap, bad number): written down for the driver's page, never swallowed.
      status = ReminderStatus.failed;
      error =
        caught instanceof HttpException
          ? caught.message
          : describeQuoFailure(caught);
      this.logger.warn(
        `Reminder ${due.dedupeKey} to driver ${f.driver.id} was not sent: ${error}`,
      );
    }

    await this.db.query(
      `INSERT INTO reminder_logs
         (driver_id, kind, tier, dedupe_key, mode, status, error, body, past_due_cents, balance_cents, sms_message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        f.driver.id,
        due.kind,
        due.tier,
        due.dedupeKey,
        mode,
        status,
        error,
        body,
        facts.pastDueCents,
        facts.balanceCents,
        smsMessageId,
        now,
      ],
    );
    return status;
  }
}
