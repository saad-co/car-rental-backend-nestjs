import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The audit trail (spec section 4; Fleet revisions section 4): `audit_logs`, one line per action with who, when, and the
 * record before and after. Append-only: a trigger refuses any update or delete, like the ledger. The one exception is
 * the `SET NULL` of `actor_id` when an admin account is removed (the line keeps `actor_email`).
 */
export class CreateAuditLogs1794500100000 implements MigrationInterface {
  name = "CreateAuditLogs1794500100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor_id" uuid, "actor_email" character varying(255), "action" character varying(60) NOT NULL, "entity_type" character varying(40) NOT NULL, "entity_id" uuid NOT NULL, "before" jsonb, "after" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" ("entity_type", "entity_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_logs_created_idx" ON "audit_logs" ("created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_logs_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'UPDATE' AND NEW."actor_id" IS NULL AND OLD."actor_id" IS NOT NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN RETURN NEW; END IF; RAISE EXCEPTION 'audit_logs is append-only: % refused', TG_OP USING ERRCODE = 'restrict_violation'; END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "audit_logs_append_only" ON "audit_logs"`,
    );
    await queryRunner.query(`DROP FUNCTION "audit_logs_append_only"()`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
