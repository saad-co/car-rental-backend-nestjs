import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePaymentAliases1791812600004 implements MigrationInterface {
  name = "CreatePaymentAliases1791812600004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."alias_type" AS ENUM('zelle', 'cashapp', 'venmo', 'chime', 'stripe', 'email', 'phone')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."alias_source" AS ENUM('legacy', 'manual', 'ai_match')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_aliases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "driver_id" uuid NOT NULL, "type" "public"."alias_type" NOT NULL, "value" character varying(255) NOT NULL, "value_normalized" character varying(255) NOT NULL, "source" "public"."alias_source" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "payment_aliases_type_value_key" UNIQUE ("type", "value_normalized"), CONSTRAINT "PK_ebb4bfd2858b34e3da6b4c2ce1d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "payment_aliases_driver_idx" ON "payment_aliases"  ("driver_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_aliases" ADD CONSTRAINT "FK_17a9753c96033d059340944b6d7" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_aliases" DROP CONSTRAINT "FK_17a9753c96033d059340944b6d7"`,
    );
    await queryRunner.query(`DROP INDEX "public"."payment_aliases_driver_idx"`);
    await queryRunner.query(`DROP TABLE "payment_aliases"`);
    await queryRunner.query(`DROP TYPE "public"."alias_source"`);
    await queryRunner.query(`DROP TYPE "public"."alias_type"`);
  }
}
