import { MigrationInterface, QueryRunner } from "typeorm";

/** Fleet revisions section 5: internal notes about a driver's account (`driver_notes`), the same shape as application notes. */
export class CreateDriverNotes1794500400000 implements MigrationInterface {
  name = "CreateDriverNotes1794500400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "driver_notes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "driver_id" uuid NOT NULL, "author_id" uuid, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "driver_notes_body_length" CHECK (length(btrim("body")) BETWEEN 1 AND 2000), CONSTRAINT "PK_driver_notes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_notes_driver_created_idx" ON "driver_notes" ("driver_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_notes" ADD CONSTRAINT "FK_driver_notes_driver" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_notes" ADD CONSTRAINT "FK_driver_notes_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "driver_notes"`);
  }
}
