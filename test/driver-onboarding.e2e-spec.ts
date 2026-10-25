import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { AuthService } from "../src/auth/auth.service.js";
import { Driver, DriverLeftReason } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import {
  OnboardingStep,
  SetOnboardingStepDto,
} from "../src/drivers/dto/set-onboarding-step.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
import { PasswordService } from "../src/users/password.service.js";
import { User } from "../src/users/user.entity.js";
import { UsersService } from "../src/users/users.service.js";
import { openTestDatabase } from "./test-database.js";

describe("Driver onboarding, deactivate and reactivate (D56, test database)", () => {
  let db: DataSource;
  let drivers: DriversService;
  let auth: AuthService;
  const passwords = new PasswordService();
  let adminId: string;
  let driverId: string;

  const PASSWORD = "Driver-pass-123";
  const DEPOSIT_CENTS = 50_000;
  const LEFT = DriverLeftReason.contractEnded;
  const { contract, deposit, vehicle } = OnboardingStep;

  const tick = (step: OnboardingStep, done = true) =>
    drivers.setOnboardingStep(
      driverId,
      step,
      done,
      adminId,
      step === deposit && done ? DEPOSIT_CENTS : undefined,
    );

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
      "TRUNCATE payments, payment_aliases, applications, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    const [{ id: userId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role, email_verified_at)
       VALUES ('pat@test.dev', $1, 'driver', now()) RETURNING id`,
      [await passwords.hash(PASSWORD)],
    )) as [{ id: string }];
    // No status given: the database default must be `onboarding`, as for a driver created by approval.
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone, user_id)
       VALUES ('Pat', 'Driver', 'pat@test.dev', '+13125550101', $1) RETURNING id`,
      [userId],
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("a new driver starts in onboarding with no steps done", async () => {
    expect(await drivers.findOne(driverId)).toMatchObject({
      status: "onboarding",
      onboarding: {
        contractSignedAt: null,
        depositPaidAt: null,
        vehicleAssignedAt: null,
      },
    });
  });

  it("becomes active automatically when the third step is ticked, in any order", async () => {
    expect((await tick(vehicle)).status).toBe("onboarding");
    expect((await tick(contract)).status).toBe("onboarding");
    const done = await tick(deposit);

    expect(done.status).toBe("active");
    expect(done.onboarding.depositPaidAt).toBeInstanceOf(Date);
    const [row] = (await db.query(
      `SELECT deposit_paid_by_id FROM drivers WHERE id = $1`,
      [driverId],
    )) as [{ deposit_paid_by_id: string }];
    expect(row.deposit_paid_by_id).toBe(adminId);
  });

  it("ticking a step already done keeps its first date", async () => {
    const first = (await tick(contract)).onboarding.contractSignedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await tick(contract)).onboarding.contractSignedAt).toEqual(first);
  });

  it("un-ticking a step of an active driver puts them back in onboarding", async () => {
    await tick(contract);
    await tick(deposit);
    await tick(vehicle);

    const back = await tick(vehicle, false);

    expect(back.status).toBe("onboarding");
    expect(back.onboarding.vehicleAssignedAt).toBeNull();
  });

  it("the database refuses `active` without the three steps, whatever code tries it", async () => {
    await tick(contract);
    await expect(
      db.query(`UPDATE drivers SET status = 'active' WHERE id = $1`, [
        driverId,
      ]),
    ).rejects.toThrow(/drivers_active_is_onboarded/);
  });

  it("deactivate: status inactive, steps kept, login refused; steps locked while inactive", async () => {
    await tick(contract);

    const inactive = await drivers.deactivate(driverId, LEFT, adminId);

    expect(inactive.status).toBe("inactive");
    expect(inactive.onboarding.contractSignedAt).toBeInstanceOf(Date);
    await expect(auth.login("pat@test.dev", PASSWORD)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(tick(deposit)).rejects.toBeInstanceOf(ConflictException);
    // Deactivating twice changes nothing.
    expect((await drivers.deactivate(driverId, LEFT, adminId)).status).toBe(
      "inactive",
    );
  });

  it("reactivate: onboarding when steps are missing, active when all are done; login works again", async () => {
    await tick(contract);
    await drivers.deactivate(driverId, LEFT, adminId);

    expect((await drivers.reactivate(driverId, adminId)).status).toBe(
      "onboarding",
    );
    expect((await auth.login("pat@test.dev", PASSWORD)).user.email).toBe(
      "pat@test.dev",
    );

    await tick(deposit);
    await tick(vehicle);
    await drivers.deactivate(driverId, LEFT, adminId);
    expect((await drivers.reactivate(driverId, adminId)).status).toBe("active");
    // Reactivating a driver who is not inactive changes nothing.
    expect((await drivers.reactivate(driverId, adminId)).status).toBe("active");
  });

  it("a driver without a login (imported) can be deactivated and reactivated too", async () => {
    await db.query(`UPDATE drivers SET user_id = NULL WHERE id = $1`, [
      driverId,
    ]);
    expect((await drivers.deactivate(driverId, LEFT, adminId)).status).toBe(
      "inactive",
    );
    expect((await drivers.reactivate(driverId, adminId)).status).toBe(
      "onboarding",
    );
  });

  it("the request body accepts only a known step and a true/false (the ValidationPipe answers 400)", () => {
    const errors = (values: unknown) =>
      validateSync(plainToInstance(SetOnboardingStepDto, values));
    expect(errors({ step: "deposit", done: true })).toHaveLength(0);
    expect(errors({ step: "insurance", done: true })).not.toHaveLength(0);
    expect(errors({ step: "deposit", done: "yes" })).not.toHaveLength(0);
    expect(errors({ step: "deposit" })).not.toHaveLength(0);
  });
});
