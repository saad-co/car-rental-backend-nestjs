import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { DataSource } from "typeorm";
import { AliasType } from "../src/aliases/normalize-alias.js";
import {
  AliasSource,
  PaymentAlias,
} from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { Role, User } from "../src/users/user.entity.js";
import { openTestDatabase } from "./test-database.js";

describe("Payments: review filter and manual assign (test database)", () => {
  let db: DataSource;
  let payments: PaymentsService;
  let admin: string;
  let tim: string;
  let kim: string;
  let seq = 0;

  async function addPayment(
    values: Partial<Payment> & { senderName: string },
  ): Promise<string> {
    seq++;
    const result = await db.getRepository(Payment).insert({
      source: PaymentSource.email_venmo,
      externalId: `email-${seq}`,
      transactionId: null,
      amountCents: 5800,
      senderHandle: null,
      occurredAt: new Date(Date.UTC(2026, 9, 12, 0, seq)),
      extractionConfidence: 0.9,
      status: PaymentStatus.unmatched,
      ...values,
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  beforeAll(async () => {
    db = await openTestDatabase();
    payments = new PaymentsService(db);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE payments, payment_aliases, drivers, users CASCADE",
    );
    const user = await db.getRepository(User).save({
      email: "admin@example.com",
      passwordHash: "not-a-real-hash",
      role: Role.admin,
    });
    admin = user.id;
    [tim, kim] = (
      await db.getRepository(Driver).save([
        {
          firstName: "Tim",
          lastName: "Sutton",
          email: "tim@example.com",
          phone: "+13125550101",
        },
        {
          firstName: "Kim",
          lastName: "Lee",
          email: "kim@example.com",
          phone: "+13125550102",
        },
      ])
    ).map((d) => d.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("lists 'Needs review' (looked at, not placed) apart from assigned ones, with driver names", async () => {
    const review = await addPayment({
      senderName: "Pat S",
      suggestedDriverId: tim,
      matchConfidence: 0.6,
      matchAttemptedAt: new Date(),
    });
    await addPayment({ senderName: "Not looked at yet" });
    const assigned = await addPayment({
      senderName: "Kim Lee",
      driverId: kim,
      matchMethod: MatchMethod.name,
      matchAttemptedAt: new Date(),
      status: PaymentStatus.confirmed,
    });

    const needsReview = await payments.list({
      page: 1,
      limit: 20,
      match: "review",
    });
    expect(needsReview.items.map((p) => p.id)).toEqual([review]);
    expect(needsReview.items[0].suggestedDriver).toMatchObject({
      id: tim,
      firstName: "Tim",
    });

    const done = await payments.list({ page: 1, limit: 20, match: "assigned" });
    expect(done.items.map((p) => p.id)).toEqual([assigned]);
    expect(done.items[0].driver).toMatchObject({ id: kim, lastName: "Lee" });
  });

  it("assigns by hand, records the admin, sets the status, and saves the payer as an alias", async () => {
    const id = await addPayment({
      source: PaymentSource.email_zelle,
      senderName: "Maria Sutton",
    });
    const result = await payments.assign(id, tim, admin);

    expect(result.aliasSaved).toBe(true);
    expect(result.aliasOwnedBy).toBeNull();
    expect(result.payment).toMatchObject({
      driver: { id: tim },
      matchMethod: MatchMethod.manual,
      status: PaymentStatus.reported, // Zelle waits for the bank
    });
    expect(
      await db.getRepository(Payment).findOneByOrFail({ id }),
    ).toMatchObject({
      matchedById: admin,
      suggestedDriverId: null,
    });
    expect(
      await db
        .getRepository(PaymentAlias)
        .findOneBy({ type: AliasType.zelle, valueNormalized: "maria sutton" }),
    ).toMatchObject({ driverId: tim, source: AliasSource.manual });
  });

  it("re-assigns, but never takes an alias away from another driver", async () => {
    await db.getRepository(PaymentAlias).insert({
      driverId: kim,
      type: AliasType.venmo,
      value: "Family Account",
      valueNormalized: "family account",
      source: AliasSource.legacy,
    });
    const id = await addPayment({
      senderName: "Family Account",
      driverId: kim,
      matchMethod: MatchMethod.alias,
      status: PaymentStatus.confirmed,
    });

    const result = await payments.assign(id, tim, admin);
    expect(result.payment.driver?.id).toBe(tim);
    expect(result.aliasSaved).toBe(false);
    expect(result.aliasOwnedBy).toMatchObject({ id: kim });
    expect(
      (
        await db
          .getRepository(PaymentAlias)
          .findOneByOrFail({ valueNormalized: "family account" })
      ).driverId,
    ).toBe(kim);
  });

  it("refuses unknown payments and drivers, and rejected payments", async () => {
    const id = await addPayment({ senderName: "X" });
    await expect(
      payments.assign("00000000-0000-4000-8000-000000000000", tim, admin),
    ).rejects.toThrow(NotFoundException);
    await expect(
      payments.assign(id, "00000000-0000-4000-8000-000000000000", admin),
    ).rejects.toThrow(BadRequestException);
    const rejected = await addPayment({
      senderName: "Y",
      status: PaymentStatus.rejected,
    });
    await expect(payments.assign(rejected, tim, admin)).rejects.toThrow(
      ConflictException,
    );
  });
});
