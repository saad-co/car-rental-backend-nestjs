import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  RemindersService,
  type RemindersSummary,
} from "./reminders.service.js";

/** Key of the Postgres advisory lock that lets only one run work at a time. Any fixed number works. */
const LOCK_KEY = 7_302_005;

/**
 * Runs the payment reminders every 15 minutes (Fleet revisions section 6). Like the other jobs it takes a Postgres
 * advisory lock, so two runs (a slow one and the next tick, or two servers) never overlap. The run does nothing unless an
 * admin turned the reminders on in Settings, and follows SMS_MODE.
 */
@Injectable()
export class RemindersJob {
  private readonly logger = new Logger(RemindersJob.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reminders: RemindersService,
  ) {}

  /** `waitForCompletion`: a tick never starts while the previous one still runs. */
  @Cron("0 */15 * * * *", {
    name: "payment-reminders",
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (result && result.skipped === null) {
        if (result.sent + result.composed + result.failed + result.errors > 0) {
          this.logger.log(
            `Reminders: ${result.checked} drivers checked, ${result.sent} sent, ${result.composed} composed (dry run), ${result.failed} refused, ${result.errors} errors`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Reminders run failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** One run at `now`. Returns null when another run holds the lock. */
  async run(now: Date = new Date()): Promise<RemindersSummary | null> {
    // An advisory lock belongs to one database connection, so take, use and release it on the same one.
    const lockConnection = this.dataSource.createQueryRunner();
    await lockConnection.connect();
    try {
      const [{ locked }] = (await lockConnection.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [LOCK_KEY],
      )) as [{ locked: boolean }];
      if (!locked) return null;
      try {
        return await this.reminders.run(now);
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      await lockConnection.release();
    }
  }
}
