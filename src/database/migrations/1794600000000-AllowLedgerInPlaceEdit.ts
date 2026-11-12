import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fleet revisions section 5, D99: staff can correct a ledger entry in place, because the client wants an edit to change the
 * entry itself, not to add a reversal and a second entry (Abulkalam, 2026-11-12; this replaces the reversal-plus-new-entry
 * edit of D94).
 *
 * The append-only trigger stays, narrowed instead of removed:
 * - DELETE is still refused, always.
 * - UPDATE is refused unless BOTH hold: only `amount_cents`, `effective_date`, `description` or `internal_note` change
 *   (every other column, such as the driver, direction, kind, payment, reversal link and key, must stay exactly as it was),
 *   AND the transaction has switched the edit on with `SELECT set_config('app.ledger_edit', 'on', true)`. Only
 *   `LedgerService.edit` does that, in the same transaction that writes the audit line with the old and new values. A stray
 *   UPDATE from anywhere else (a script, a console, a bug) is still refused.
 *
 * Without a trace in the ledger, the audit log (D95) is the history of an edit: who, when, and the old and new values.
 */
export class AllowLedgerInPlaceEdit1794600000000 implements MigrationInterface {
  name = "AllowLedgerInPlaceEdit1794600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "ledger_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'UPDATE' AND current_setting('app.ledger_edit', true) = 'on' AND (to_jsonb(NEW) - '{amount_cents,effective_date,description,internal_note}'::text[]) = (to_jsonb(OLD) - '{amount_cents,effective_date,description,internal_note}'::text[]) THEN RETURN NEW; END IF; RAISE EXCEPTION 'ledger_entries is append-only: % refused (staff edit an entry through the ledger edit, anything else is a reversal entry)', TG_OP USING ERRCODE = 'restrict_violation'; END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "ledger_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger_entries is append-only: % refused (use a reversal entry)', TG_OP USING ERRCODE = 'restrict_violation'; END $$`,
    );
  }
}
