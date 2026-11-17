import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { CreateDriverDto } from "../src/drivers/dto/create-driver.dto.js";
import { UpdateDriverProfileDto } from "../src/drivers/dto/driver-profile.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

/** The 19 required shots in walk-around order (MODULE3_SPEC section 5). */
const SHOTS = [
  "EXT_DRIVER_SIDE",
  "EXT_LEFT_FRONT_CORNER",
  "TIRE_FRONT_LEFT",
  "EXT_FRONT",
  "EXT_WINDSHIELD",
  "EXT_RIGHT_FRONT_CORNER",
  "TIRE_FRONT_RIGHT",
  "EXT_PASSENGER_SIDE",
  "EXT_RIGHT_REAR_CORNER",
  "TIRE_REAR_RIGHT",
  "EXT_REAR",
  "TRUNK_INTERIOR",
  "TRUNK_SPARE_JACK",
  "EXT_LEFT_REAR_CORNER",
  "TIRE_REAR_LEFT",
  "INT_ODOMETER",
  "INT_FUEL",
  "INT_FRONT_SEATS",
  "INT_REAR_SEATS",
];

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("inspection tables and the driver's language (Module 3 step 1, test database)", () => {
  let db: DataSource;
  let driverId: string;
  let tokenCounter = 0;

  /** Inserts one inspection with only what the table needs; `extra` overrides or adds columns. */
  async function insertInspection(
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    tokenCounter += 1;
    const row: Record<string, unknown> = {
      reference: `INS-TEST-${tokenCounter}`,
      type: "check_in",
      driver_id: driverId,
      vehicle_model: "Toyota Camry",
      token_hash: tokenCounter.toString(16).padStart(64, "0"),
      token_expires_at: new Date(Date.now() + 86_400_000),
      ...extra,
    };
    const columns = Object.keys(row);
    const [{ id }] = (await db.query(
      `INSERT INTO inspections (${columns.join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      Object.values(row),
    )) as [{ id: string }];
    return id;
  }

  /** The error text the database gives for this statement, or null if it was accepted. */
  async function refusedWith(
    promise: Promise<unknown>,
  ): Promise<string | null> {
    try {
      await promise;
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  const insertPhoto = (
    inspectionId: string,
    shotId: string,
    position: number,
    sha256 = HASH_A,
  ) =>
    db.query(
      `INSERT INTO inspection_photos (inspection_id, shot_id, position, storage_key, thumb_key, sha256)
       VALUES ($1, $2, $3, 'k', 't', $4)`,
      [inspectionId, shotId, position, sha256],
    );

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE drivers, users CASCADE");
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Pat', 'Driver', 'pat@inspection.test', '+13055550101') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the shot list", () => {
    it("holds the 19 required shots, in walk-around order", async () => {
      const rows = (await db.query(
        `SELECT shot_id, position, required, overlay_image
         FROM inspection_shots ORDER BY position`,
      )) as {
        shot_id: string;
        position: number;
        required: boolean;
        overlay_image: string | null;
      }[];
      expect(rows.map((r) => r.shot_id)).toEqual(SHOTS);
      expect(rows.map((r) => r.position)).toEqual(
        SHOTS.map((_, index) => index + 1),
      );
      expect(rows.every((r) => r.required)).toBe(true);
      // No framing artwork has been supplied (B138).
      expect(rows.every((r) => r.overlay_image === null)).toBe(true);
    });

    it("never gives two shots the same place", async () => {
      expect(
        await refusedWith(
          db.query(
            `INSERT INTO inspection_shots (shot_id, position, title, instruction) VALUES ('EXTRA', 1, 't', 'i')`,
          ),
        ),
      ).toMatch(/inspection_shots_position_unique/);
    });
  });

  describe("one open inspection of each type per driver", () => {
    it("refuses a second open check-in, even when the first was only created", async () => {
      await insertInspection();
      expect(await refusedWith(insertInspection())).toMatch(
        /inspections_one_open_per_type/,
      );
    });

    it("counts created, link_sent, opened and in_progress as open", async () => {
      for (const status of ["link_sent", "opened", "in_progress"]) {
        await db.query("TRUNCATE inspections CASCADE");
        await insertInspection({ status });
        expect(await refusedWith(insertInspection())).toMatch(
          /inspections_one_open_per_type/,
        );
      }
    });

    it("allows a check-out next to an open check-in", async () => {
      await insertInspection();
      expect(
        await refusedWith(insertInspection({ type: "check_out" })),
      ).toBeNull();
    });

    it("allows another driver their own check-in", async () => {
      await insertInspection();
      const [{ id: otherId }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone)
         VALUES ('Sam', 'Other', 'sam@inspection.test', '+13055550102') RETURNING id`,
      )) as [{ id: string }];
      expect(
        await refusedWith(insertInspection({ driver_id: otherId })),
      ).toBeNull();
    });

    it("allows a new check-in once the earlier one is revoked", async () => {
      const first = await insertInspection();
      await db.query(
        `UPDATE inspections SET status = 'revoked' WHERE id = $1`,
        [first],
      );
      expect(await refusedWith(insertInspection())).toBeNull();
    });

    it("allows a new check-in once the earlier one is submitted", async () => {
      await insertInspection({
        status: "submitted",
        submitted_at: new Date(),
        attested_at: new Date(),
        odometer_miles: 84213,
        fuel_level: "1_2",
      });
      expect(await refusedWith(insertInspection())).toBeNull();
    });
  });

  describe("link and reference", () => {
    it("opens exactly one inspection per token hash", async () => {
      await insertInspection({ token_hash: HASH_A });
      expect(
        await refusedWith(
          insertInspection({ token_hash: HASH_A, type: "check_out" }),
        ),
      ).toMatch(/inspections_token_hash_unique/);
      expect(
        await refusedWith(
          insertInspection({ token_hash: HASH_B, type: "check_out" }),
        ),
      ).toBeNull();
    });

    it("never repeats a reference", async () => {
      await insertInspection({ reference: "INS-2026-000001" });
      expect(
        await refusedWith(
          insertInspection({
            reference: "INS-2026-000001",
            type: "check_out",
          }),
        ),
      ).toMatch(/inspections_reference_unique/);
    });

    it("hands out reference numbers that only go up", async () => {
      const next = async () =>
        Number(
          (
            (await db.query(
              `SELECT nextval('inspection_reference_seq') AS n`,
            )) as [{ n: string }]
          )[0].n,
        );
      const a = await next();
      const b = await next();
      expect(b).toBe(a + 1);
    });
  });

  describe("what a submitted inspection must have", () => {
    const full = {
      submitted_at: new Date(),
      attested_at: new Date(),
      odometer_miles: 84213,
      fuel_level: "full",
    };

    it("accepts a submitted inspection with the time, the attestation and both readings", async () => {
      expect(
        await refusedWith(insertInspection({ status: "submitted", ...full })),
      ).toBeNull();
    });

    it.each(["submitted_at", "attested_at", "odometer_miles", "fuel_level"])(
      "refuses a submitted inspection without %s",
      async (missing) => {
        const columns: Record<string, unknown> = { ...full };
        delete columns[missing];
        expect(
          await refusedWith(
            insertInspection({ status: "submitted", ...columns }),
          ),
        ).toMatch(/inspections_submitted_shape/);
      },
    );

    it("refuses a submission time on an inspection that is not submitted", async () => {
      expect(
        await refusedWith(insertInspection({ submitted_at: new Date() })),
      ).toMatch(/inspections_submitted_shape/);
    });

    it("refuses a negative mileage", async () => {
      expect(
        await refusedWith(insertInspection({ odometer_miles: -1 })),
      ).toMatch(/inspections_odometer_not_negative/);
    });

    it("accepts only the nine fuel levels", async () => {
      expect(
        await refusedWith(insertInspection({ fuel_level: "2_3" })),
      ).toMatch(/inspection_fuel_level/);
    });
  });

  describe("photos", () => {
    let inspectionId: string;
    beforeEach(async () => {
      inspectionId = await insertInspection();
    });

    it("keeps one photo per shot: a retried upload finds the row instead of adding one", async () => {
      await insertPhoto(inspectionId, "EXT_FRONT", 1);
      expect(
        await refusedWith(insertPhoto(inspectionId, "EXT_FRONT", 1)),
      ).toMatch(/inspection_photos_slot_unique/);
    });

    it("keeps damage photos apart by their number, 1 to 15", async () => {
      for (let n = 1; n <= 15; n += 1) {
        expect(
          await refusedWith(insertPhoto(inspectionId, "DAMAGE", n)),
        ).toBeNull();
      }
      expect(
        await refusedWith(insertPhoto(inspectionId, "DAMAGE", 16)),
      ).toMatch(/inspection_photos_position_range/);
      expect(await refusedWith(insertPhoto(inspectionId, "DAMAGE", 0))).toMatch(
        /inspection_photos_position_range/,
      );
    });

    it("gives a required shot only position 1", async () => {
      expect(
        await refusedWith(insertPhoto(inspectionId, "EXT_FRONT", 2)),
      ).toMatch(/inspection_photos_position_range/);
    });

    it("stores the SHA-256 fingerprint as 64 lower-case hex characters", async () => {
      expect(
        await refusedWith(
          insertPhoto(inspectionId, "EXT_FRONT", 1, "not a hash"),
        ),
      ).toMatch(/inspection_photos_sha256_hex/);
      expect(
        await refusedWith(
          insertPhoto(inspectionId, "EXT_FRONT", 1, "A".repeat(64)),
        ),
      ).toMatch(/inspection_photos_sha256_hex/);
    });

    it("cannot lose its photos or log by deleting the inspection", async () => {
      await insertPhoto(inspectionId, "EXT_FRONT", 1);
      expect(
        await refusedWith(
          db.query(`DELETE FROM inspections WHERE id = $1`, [inspectionId]),
        ),
      ).toMatch(/FK_inspection_photos_inspection/);
    });

    it("writes events that belong to an inspection and may leave the actor empty", async () => {
      expect(
        await refusedWith(
          db.query(
            `INSERT INTO inspection_events (inspection_id, type, meta)
             VALUES ($1, 'opened', '{"via":"link"}')`,
            [inspectionId],
          ),
        ),
      ).toBeNull();
      expect(
        await refusedWith(
          db.query(
            `INSERT INTO inspection_events (inspection_id, type)
             VALUES (gen_random_uuid(), 'opened')`,
          ),
        ),
      ).toMatch(/FK_inspection_events_inspection/);
    });
  });

  describe("the driver's language", () => {
    let drivers: DriversService;
    beforeEach(() => {
      drivers = new DriversService(
        db.getRepository(Driver),
        db.getRepository(PaymentAlias),
        db.getRepository(Payment),
        null,
      );
    });

    const validateCreate = (raw: Record<string, unknown>) => {
      const dto = plainToInstance(CreateDriverDto, {
        firstName: "Lia",
        lastName: "Nueva",
        email: "lia@inspection.test",
        phone: "(305) 555-0103",
        ...raw,
      });
      const errors = validateSync(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      return {
        dto,
        messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
      };
    };

    it("is English for a driver that already exists", async () => {
      const driver = await drivers.findOne(driverId);
      expect(driver.profile.preferredLanguage).toBe("en");
    });

    it("is English for a new driver when the form leaves it out or sends it empty", async () => {
      for (const raw of [{}, { preferredLanguage: "" }]) {
        await db.query("TRUNCATE drivers CASCADE");
        const { dto, messages } = validateCreate(raw);
        expect(messages).toEqual([]);
        const created = await drivers.create(dto, {}, null as never);
        expect(created.profile.preferredLanguage).toBe("en");
      }
    });

    it("can be Spanish from the start", async () => {
      const { dto, messages } = validateCreate({ preferredLanguage: "es" });
      expect(messages).toEqual([]);
      const created = await drivers.create(dto, {}, null as never);
      expect(created.profile.preferredLanguage).toBe("es");
    });

    it("refuses any other language", () => {
      expect(validateCreate({ preferredLanguage: "fr" }).messages).toEqual([
        "preferredLanguage must be en or es",
      ]);
    });

    it("can be changed from the profile, and a profile edit that leaves it out keeps it", async () => {
      const update = (raw: Record<string, unknown>) =>
        drivers.updateProfile(
          driverId,
          plainToInstance(UpdateDriverProfileDto, raw),
          null as never,
        );
      expect(
        (await update({ preferredLanguage: "es" })).profile.preferredLanguage,
      ).toBe("es");
      expect(
        (await update({ city: "Chicago" })).profile.preferredLanguage,
      ).toBe("es");
      expect(
        (await update({ preferredLanguage: "en" })).profile.preferredLanguage,
      ).toBe("en");
    });
  });
});
