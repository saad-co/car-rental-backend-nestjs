import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  EMAIL_INTAKE_STATUS_ID,
  EmailIntakeOutcome,
} from "./email-intake-status.entity.js";

/** Longest error text kept: enough to read the cause, short enough that a stack-like message never fills the card. */
const MAX_ERROR_LENGTH = 500;

/**
 * Remembers how the latest mailbox run ended (D88), in the one-row `email_intake_status` table, so the dashboard can
 * show "last run ok" or "failed: reason". The scheduler calls `record` after every run.
 */
@Injectable()
export class EmailIntakeStatusService {
  private readonly logger = new Logger(EmailIntakeStatusService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Writes the outcome of the run that just ended: an `ok` run (with how many emails it stored), a `failed` one (with
   * the error) or `off`. Creates the row on the first run, overwrites it afterwards (an upsert: Mongo's
   * `updateOne(..., { upsert: true })`). `last_success_at` moves only on `ok`, so it survives later failures.
   *
   * Never throws: the status is a report about the run, so a problem writing it is logged in full but must not stop
   * the payment matching that follows the run.
   */
  async record(
    outcome: EmailIntakeOutcome,
    details: { stored?: number; error?: unknown } = {},
  ): Promise<void> {
    const ok = outcome === EmailIntakeOutcome.ok;
    const error =
      outcome === EmailIntakeOutcome.failed
        ? describeError(details.error)
        : null;
    try {
      await this.db.query(
        `INSERT INTO email_intake_status (id, last_run_at, last_outcome, last_stored, last_success_at, last_error)
         VALUES ($1, now(), $2::email_intake_outcome, $3, CASE WHEN $4::boolean THEN now() END, $5)
         ON CONFLICT (id) DO UPDATE SET
           last_run_at = EXCLUDED.last_run_at,
           last_outcome = EXCLUDED.last_outcome,
           last_stored = EXCLUDED.last_stored,
           last_success_at = COALESCE(EXCLUDED.last_success_at, email_intake_status.last_success_at),
           last_error = EXCLUDED.last_error`,
        [
          EMAIL_INTAKE_STATUS_ID,
          outcome,
          ok ? (details.stored ?? 0) : 0,
          ok,
          error,
        ],
      );
    } catch (writeError) {
      this.logger.error(
        `Could not record the email intake status (${outcome}): ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        writeError instanceof Error ? writeError.stack : undefined,
      );
    }
  }
}

/** The error as a short, non-empty line for the card (the cause is appended: "Connection failed: ECONNRESET"). */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  for (
    let current: unknown = error;
    current !== undefined && current !== null && parts.length < 3;
    current = current instanceof Error ? current.cause : undefined
  ) {
    const text =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : (JSON.stringify(current) ?? "");
    if (text.trim() !== "" && !parts.includes(text)) parts.push(text.trim());
  }
  const text = parts.join(": ") || "Unknown error";
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : text;
}
