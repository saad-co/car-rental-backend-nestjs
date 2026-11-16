import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Module 3 (D102), step 1: vehicle check-in / check-out inspections.
 * - `inspections`, `inspection_photos`, `inspection_events`, and `inspection_shots` seeded with the 19 required shots;
 * - the sequence behind the reference number (`INS-2026-000123`);
 * - `drivers.preferred_language` (`en` / `es`, English for every existing driver).
 * Nothing existing is changed except that one new column with a default.
 */
export class CreateInspections1794800000000 implements MigrationInterface {
  name = "CreateInspections1794800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."driver_language" AS ENUM('en', 'es')`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "preferred_language" "public"."driver_language" NOT NULL DEFAULT 'en'`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."inspection_type" AS ENUM('check_in', 'check_out')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inspection_status" AS ENUM('created', 'link_sent', 'opened', 'in_progress', 'submitted', 'reviewed', 'flagged', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inspection_fuel_level" AS ENUM('empty', '1_8', '1_4', '3_8', '1_2', '5_8', '3_4', '7_8', 'full')`,
    );
    // The number counter for the reference. A sequence hands out each number once, even to two requests at the same moment.
    await queryRunner.query(`CREATE SEQUENCE "inspection_reference_seq"`);

    await queryRunner.query(
      `CREATE TABLE "inspections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "reference" character varying(20) NOT NULL, "type" "public"."inspection_type" NOT NULL, "status" "public"."inspection_status" NOT NULL DEFAULT 'created', "driver_id" uuid NOT NULL, "contract_id" uuid, "vehicle_model" character varying(200) NOT NULL, "vehicle_vin" character varying(50), "vehicle_plate" character varying(20), "paired_inspection_id" uuid, "token_hash" character varying(64) NOT NULL, "token_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "link_sent_at" TIMESTAMP WITH TIME ZONE, "opened_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "submitted_at" TIMESTAMP WITH TIME ZONE, "odometer_miles" integer, "fuel_level" "public"."inspection_fuel_level", "gps_lat" double precision, "gps_lng" double precision, "device_info" character varying(500), "attested_at" TIMESTAMP WITH TIME ZONE, "reviewed_by_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "review_notes" text, "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "inspections_odometer_not_negative" CHECK ("odometer_miles" >= 0), CONSTRAINT "inspections_submitted_shape" CHECK (("status" IN ('submitted', 'reviewed', 'flagged')) = ("submitted_at" IS NOT NULL) AND ("status" NOT IN ('submitted', 'reviewed', 'flagged') OR ("attested_at" IS NOT NULL AND "odometer_miles" IS NOT NULL AND "fuel_level" IS NOT NULL))), CONSTRAINT "PK_inspections" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspections_token_hash_unique" ON "inspections" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspections_reference_unique" ON "inspections" ("reference")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspections_one_open_per_type" ON "inspections" ("driver_id", "type") WHERE "status" IN ('created', 'link_sent', 'opened', 'in_progress')`,
    );
    await queryRunner.query(
      `CREATE INDEX "inspections_driver_created_idx" ON "inspections" ("driver_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "FK_inspections_driver" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "FK_inspections_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "FK_inspections_paired" FOREIGN KEY ("paired_inspection_id") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "FK_inspections_reviewed_by" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "FK_inspections_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "inspection_shots" ("shot_id" character varying(40) NOT NULL, "position" smallint NOT NULL, "title" character varying(100) NOT NULL, "instruction" text NOT NULL, "overlay_image" character varying(200), "required" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_inspection_shots" PRIMARY KEY ("shot_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspection_shots_position_unique" ON "inspection_shots" ("position")`,
    );
    // The 19 shots, in walk-around order (spec section 5); English words from the client's translation file.
    await queryRunner.query(
      `INSERT INTO "inspection_shots" ("shot_id", "position", "title", "instruction") VALUES
       ('EXT_DRIVER_SIDE', 1, 'Driver side, full', 'Stand back so the whole driver side fits, front bumper to rear bumper.'),
       ('EXT_LEFT_FRONT_CORNER', 2, 'Left front corner', 'Stand at an angle to the front-left corner. Show the bumper, headlight and fender.'),
       ('TIRE_FRONT_LEFT', 3, 'Front left tire and tread', 'Turn the wheel if needed. Show the tread surface and the rim.'),
       ('EXT_FRONT', 4, 'Front', 'Face the car straight on. Show the whole front bumper, grille, hood and plate.'),
       ('EXT_WINDSHIELD', 5, 'Windshield', 'Fit the whole windshield in the photo. Get close enough to show any chips or cracks.'),
       ('EXT_RIGHT_FRONT_CORNER', 6, 'Right front corner', 'Stand at an angle to the front-right corner. Show the bumper, headlight and fender.'),
       ('TIRE_FRONT_RIGHT', 7, 'Front right tire and tread', 'Show the tread surface and the rim.'),
       ('EXT_PASSENGER_SIDE', 8, 'Passenger side, full', 'Stand back so the whole passenger side fits, front bumper to rear bumper.'),
       ('EXT_RIGHT_REAR_CORNER', 9, 'Rear right corner', 'Stand at an angle to the rear-right corner. Show the bumper, taillight and side panel.'),
       ('TIRE_REAR_RIGHT', 10, 'Rear right tire and tread', 'Show the tread surface and the rim.'),
       ('EXT_REAR', 11, 'Rear', 'Face the back of the car straight on. Show the whole rear bumper, trunk lid and plate.'),
       ('TRUNK_INTERIOR', 12, 'Trunk / cargo area', 'Open the trunk. Show the whole cargo area and floor.'),
       ('TRUNK_SPARE_JACK', 13, 'Spare tire and jack', 'Lift the trunk floor. Show both the spare tire and the jack.'),
       ('EXT_LEFT_REAR_CORNER', 14, 'Rear left corner', 'Stand at an angle to the rear-left corner. Show the bumper, taillight and side panel.'),
       ('TIRE_REAR_LEFT', 15, 'Rear left tire and tread', 'Show the tread surface and the rim.'),
       ('INT_ODOMETER', 16, 'Mileage (odometer)', 'Turn the car on. Make sure the mileage numbers are clear and readable.'),
       ('INT_FUEL', 17, 'Fuel level', 'Make sure the fuel gauge is clear and readable.'),
       ('INT_FRONT_SEATS', 18, 'Front seats', 'From the open driver door or the back seat, show both front seats and the dashboard.'),
       ('INT_REAR_SEATS', 19, 'Rear seats', 'From an open rear door, show the whole back seat and floor.')`,
    );

    await queryRunner.query(
      `CREATE TABLE "inspection_photos" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "inspection_id" uuid NOT NULL, "shot_id" character varying(40) NOT NULL, "position" smallint NOT NULL DEFAULT '1', "storage_key" character varying(300) NOT NULL, "thumb_key" character varying(300) NOT NULL, "captured_at" TIMESTAMP WITH TIME ZONE, "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "driver_note" character varying(200), "sha256" character varying(64) NOT NULL, "retake_count" integer NOT NULL DEFAULT '0', "ai_analysis" jsonb, CONSTRAINT "inspection_photos_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$'), CONSTRAINT "inspection_photos_position_range" CHECK ("position" BETWEEN 1 AND 15 AND ("shot_id" = 'DAMAGE' OR "position" = 1)), CONSTRAINT "PK_inspection_photos" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspection_photos_slot_unique" ON "inspection_photos" ("inspection_id", "shot_id", "position")`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" ADD CONSTRAINT "FK_inspection_photos_inspection" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "inspection_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "inspection_id" uuid NOT NULL, "type" character varying(40) NOT NULL, "actor_id" uuid, "meta" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_inspection_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "inspection_events_inspection_created_idx" ON "inspection_events" ("inspection_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_events" ADD CONSTRAINT "FK_inspection_events_inspection" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_events" ADD CONSTRAINT "FK_inspection_events_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inspection_events"`);
    await queryRunner.query(`DROP TABLE "inspection_photos"`);
    await queryRunner.query(`DROP TABLE "inspection_shots"`);
    await queryRunner.query(`DROP TABLE "inspections"`);
    await queryRunner.query(`DROP SEQUENCE "inspection_reference_seq"`);
    await queryRunner.query(`DROP TYPE "public"."inspection_fuel_level"`);
    await queryRunner.query(`DROP TYPE "public"."inspection_status"`);
    await queryRunner.query(`DROP TYPE "public"."inspection_type"`);
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "preferred_language"`,
    );
    await queryRunner.query(`DROP TYPE "public"."driver_language"`);
  }
}
