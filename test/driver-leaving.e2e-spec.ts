import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { AuthService } from "../src/auth/auth.service.js";
import { Driver, DriverLeftReason } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import {
  DeactivateDriverDto,
  SendToCollectionsDto,
} from "../src/drivers/dto/leaving.dto.js";
import { ListDriversQueryDto } from "../src/drivers/dto/list-drivers-query.dto.js";
import {
  OnboardingStep,
  SetOnboardingStepDto,
} from "../src/drivers/dto/set-onboarding-step.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
import { PasswordService } from "../src/users/password.service.js";
import { User } from "../src/users/user.entity.js";
import { UsersService } from "../src/users/users.service.js";
import { openTestDatabase } from "./test-database.js";

/** Builds a validated DTO the way the ValidationPipe does; throws with the messages when it is invalid. */
function dto<T extends object>(type: new () => T, values: object): T {
  const instance = plainToInstance(type, values);
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
  return instance;
}

describe("Leaving a driver, collections and the deposit amount (D81, D82, test database)", () => {
  let db: DataSource;
  let drivers: DriversService;
  let auth: AuthService;
  const passwords = new PasswordService();
  let adminId: string;
  let driverId: string;

  const PASSWORD = "Driver-pass-123";
  const { contract, deposit, vehicle } = OnboardingStep;
  const { contractEnded, badDriver, cooperativeReturnedCar } = DriverLeftReason;

  /** Gets a driver to `active` the legal way: all three steps ticked. */
  const makeActive = async (id = driverId) => {
    await drivers.setOnboardingStep(id, contract, true, adminId);
    await drivers.setOnboardingStep(id, deposit, true, adminId, 30_000);
    return drivers.setOnboardingStep(id, vehicle, true, adminId);
  };

  const row = async (id = driverId) =>
    (
      (await db.query(`SELECT * FROM drivers WHERE id = $1`, [id])) as Record<
        string,
        unknown
      >[]
    )[0];

  /** A second driver without a login, to test the list. */
  const addDriver = async (first: string, phone: string) => {
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ($1, 'Other', $2, $3) RETURNING id`,
      [first, `${first.toLowerCase()}@test.dev`, phone],
    )) as [{ id: string }];
    return id;
  };

  beforeAll(async () => {
    db = await openTestDatabase();
    drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
    auth = new AuthService(
      new UsersService(db.getRepository(User), passwords),
      passwords,
      new JwtService({ secret: "test-secret" }),
    );
    await auth.onModuleInit();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE payments, payment_aliases, applications, ledger_entries, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    const [{ id: userId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role, email_verified_at)
       VALUES ('pat@test.dev', $1, 'driver', now()) RETURNING id`,
      [await passwords.hash(PASSWORD)],
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone, user_id)
       VALUES ('Pat', 'Driver', 'pat@test.dev', '+13125550101', $1) RETURNING id`,
      [userId],
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("deactivate with a reason", () => {
    it("needs a reason from the three the client named", () => {
      expect(() => dto(DeactivateDriverDto, {})).toThrow();
      expect(() => dto(DeactivateDriverDto, { reason: "fired" })).toThrow();
      for (const reason of Object.values(DriverLeftReason)) {
        expect(dto(DeactivateDriverDto, { reason }).reason).toBe(reason);
      }
      expect(Object.values(DriverLeftReason)).toEqual([
        "contract_ended",
        "bad_driver",
        "cooperative_returned_car",
      ]);
    });

    it("stores the reason, the date and the admin, turns the login off", async () => {
      await makeActive();

      const left = await drivers.deactivate(driverId, badDriver, adminId);

      expect(left).toMatchObject({
        status: "inactive",
        leftReason: "bad_driver",
        sentToCollectionsAt: null,
      });
      expect(left.leftAt).toBeInstanceOf(Date);
      expect((await row()).left_by_id).toBe(adminId);
      await expect(auth.login("pat@test.dev", PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("deactivating again keeps the first reason and date", async () => {
      await makeActive();
      const first = await drivers.deactivate(driverId, badDriver, adminId);

      const again = await drivers.deactivate(
        driverId,
        cooperativeReturnedCar,
        adminId,
      );

      expect(again.leftReason).toBe("bad_driver");
      expect(again.leftAt).toEqual(first.leftAt);
    });

    it("notes a reason on a driver deactivated before reasons existed", async () => {
      await makeActive();
      await db.query(`UPDATE drivers SET status = 'inactive' WHERE id = $1`, [
        driverId,
      ]);
      expect((await drivers.findOne(driverId)).leftReason).toBeNull();

      const noted = await drivers.deactivate(driverId, contractEnded, adminId);

      expect(noted.leftReason).toBe("contract_ended");
    });

    it("reactivate clears how they left and the collections flag", async () => {
      await makeActive();
      await drivers.sendToCollections(driverId, badDriver, adminId);

      const back = await drivers.reactivate(driverId, adminId);

      expect(back).toMatchObject({
        status: "active",
        leftReason: null,
        leftAt: null,
        sentToCollectionsAt: null,
      });
      const after = await row();
      expect(after.left_by_id).toBeNull();
      expect(after.sent_to_collections_by_id).toBeNull();
      expect((await auth.login("pat@test.dev", PASSWORD)).user.email).toBe(
        "pat@test.dev",
      );
    });
  });

  describe("send to collections", () => {
    it("an active driver needs a reason; it deactivates and flags in one step", async () => {
      await makeActive();

      await expect(
        drivers.sendToCollections(driverId, undefined, adminId),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Nothing changed after the refusal.
      expect((await drivers.findOne(driverId)).status).toBe("active");

      const sent = await drivers.sendToCollections(
        driverId,
        cooperativeReturnedCar,
        adminId,
      );

      expect(sent).toMatchObject({
        status: "inactive",
        leftReason: "cooperative_returned_car",
      });
      expect(sent.sentToCollectionsAt).toBeInstanceOf(Date);
      expect((await row()).sent_to_collections_by_id).toBe(adminId);
      await expect(auth.login("pat@test.dev", PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("an already inactive driver keeps the reason they have; the reason may be left out", async () => {
      await makeActive();
      await drivers.deactivate(driverId, contractEnded, adminId);

      const sent = await drivers.sendToCollections(
        driverId,
        undefined,
        adminId,
      );

      expect(sent.leftReason).toBe("contract_ended");
      expect(sent.sentToCollectionsAt).toBeInstanceOf(Date);
    });

    it("an old inactive driver with no reason must be given one", async () => {
      await makeActive();
      await db.query(`UPDATE drivers SET status = 'inactive' WHERE id = $1`, [
        driverId,
      ]);

      await expect(
        drivers.sendToCollections(driverId, undefined, adminId),
      ).rejects.toBeInstanceOf(BadRequestException);
      const sent = await drivers.sendToCollections(
        driverId,
        badDriver,
        adminId,
      );

      expect(sent.leftReason).toBe("bad_driver");
      expect(sent.sentToCollectionsAt).toBeInstanceOf(Date);
    });

    it("sending twice changes nothing (date and admin stay)", async () => {
      await makeActive();
      const first = await drivers.sendToCollections(
        driverId,
        badDriver,
        adminId,
      );

      const again = await drivers.sendToCollections(
        driverId,
        contractEnded,
        adminId,
      );

      expect(again.sentToCollectionsAt).toEqual(first.sentToCollectionsAt);
      expect(again.leftReason).toBe("bad_driver");
    });

    it("refuses a driver still in onboarding", async () => {
      await expect(
        drivers.sendToCollections(driverId, badDriver, adminId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("works without checking the balance (owing or not)", async () => {
      await makeActive();
      // No ledger entries at all: balance 0.
      expect(
        (await drivers.sendToCollections(driverId, badDriver, adminId))
          .balanceCents,
      ).toBe(0);
    });

    it("remove from collections: the flag goes, the driver stays inactive with the reason", async () => {
      await makeActive();
      await drivers.sendToCollections(driverId, badDriver, adminId);

      const removed = await drivers.removeFromCollections(driverId, adminId);

      expect(removed).toMatchObject({
        status: "inactive",
        leftReason: "bad_driver",
        sentToCollectionsAt: null,
      });
      expect((await row()).sent_to_collections_by_id).toBeNull();
      // Removing a driver who is not in collections changes nothing.
      expect(
        (await drivers.removeFromCollections(driverId, adminId)).status,
      ).toBe("inactive");
    });

    it("an archived driver can be sent and stays hidden; unarchive restores it", async () => {
      await makeActive();
      await drivers.archive(driverId, adminId);

      await drivers.sendToCollections(driverId, badDriver, adminId);

      const hidden = await drivers.list(
        dto(ListDriversQueryDto, { collections: "true" }),
      );
      expect(hidden.total).toBe(0);
      const shown = await drivers.list(
        dto(ListDriversQueryDto, { collections: "true", archived: "true" }),
      );
      expect(shown.items.map((d) => d.id)).toEqual([driverId]);
      const back = await drivers.unarchive(driverId, adminId);
      expect(back.sentToCollectionsAt).toBeInstanceOf(Date);
    });
  });

  describe("the Collections list", () => {
    it("lists only drivers in collections, the latest sent first, with their balance", async () => {
      await makeActive();
      const other = await addDriver("Sam", "+13125550102");
      const third = await addDriver("Tia", "+13125550103");
      await db.query(
        `UPDATE drivers SET status = 'inactive', left_reason = 'contract_ended', left_at = now() WHERE id = ANY($1)`,
        [[other, third]],
      );
      await drivers.sendToCollections(driverId, badDriver, adminId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await drivers.sendToCollections(other, undefined, adminId);
      await db.query(
        `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date, created_by_id, idempotency_key)
         VALUES ($1, 'debit', 10000, 'adjustment', 'Damage', current_date, $2, 'leaving-test-1')`,
        [other, adminId],
      );

      const page = await drivers.list(
        dto(ListDriversQueryDto, { collections: "true" }),
      );

      expect(page.items.map((d) => d.id)).toEqual([other, driverId]);
      expect(page.total).toBe(2);
      expect(page.items[0].balanceCents).toBe(-10_000);
      // Without the flag nothing is filtered (the payment pickers need every driver, collections included).
      const all = await drivers.list(dto(ListDriversQueryDto, {}));
      expect(all.total).toBe(3);
      // `collections=false` is the Drivers page: only the one not in collections is left.
      const driversPage = await drivers.list(
        dto(ListDriversQueryDto, { collections: "false" }),
      );
      expect(driversPage.items.map((d) => d.id)).toEqual([third]);
    });

    it("search and the date range work on the day they were sent", async () => {
      await makeActive();
      await drivers.sendToCollections(driverId, badDriver, adminId);

      const found = await drivers.list(
        dto(ListDriversQueryDto, { collections: "true", search: "pat" }),
      );
      const none = await drivers.list(
        dto(ListDriversQueryDto, { collections: "true", search: "zzz" }),
      );
      const farPast = await drivers.list(
        dto(ListDriversQueryDto, {
          collections: "true",
          from: "2020-01-01",
          to: "2020-01-31",
        }),
      );

      expect(found.total).toBe(1);
      expect(none.total).toBe(0);
      expect(farPast.total).toBe(0);
    });
  });

  describe("the database rules", () => {
    it("a reason needs a date, and only an inactive driver has left", async () => {
      await expect(
        db.query(
          `UPDATE drivers SET left_reason = 'bad_driver' WHERE id = $1`,
          [driverId],
        ),
      ).rejects.toThrow(/drivers_left_shape/);
      await expect(
        db.query(
          `UPDATE drivers SET left_reason = 'bad_driver', left_at = now() WHERE id = $1`,
          [driverId],
        ),
      ).rejects.toThrow(/drivers_left_shape/);
    });

    it("collections needs an inactive driver with a reason", async () => {
      await expect(
        db.query(
          `UPDATE drivers SET sent_to_collections_at = now() WHERE id = $1`,
          [driverId],
        ),
      ).rejects.toThrow(/drivers_collections_shape/);
      await expect(
        db.query(
          `UPDATE drivers SET status = 'inactive', sent_to_collections_at = now() WHERE id = $1`,
          [driverId],
        ),
      ).rejects.toThrow(/drivers_collections_shape/);
    });

    it("a deposit amount needs the deposit step ticked and a positive number", async () => {
      await expect(
        db.query(`UPDATE drivers SET deposit_paid_cents = 100 WHERE id = $1`, [
          driverId,
        ]),
      ).rejects.toThrow(/drivers_deposit_amount_shape/);
      await expect(
        db.query(
          `UPDATE drivers SET deposit_paid_at = now(), deposit_paid_cents = 0 WHERE id = $1`,
          [driverId],
        ),
      ).rejects.toThrow(/drivers_deposit_amount_shape/);
    });
  });

  describe("the deposit amount", () => {
    it("is required the first time the deposit is ticked, and stored with the step", async () => {
      await expect(
        drivers.setOnboardingStep(driverId, deposit, true, adminId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await row()).deposit_paid_at).toBeNull();

      const ticked = await drivers.setOnboardingStep(
        driverId,
        deposit,
        true,
        adminId,
        25_000,
      );

      expect(ticked.onboarding.depositPaidCents).toBe(25_000);
      expect(ticked.onboarding.depositPaidAt).toBeInstanceOf(Date);
    });

    it("is cleared when the step is un-ticked", async () => {
      await drivers.setOnboardingStep(driverId, deposit, true, adminId, 25_000);

      const cleared = await drivers.setOnboardingStep(
        driverId,
        deposit,
        false,
        adminId,
      );

      expect(cleared.onboarding).toMatchObject({
        depositPaidAt: null,
        depositPaidCents: null,
      });
    });

    it("an amount sent with an already-ticked deposit records or corrects it, keeping the date", async () => {
      await db.query(
        `UPDATE drivers SET deposit_paid_at = now() - interval '2 days' WHERE id = $1`,
        [driverId],
      );
      const before = (await drivers.findOne(driverId)).onboarding;
      expect(before.depositPaidCents).toBeNull();

      const filled = await drivers.setOnboardingStep(
        driverId,
        deposit,
        true,
        adminId,
        40_000,
      );
      const fixed = await drivers.setOnboardingStep(
        driverId,
        deposit,
        true,
        adminId,
        45_000,
      );

      expect(filled.onboarding.depositPaidCents).toBe(40_000);
      expect(fixed.onboarding.depositPaidCents).toBe(45_000);
      expect(fixed.onboarding.depositPaidAt).toEqual(before.depositPaidAt);
    });

    it("ticking an already-ticked deposit without an amount keeps the amount", async () => {
      await drivers.setOnboardingStep(driverId, deposit, true, adminId, 25_000);

      const again = await drivers.setOnboardingStep(
        driverId,
        deposit,
        true,
        adminId,
      );

      expect(again.onboarding.depositPaidCents).toBe(25_000);
    });

    it("an amount goes only with ticking the deposit", async () => {
      await expect(
        drivers.setOnboardingStep(driverId, contract, true, adminId, 100),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        drivers.setOnboardingStep(driverId, deposit, false, adminId, 100),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("the request body takes a whole number of cents from 1 up to what the column holds", () => {
      const ok = (depositPaidCents: unknown) =>
        validateSync(
          plainToInstance(SetOnboardingStepDto, {
            step: "deposit",
            done: true,
            depositPaidCents,
          }),
        ).length === 0;
      expect(ok(undefined)).toBe(true);
      expect(ok(25_000)).toBe(true);
      expect(ok(2_147_483_647)).toBe(true);
      expect(ok(0)).toBe(false);
      expect(ok(-5)).toBe(false);
      expect(ok(10.5)).toBe(false);
      expect(ok("500")).toBe(false);
      expect(ok(2_147_483_648)).toBe(false);
    });

    it("the collections body takes an optional known reason", () => {
      expect(dto(SendToCollectionsDto, {}).reason).toBeUndefined();
      expect(dto(SendToCollectionsDto, { reason: "bad_driver" }).reason).toBe(
        "bad_driver",
      );
      expect(() => dto(SendToCollectionsDto, { reason: "x" })).toThrow();
    });
  });
});
