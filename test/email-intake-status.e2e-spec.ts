import "reflect-metadata";
import type { DataSource } from "typeorm";
import { DashboardService } from "../src/dashboard/dashboard.service.js";
import { EmailIntakeOutcome } from "../src/email-intake/email-intake-status.entity.js";
import { EmailIntakeStatusService } from "../src/email-intake/email-intake-status.service.js";
import { EmailIntakeScheduler } from "../src/email-intake/email-intake.scheduler.js";
import type {
  EmailIntakeService,
  SyncResult,
} from "../src/email-intake/email-intake.service.js";
import type { MatchingService } from "../src/matching/matching.service.js";
import type { SmsService } from "../src/sms/sms.service.js";
import { openTestDatabase } from "./test-database.js";

interface Row {
  last_outcome: string;
  last_stored: number;
  last_success_at: Date | null;
  last_error: string | null;
  last_run_at: Date;
}

describe("Email intake status: the scheduler records every run (D88, test database)", () => {
  let db: DataSource;
  let status: EmailIntakeStatusService;
  let scheduler: EmailIntakeScheduler;
  /** What the fake mailbox does on the next run. */
  let next: () => Promise<SyncResult>;
  let matchCalls: number;

  beforeAll(async () => {
    db = await openTestDatabase();
    status = new EmailIntakeStatusService(db);
    const intake = {
      syncNewMessages: () => next(),
    } as unknown as EmailIntakeService;
    const matching = {
      matchPending: () => {
        matchCalls++;
        return Promise.resolve({ assigned: 0, review: 0 });
      },
    } as unknown as MatchingService;
    scheduler = new EmailIntakeScheduler(intake, matching, status);
  });

  beforeEach(async () => {
    await db.query("TRUNCATE email_intake_status");
    matchCalls = 0;
  });

  afterAll(async () => {
    await db.destroy();
  });

  const rows = () =>
    db.query("SELECT * FROM email_intake_status") as Promise<Row[]>;

  it("writes nothing until a run has ended, then creates the row", async () => {
    expect(await rows()).toEqual([]);
    next = () => Promise.resolve({ ran: true, stored: 3 });
    await scheduler.tick();
    const [row] = await rows();
    expect(row.last_outcome).toBe("ok");
    expect(row.last_stored).toBe(3);
    expect(row.last_error).toBeNull();
    expect(row.last_success_at).not.toBeNull();
    expect(matchCalls).toBe(1);
  });

  it("keeps one row and overwrites it every run", async () => {
    next = () => Promise.resolve({ ran: true, stored: 3 });
    await scheduler.tick();
    next = () => Promise.resolve({ ran: true, stored: 0 });
    await scheduler.tick();
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].last_stored).toBe(0);
  });

  it("records a failed run with its reason, keeps the last success, and still matches payments", async () => {
    next = () => Promise.resolve({ ran: true, stored: 2 });
    await scheduler.tick();
    const [good] = await rows();

    next = () =>
      Promise.reject(
        new Error("IMAP login failed", {
          cause: new Error("Invalid credentials"),
        }),
      );
    await scheduler.tick(); // does not throw: the failure is recorded, not raised
    const [bad] = await rows();
    expect(bad.last_outcome).toBe("failed");
    expect(bad.last_error).toBe("IMAP login failed: Invalid credentials");
    expect(bad.last_stored).toBe(0);
    expect(bad.last_success_at).toEqual(good.last_success_at); // "it worked until then" survives
    expect(matchCalls).toBe(2); // matching runs after a failed read too (D48)
  });

  it("clears the error when the next run works", async () => {
    next = () => Promise.reject(new Error("boom"));
    await scheduler.tick();
    next = () => Promise.resolve({ ran: true, stored: 1 });
    await scheduler.tick();
    const [row] = await rows();
    expect(row.last_outcome).toBe("ok");
    expect(row.last_error).toBeNull();
    expect(row.last_success_at).not.toBeNull();
  });

  it("records 'off' when intake is switched off, and does not match", async () => {
    next = () =>
      Promise.resolve({ ran: false, reason: "email intake is switched off" });
    await scheduler.tick();
    const [row] = await rows();
    expect(row.last_outcome).toBe("off");
    expect(row.last_success_at).toBeNull();
    expect(matchCalls).toBe(0);
  });

  it("records nothing when another run still holds the lock", async () => {
    next = () =>
      Promise.resolve({ ran: false, reason: "another run is still working" });
    await scheduler.tick();
    expect(await rows()).toEqual([]);
  });

  it("never throws when the status itself cannot be written", async () => {
    const broken = new EmailIntakeStatusService({
      query: () => Promise.reject(new Error("database is down")),
    } as unknown as DataSource);
    await expect(
      broken.record(EmailIntakeOutcome.failed, { error: new Error("x") }),
    ).resolves.toBeUndefined();
  });

  it("is protected by the database: one row, and an error only on a failed run", async () => {
    const insert = (id: number, outcome: string, error: string | null) =>
      db.query(
        `INSERT INTO email_intake_status (id, last_run_at, last_outcome, last_error)
         VALUES ($1, now(), $2, $3)`,
        [id, outcome, error],
      );
    await expect(insert(2, "ok", null)).rejects.toThrow(
      /email_intake_status_single_row/,
    );
    await expect(insert(1, "ok", "stale")).rejects.toThrow(
      /email_intake_status_error_shape/,
    );
    await expect(insert(1, "failed", null)).rejects.toThrow(
      /email_intake_status_error_shape/,
    );
    await expect(insert(1, "off", null)).resolves.toBeDefined();
  });

  it("shows up on the dashboard", async () => {
    const dashboard = new DashboardService(db, {
      status: () => ({
        mode: "off",
        quoConfigured: false,
        filesConfigured: false,
      }),
    } as unknown as SmsService);
    expect((await dashboard.get()).intake.lastRun).toBeNull();

    next = () => Promise.resolve({ ran: true, stored: 4 });
    await scheduler.tick();
    next = () => Promise.reject(new Error("Gmail refused the password"));
    await scheduler.tick();
    const { intake } = await dashboard.get();
    expect(intake.lastRun).toMatchObject({
      outcome: "failed",
      stored: 0,
      error: "Gmail refused the password",
    });
    expect(intake.lastRun?.lastSuccessAt).toBeInstanceOf(Date);
    expect(intake.lastRun?.at).toBeInstanceOf(Date);
  });
});
