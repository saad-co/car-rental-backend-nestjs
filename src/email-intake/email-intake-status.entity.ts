import { Check, Column, Entity, PrimaryColumn } from "typeorm";

/** How the last mailbox run ended. */
export enum EmailIntakeOutcome {
  /** The run finished (it may have found no new mail). */
  ok = "ok",
  /** The run stopped with an error; the next run retries from the same email. */
  failed = "failed",
  /** Intake is switched off in the settings, so nothing was read. */
  off = "off",
}

/** The only id the table accepts: there is exactly one status row. */
export const EMAIL_INTAKE_STATUS_ID = 1;

/**
 * How the mailbox reading is doing, for the admin dashboard (D88): the outcome of the latest run and when a run last
 * worked. Maps to the `email_intake_status` table, which holds **one row** (id = 1) that every run overwrites. A history
 * of runs was not asked for, and one row can never grow.
 *
 * Why it exists: before this, a mailbox that could not be read (an expired Google password, say) was only a log line,
 * and spec 5.1 says that must be a visible failure. Unlike `InboundEmail`, this row is meant to be updated.
 */
@Entity("email_intake_status")
// Exactly one row: a second id is refused by the database, so "the status" is never ambiguous.
@Check("email_intake_status_single_row", `"id" = ${EMAIL_INTAKE_STATUS_ID}`)
// The error text exists exactly when the last run failed, so a stale error can never sit next to an "ok".
@Check(
  "email_intake_status_error_shape",
  `("last_outcome" = 'failed') = ("last_error" IS NOT NULL)`,
)
@Check("email_intake_status_stored_range", `"last_stored" >= 0`)
export class EmailIntakeStatus {
  @PrimaryColumn({ type: "smallint" })
  id: number;

  /** When the latest run ended. */
  @Column({ name: "last_run_at", type: "timestamptz" })
  lastRunAt: Date;

  @Column({
    name: "last_outcome",
    type: "enum",
    enum: EmailIntakeOutcome,
    enumName: "email_intake_outcome",
  })
  lastOutcome: EmailIntakeOutcome;

  /** Emails the latest run stored (0 when it failed or was off). */
  @Column({ name: "last_stored", type: "integer", default: 0 })
  lastStored: number;

  /** When a run last finished with `ok`; kept through later failures, so the card can say "worked until ...". Null: never. */
  @Column({ name: "last_success_at", type: "timestamptz", nullable: true })
  lastSuccessAt: Date | null;

  /** Why the latest run failed. Set only when `lastOutcome` is `failed`. */
  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;
}
