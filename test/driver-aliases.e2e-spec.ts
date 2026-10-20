import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { AliasType } from "../src/aliases/normalize-alias.js";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversController } from "../src/drivers/drivers.controller.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { AddAliasDto } from "../src/drivers/dto/add-alias.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe("Payment aliases on the driver page: add and remove (D69, test database)", () => {
  let db: DataSource;
  let drivers: DriversService;
  let adminId: string;
  let pat: string;
  let sam: string;

  const add = (driverId: string, type: AliasType, value: string) =>
    drivers.addAlias(driverId, plain(type, value), adminId);
  /** What the global ValidationPipe hands the service: the body turned into the DTO (trimmed, spaces collapsed). */
  const plain = (type: AliasType, value: string) =>
    plainToInstance(AddAliasDto, { type, value });
  const rows = (driverId: string) =>
    db.query(
      `SELECT type, value, value_normalized AS "normalized", source FROM payment_aliases
       WHERE driver_id = $1 ORDER BY type, value_normalized`,
      [driverId],
    ) as Promise<
      { type: string; value: string; normalized: string; source: string }[]
    >;

  beforeAll(async () => {
    db = await openTestDatabase();
    drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE payment_aliases, drivers, users CASCADE");
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@alias.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    const created = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone) VALUES
         ('Pat', 'Driver', 'pat@alias.test', '+13125550101'),
         ('Sam', 'Other', 'sam@alias.test', '+13125550102') RETURNING id`,
    )) as { id: string }[];
    [pat, sam] = created.map((d) => d.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the request body", () => {
    const check = (raw: Record<string, unknown>) => {
      const dto = plainToInstance(AddAliasDto, raw);
      return { dto, errors: validateSync(dto).map((e) => e.property) };
    };

    it("takes a payment method and a value, trimmed and with inner spaces collapsed", () => {
      const { dto, errors } = check({
        type: "zelle",
        value: "  Timothy   Sutton ",
      });
      expect(errors).toEqual([]);
      expect(dto.value).toBe("Timothy Sutton");
    });

    it.each([
      ["a method we do not have", { type: "paypal", value: "x" }],
      ["no method", { value: "x" }],
      ["an empty value", { type: "venmo", value: "   " }],
      ["a very long value", { type: "venmo", value: "x".repeat(256) }],
    ])("refuses %s", (_name, raw) => {
      expect(check(raw).errors.length).toBeGreaterThan(0);
    });
  });

  it("adds an alias as typed, saved as manual, normalised as matching compares it", async () => {
    const driver = await add(pat, AliasType.cashapp, "$PatEx");

    expect(driver.aliases).toHaveLength(1);
    expect(driver.aliases[0]).toMatchObject({
      type: "cashapp",
      value: "$PatEx",
      source: "manual",
    });
    expect(driver.aliases[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rows(pat)).toEqual([
      {
        type: "cashapp",
        value: "$PatEx",
        normalized: "patex",
        source: "manual",
      },
    ]);
  });

  it("normalises names (case, spaces), phones (+1 form) and emails (lower-case)", async () => {
    await add(pat, AliasType.zelle, "TIMOTHY  SUTTON");
    await add(pat, AliasType.phone, "(312) 555-0199");
    await add(pat, AliasType.email, "Pat.Work@Example.com");

    expect((await rows(pat)).map((r) => [r.type, r.normalized])).toEqual([
      ["zelle", "timothy sutton"],
      ["email", "pat.work@example.com"],
      ["phone", "+13125550199"],
    ]);
  });

  it("refuses a phone that is not a US number, an email that is not one, and a value empty after normalising", async () => {
    await expect(add(pat, AliasType.phone, "12345")).rejects.toThrow(
      "That is not a US phone number (10 digits).",
    );
    await expect(add(pat, AliasType.email, "not an email")).rejects.toThrow(
      "That is not an email address.",
    );
    await expect(add(pat, AliasType.cashapp, "$")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await rows(pat)).toEqual([]);
  });

  it("answers 409 when the driver already has it, however it is typed", async () => {
    await add(pat, AliasType.cashapp, "$PatEx");

    await expect(add(pat, AliasType.cashapp, "patex")).rejects.toThrow(
      "This driver already has this alias.",
    );
    expect(await rows(pat)).toHaveLength(1);
  });

  it("answers 409 naming the owner when another driver has it, and does not take it", async () => {
    await add(sam, AliasType.zelle, "Company Llc");

    await expect(add(pat, AliasType.zelle, "company  LLC")).rejects.toThrow(
      "This alias already belongs to Sam Other. An alias can belong to one driver only.",
    );
    expect(await rows(pat)).toEqual([]);
    expect(await rows(sam)).toHaveLength(1);
  });

  it("looks only at the same payment method: the same text under another method is a different alias", async () => {
    await add(sam, AliasType.venmo, "pat-pays");

    await add(pat, AliasType.cashapp, "pat-pays");

    expect((await rows(pat)).map((r) => r.type)).toEqual(["cashapp"]);
  });

  it("two admins adding the same alias at the same instant: one wins, the other gets 409", async () => {
    const results = await Promise.allSettled([
      add(pat, AliasType.venmo, "@race"),
      add(sam, AliasType.venmo, "race"),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const failure = results.find((r) => r.status === "rejected");
    expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect((await rows(pat)).length + (await rows(sam)).length).toBe(1);
  });

  it("404s for an unknown driver", async () => {
    await expect(add(UNKNOWN_ID, AliasType.zelle, "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe("removing", () => {
    it("removes an alias whatever its source, and leaves the others", async () => {
      await db.query(
        `INSERT INTO payment_aliases (driver_id, type, value, value_normalized, source) VALUES
           ($1, 'zelle', 'Old Name', 'old name', 'legacy'),
           ($1, 'venmo', 'learned', 'learned', 'ai_match')`,
        [pat],
      );
      await add(pat, AliasType.cashapp, "$mine");
      const before = await drivers.findOne(pat);
      const byValue = (value: string) =>
        before.aliases.find((a) => a.value === value)!.id;

      let driver = await drivers.removeAlias(pat, byValue("Old Name"), adminId);
      driver = await drivers.removeAlias(pat, byValue("learned"), adminId);

      expect(driver.aliases.map((a) => a.value)).toEqual(["$mine"]);
      expect(await rows(pat)).toHaveLength(1);
    });

    it("404s for an alias that is not this driver's, or does not exist, and removes nothing", async () => {
      const samDriver = await add(sam, AliasType.venmo, "sams");
      const samAlias = samDriver.aliases[0].id;

      await expect(drivers.removeAlias(pat, samAlias, adminId)).rejects.toThrow(
        "Alias not found.",
      );
      await expect(
        drivers.removeAlias(pat, UNKNOWN_ID, adminId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await rows(sam)).toHaveLength(1);
    });

    it("lets the same alias be added to someone else afterwards", async () => {
      const driver = await add(pat, AliasType.zelle, "Shared Name");
      await drivers.removeAlias(pat, driver.aliases[0].id, adminId);

      await add(sam, AliasType.zelle, "Shared Name");

      expect(await rows(sam)).toHaveLength(1);
    });
  });

  it("the routes need a login (they are not public)", () => {
    for (const route of ["addAlias", "removeAlias"] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        DriversController.prototype,
        route,
      )?.value as object;
      expect(Reflect.getMetadata("isPublic", handler)).toBeUndefined();
    }
  });
});
