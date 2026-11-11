import { NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { CreateDriverDto } from "../src/drivers/dto/create-driver.dto.js";
import { UpdateDriverRentSettingsDto } from "../src/drivers/dto/rent-settings.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

/** Builds a validated DTO the way the ValidationPipe does; throws with the messages when it is invalid. */
function dto<T extends object>(type: new () => T, values: object): T {
  const instance = plainToInstance(type, values);
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
  return instance;
}

describe("Rent settings: due time and payment plan flag (D92, test database)", () => {
  let db: DataSource;
  let drivers: DriversService;
  let adminId: string;
  let driverId: string;

  const row = async () =>
    (
      (await db.query(
        `SELECT rent_due_time::text AS "time", on_payment_plan AS "plan" FROM drivers WHERE id = $1`,
        [driverId],
      )) as { time: string | null; plan: boolean }[]
    )[0];

  beforeAll(async () => {
    db = await openTestDatabase();
    drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
      null,
    );
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE payments, payment_aliases, applications, ledger_entries, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Pat', 'Driver', 'pat@test.dev', '+13125550101') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the request body", () => {
    it("takes HH:MM on a 24-hour clock", () => {
      for (const rentDueTime of ["00:00", "12:00", "15:00", "18:30", "23:59"]) {
        expect(
          dto(UpdateDriverRentSettingsDto, { rentDueTime }).rentDueTime,
        ).toBe(rentDueTime);
      }
    });

    it("refuses anything else", () => {
      for (const rentDueTime of [
        "6pm",
        "6:00",
        "24:00",
        "18:60",
        "18:00:30",
        "1800",
        "noon",
      ]) {
        expect(() => dto(UpdateDriverRentSettingsDto, { rentDueTime })).toThrow(
          /rentDueTime/,
        );
      }
    });

    it("reads an empty time as null (clear it) and a left-out field as undefined (leave it)", () => {
      expect(
        dto(UpdateDriverRentSettingsDto, { rentDueTime: "" }).rentDueTime,
      ).toBeNull();
      expect(dto(UpdateDriverRentSettingsDto, {}).rentDueTime).toBeUndefined();
      expect(
        dto(UpdateDriverRentSettingsDto, {}).onPaymentPlan,
      ).toBeUndefined();
    });

    it("needs a real boolean for the payment plan flag", () => {
      expect(
        dto(UpdateDriverRentSettingsDto, { onPaymentPlan: true }).onPaymentPlan,
      ).toBe(true);
      expect(() =>
        dto(UpdateDriverRentSettingsDto, { onPaymentPlan: "yes" }),
      ).toThrow(/onPaymentPlan/);
    });
  });

  describe("updateRentSettings", () => {
    it("a new driver has no due time and is not on a plan", async () => {
      expect(await row()).toEqual({ time: null, plan: false });
      const detail = await drivers.findOne(driverId);
      expect(detail.rentDueTime).toBeNull();
      expect(detail.onPaymentPlan).toBe(false);
    });

    it("sets the time and the flag, answering with the time as HH:MM", async () => {
      const updated = await drivers.updateRentSettings(
        driverId,
        dto(UpdateDriverRentSettingsDto, {
          rentDueTime: "18:00",
          onPaymentPlan: true,
        }),
        adminId,
      );
      expect(updated.rentDueTime).toBe("18:00");
      expect(updated.onPaymentPlan).toBe(true);
      // Postgres keeps it as a time of day, with seconds.
      expect(await row()).toEqual({ time: "18:00:00", plan: true });
    });

    it("leaves a field that is not sent, and clears the time when it is sent as null", async () => {
      await drivers.updateRentSettings(
        driverId,
        dto(UpdateDriverRentSettingsDto, {
          rentDueTime: "15:00",
          onPaymentPlan: true,
        }),
        adminId,
      );
      await drivers.updateRentSettings(
        driverId,
        dto(UpdateDriverRentSettingsDto, { onPaymentPlan: false }),
        adminId,
      );
      expect(await row()).toEqual({ time: "15:00:00", plan: false });

      await drivers.updateRentSettings(
        driverId,
        dto(UpdateDriverRentSettingsDto, { rentDueTime: null }),
        adminId,
      );
      expect(await row()).toEqual({ time: null, plan: false });
    });

    it("changes no ledger entry and no other driver field", async () => {
      const before = await drivers.findOne(driverId);
      await drivers.updateRentSettings(
        driverId,
        dto(UpdateDriverRentSettingsDto, {
          rentDueTime: "20:00",
          onPaymentPlan: true,
        }),
        adminId,
      );
      const after = await drivers.findOne(driverId);
      // Every other field of the driver is exactly as it was.
      const others = (d: typeof before) =>
        JSON.stringify(
          Object.entries(d).filter(
            ([key]) => key !== "rentDueTime" && key !== "onPaymentPlan",
          ),
        );
      expect(others(after)).toBe(others(before));
      expect(after.rentDueTime).toBe("20:00");
      const [{ count }] = (await db.query(
        `SELECT COUNT(*)::int AS count FROM ledger_entries`,
      )) as { count: number }[];
      expect(count).toBe(0);
    });

    it("answers 404 for an unknown driver", async () => {
      await expect(
        drivers.updateRentSettings(
          "00000000-0000-0000-0000-000000000000",
          dto(UpdateDriverRentSettingsDto, { onPaymentPlan: true }),
          adminId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("the database itself refuses a time with seconds", async () => {
      await expect(
        db.query(
          `UPDATE drivers SET rent_due_time = '18:00:30' WHERE id = $1`,
          [driverId],
        ),
      ).rejects.toThrow(/drivers_rent_due_time_minute/);
    });
  });

  describe("adding a driver directly", () => {
    it("can carry a due time, and works without one", async () => {
      const withTime = await drivers.create(
        dto(CreateDriverDto, {
          firstName: "Ann",
          lastName: "Time",
          email: "ann@test.dev",
          phone: "3125550102",
          rentDueTime: "12:00",
        }),
        {},
        adminId,
      );
      expect(withTime.rentDueTime).toBe("12:00");
      expect(withTime.onPaymentPlan).toBe(false);

      const without = await drivers.create(
        dto(CreateDriverDto, {
          firstName: "Bob",
          lastName: "None",
          email: "bob@test.dev",
          phone: "3125550103",
        }),
        {},
        adminId,
      );
      expect(without.rentDueTime).toBeNull();
    });

    it("refuses a bad time before anything is saved", () => {
      expect(() =>
        dto(CreateDriverDto, {
          firstName: "Cy",
          lastName: "Bad",
          email: "cy@test.dev",
          phone: "3125550104",
          rentDueTime: "6pm",
        }),
      ).toThrow(/rentDueTime/);
    });
  });
});
