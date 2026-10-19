import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The quick-pick presets of the "New ledger entry" window (B86, D66). Generated from `LedgerPreset`, then edited by
 * hand: the starting list at the end of `up` is the client's, from their ledger mockup (names, amounts and
 * descriptions), plus "Opening balance" (B80). "Weekly rent" and "Day credit - vehicle down" are left out on purpose:
 * they need the driver's rate and come with rent billing (M2). Admins change the list in Settings.
 */

export class CreateLedgerPresets1792418969036 implements MigrationInterface {
  name = "CreateLedgerPresets1792418969036";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_preset_kind" AS ENUM('charge', 'credit')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_presets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "kind" "public"."ledger_preset_kind" NOT NULL, "name" character varying(60) NOT NULL, "amount_cents" integer, "description" character varying(500) NOT NULL, "position" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_by_id" uuid, CONSTRAINT "ledger_presets_kind_name" UNIQUE ("kind", "name"), CONSTRAINT "ledger_presets_amount_range" CHECK ("amount_cents" IS NULL OR ("amount_cents" >= 1 AND "amount_cents" <= 1000000)), CONSTRAINT "ledger_presets_description_length" CHECK (length(btrim("description")) BETWEEN 1 AND 500), CONSTRAINT "ledger_presets_name_not_blank" CHECK (length(btrim("name")) >= 1), CONSTRAINT "PK_82a858b685eb387fd880d0cc21c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_presets" ADD CONSTRAINT "FK_aa11cae6a46b6ff91488a9d4c27" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // The starting list (see the note at the top): position counts from 1 within each kind.
    await queryRunner.query(
      `INSERT INTO "ledger_presets" ("kind", "name", "amount_cents", "description", "position") VALUES
         ('charge', 'Late fee', 2500, 'Late payment fee', 1),
         ('charge', 'Flat tire', 8500, 'Flat tire repair / replacement', 2),
         ('charge', 'Light bulb', 1500, 'Bulb replacement', 3),
         ('charge', 'Cleaning fee', 7500, 'Interior cleaning', 4),
         ('charge', 'Smoking fee', 15000, 'Smoking / odor remediation', 5),
         ('charge', 'Toll', NULL, 'Toll charge', 6),
         ('charge', 'Ticket / violation', NULL, 'Parking / camera violation', 7),
         ('charge', 'Towing', 15000, 'Tow', 8),
         ('charge', 'Key replacement', 20000, 'Key fob replacement', 9),
         ('charge', 'Damage / deductible', 50000, 'Insurance deductible', 10),
         ('charge', 'Opening balance', NULL, 'Opening balance', 11),
         ('charge', 'Miscellaneous', NULL, 'Miscellaneous charge', 12),
         ('credit', 'Fee waiver', NULL, 'Fee waived', 1),
         ('credit', 'Goodwill credit', NULL, 'Goodwill credit', 2),
         ('credit', 'Referral bonus', 10000, 'Driver referral bonus', 3),
         ('credit', 'Overcharge correction', NULL, 'Billing correction', 4),
         ('credit', 'Opening balance', NULL, 'Opening balance', 5),
         ('credit', 'Miscellaneous', NULL, 'Miscellaneous credit', 6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ledger_presets" DROP CONSTRAINT "FK_aa11cae6a46b6ff91488a9d4c27"`,
    );
    await queryRunner.query(`DROP TABLE "ledger_presets"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_preset_kind"`);
  }
}
