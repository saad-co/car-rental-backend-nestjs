import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D100: a daily or weekly rent set by hand for a driver with no signed contract (`driver_recurring_charges`), and the view
 * `billable_contracts` that lists the signed contracts and these charges in one shape. The rent job, the dashboard, daily
 * operations and the reminders read the view, so they cannot disagree about who is billed what.
 */
export class CreateDriverRecurringCharges1794700000000 implements MigrationInterface {
  name = "CreateDriverRecurringCharges1794700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "driver_recurring_charges" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "driver_id" uuid NOT NULL, "schedule" "public"."contract_schedule" NOT NULL, "amount_cents" integer NOT NULL, "first_due_date" date NOT NULL, "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "driver_recurring_charges_amount_positive" CHECK ("amount_cents" > 0), CONSTRAINT "PK_driver_recurring_charges" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_recurring_charges_driver_first_due" ON "driver_recurring_charges" ("driver_id", "first_due_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_recurring_charges" ADD CONSTRAINT "FK_driver_recurring_charges_driver" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_recurring_charges" ADD CONSTRAINT "FK_driver_recurring_charges_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Signed contracts as they were read before (status 'signed'), then the charges set by hand. A signed contract's first
    // rent is posted at signing (bills_start_date false); a charge set by hand has nobody to post it, so the job does (true).
    await queryRunner.query(
      `CREATE VIEW "billable_contracts" AS
       SELECT c.driver_id, c.schedule, c.total_rate_cents, c.start_date, c.signed_at,
              c.vehicle_model, c.vehicle_plate, c.security_deposit_cents, false AS bills_start_date
       FROM contracts c
       WHERE c.status = 'signed'
       UNION ALL
       SELECT r.driver_id, r.schedule, r.amount_cents, r.first_due_date, r.created_at,
              NULL::varchar, NULL::varchar, 0, true
       FROM driver_recurring_charges r`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW "billable_contracts"`);
    await queryRunner.query(`DROP TABLE "driver_recurring_charges"`);
  }
}
