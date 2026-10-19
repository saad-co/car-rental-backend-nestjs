import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Message templates become a list (B81, D62): many templates per kind, picked by name when sending. The one row each
 * kind has today (possibly already edited by the client on staging) is kept and named "Default".
 *
 * Edited after generation: the generated SQL dropped the `key` column and added NOT NULL columns, which loses the
 * existing texts or fails on existing rows. Here `key` is renamed to `kind` and the new columns get a value first.
 * `down` keeps only the oldest template of each kind (the old table could not hold more), then restores `key`.
 */
export class MessageTemplatesList1792393354622 implements MigrationInterface {
  name = "MessageTemplatesList1792393354622";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP CONSTRAINT "PK_08578117c79ed6c5c7f5f96588f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" RENAME COLUMN "key" TO "kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD "id" uuid NOT NULL DEFAULT gen_random_uuid()`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD CONSTRAINT "PK_9ac2bd9635be662d183f314947d" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD "name" character varying(60) NOT NULL DEFAULT 'Default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "name" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_name" UNIQUE ("kind", "name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "message_templates" t USING "message_templates" o WHERE o."kind" = t."kind" AND (o."created_at", o."id") < (t."created_at", t."id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_kind_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP COLUMN "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP COLUMN "name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP CONSTRAINT "PK_9ac2bd9635be662d183f314947d"`,
    );
    await queryRunner.query(`ALTER TABLE "message_templates" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "message_templates" RENAME COLUMN "kind" TO "key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD CONSTRAINT "PK_08578117c79ed6c5c7f5f96588f" PRIMARY KEY ("key")`,
    );
  }
}
