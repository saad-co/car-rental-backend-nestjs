import { BadRequestException, ConflictException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import {
  CreateLedgerPresetDto,
  ReorderLedgerPresetsDto,
  UpdateLedgerPresetDto,
} from "../src/ledger-presets/dto/ledger-preset.dto.js";
import {
  LedgerPreset,
  LedgerPresetKind,
} from "../src/ledger-presets/ledger-preset.entity.js";
import { LedgerPresetsService } from "../src/ledger-presets/ledger-presets.service.js";
import { openTestDatabase } from "./test-database.js";

describe("Ledger presets (B86, D66, test database)", () => {
  let db: DataSource;
  let presets: LedgerPresetsService;
  let admin: string;

  const create = (
    kind: LedgerPresetKind,
    name: string,
    amountCents?: number | null,
    description = `${name} text`,
  ) => presets.create({ kind, name, amountCents, description }, admin);

  /** The errors a request body gets from the DTO checks, as the global ValidationPipe would find them. */
  function problems<T extends object>(
    type: new () => T,
    body: Record<string, unknown>,
  ): string[] {
    return validateSync(plainToInstance(type, body)).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
  }

  beforeAll(async () => {
    db = await openTestDatabase();
    presets = new LedgerPresetsService(db.getRepository(LedgerPreset), db);
  });

  beforeEach(async () => {
    // The migration's starting list is not wanted here: every test builds its own.
    await db.query("TRUNCATE ledger_presets, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("adds presets at the end of their kind and lists charges first, each kind in order", async () => {
    await create(LedgerPresetKind.credit, "Fee waiver");
    await create(LedgerPresetKind.charge, "Late fee", 2500);
    await create(LedgerPresetKind.charge, "Toll");
    await create(LedgerPresetKind.credit, "Referral bonus", 10_000);

    const list = await presets.list();
    expect(list.map((p) => [p.kind, p.name, p.position])).toEqual([
      ["charge", "Late fee", 1],
      ["charge", "Toll", 2],
      ["credit", "Fee waiver", 1],
      ["credit", "Referral bonus", 2],
    ]);
    expect(list[0]).toMatchObject({
      amountCents: 2500,
      description: "Late fee text",
    });
    expect(list[1].amountCents).toBeNull();
  });

  it("refuses a second preset with the same name in a kind, but allows it in the other kind", async () => {
    await create(LedgerPresetKind.charge, "Opening balance");
    await expect(
      create(LedgerPresetKind.charge, "Opening balance"),
    ).rejects.toThrow(ConflictException);
    await expect(
      create(LedgerPresetKind.credit, "Opening balance"),
    ).resolves.toBeDefined();
  });

  describe("what a body may contain", () => {
    it("accepts a normal preset and one without an amount", () => {
      expect(
        problems(CreateLedgerPresetDto, {
          kind: "charge",
          name: " Late fee ",
          amountCents: 2500,
          description: "Late payment fee",
        }),
      ).toEqual([]);
      expect(
        problems(CreateLedgerPresetDto, {
          kind: "credit",
          name: "Goodwill",
          amountCents: null,
          description: "Goodwill credit",
        }),
      ).toEqual([]);
    });

    it("refuses a blank name or description, an unknown kind, and amounts of zero, below zero, over the cap or with cents of a cent", () => {
      const ok = { kind: "charge", name: "x", description: "y" };
      expect(
        problems(CreateLedgerPresetDto, { ...ok, name: "   " }),
      ).not.toEqual([]);
      expect(
        problems(CreateLedgerPresetDto, { ...ok, description: "" }),
      ).not.toEqual([]);
      expect(
        problems(CreateLedgerPresetDto, { ...ok, kind: "tax" }),
      ).not.toEqual([]);
      for (const amountCents of [0, -5, 1_000_001, 12.5]) {
        expect(
          problems(UpdateLedgerPresetDto, {
            name: "x",
            description: "y",
            amountCents,
          }),
        ).not.toEqual([]);
      }
    });

    it("the database refuses an amount of zero or over the cap, and a blank name, even without the DTO", async () => {
      const insert = (name: string, cents: number | null, desc = "d") =>
        db.query(
          `INSERT INTO ledger_presets (kind, name, amount_cents, description, position)
           VALUES ('charge', $1, $2, $3, 1)`,
          [name, cents, desc],
        );
      await expect(insert("a", 0)).rejects.toThrow();
      await expect(insert("b", 1_000_001)).rejects.toThrow();
      await expect(insert("   ", 100)).rejects.toThrow();
      await expect(insert("c", 100, "   ")).rejects.toThrow();
      await expect(insert("d", null)).resolves.toBeDefined();
    });
  });

  describe("update and delete", () => {
    it("replaces the name, amount and description, keeps the kind and position, and can clear the amount", async () => {
      await create(LedgerPresetKind.charge, "First");
      const second = await create(LedgerPresetKind.charge, "Late fee", 2500);

      const edited = await presets.update(
        second.id,
        { name: "Late fee 3 days", amountCents: 3000, description: "New text" },
        admin,
      );
      expect(edited).toMatchObject({
        kind: "charge",
        position: 2,
        name: "Late fee 3 days",
        amountCents: 3000,
        description: "New text",
      });

      const cleared = await presets.update(
        second.id,
        { name: "Late fee 3 days", description: "New text" },
        admin,
      );
      expect(cleared.amountCents).toBeNull();
    });

    it("refuses a name already used in the kind, and an unknown id", async () => {
      await create(LedgerPresetKind.charge, "Toll");
      const other = await create(LedgerPresetKind.charge, "Towing");
      await expect(
        presets.update(other.id, { name: "Toll", description: "x" }, admin),
      ).rejects.toThrow(ConflictException);
      await expect(
        presets.update(randomUUID(), { name: "x", description: "y" }, admin),
      ).rejects.toThrow("Preset not found.");
    });

    it("deletes a preset, and refuses an unknown id", async () => {
      const toll = await create(LedgerPresetKind.charge, "Toll");
      await presets.remove(toll.id);
      expect(await presets.list()).toEqual([]);
      await expect(presets.remove(toll.id)).rejects.toThrow(
        "Preset not found.",
      );
    });
  });

  describe("reordering", () => {
    it("sets the new order of one kind and leaves the other kind alone", async () => {
      const a = await create(LedgerPresetKind.charge, "A");
      const b = await create(LedgerPresetKind.charge, "B");
      const c = await create(LedgerPresetKind.charge, "C");
      await create(LedgerPresetKind.credit, "Z");

      await presets.reorder(LedgerPresetKind.charge, [c.id, a.id, b.id]);
      expect((await presets.list()).map((p) => [p.name, p.position])).toEqual([
        ["C", 1],
        ["A", 2],
        ["B", 3],
        ["Z", 1],
      ]);
    });

    it("refuses a list that misses a preset, has an extra one, or has another kind's id", async () => {
      const a = await create(LedgerPresetKind.charge, "A");
      const b = await create(LedgerPresetKind.charge, "B");
      const z = await create(LedgerPresetKind.credit, "Z");

      await expect(
        presets.reorder(LedgerPresetKind.charge, [a.id]),
      ).rejects.toThrow(BadRequestException);
      await expect(
        presets.reorder(LedgerPresetKind.charge, [a.id, b.id, randomUUID()]),
      ).rejects.toThrow(BadRequestException);
      await expect(
        presets.reorder(LedgerPresetKind.charge, [a.id, z.id]),
      ).rejects.toThrow(BadRequestException);
      // Nothing changed.
      expect((await presets.list()).map((p) => p.position)).toEqual([1, 2, 1]);
    });

    it("the body of a reorder must hold uuids, each once", () => {
      const id = randomUUID();
      expect(
        problems(ReorderLedgerPresetsDto, { kind: "charge", ids: [id] }),
      ).toEqual([]);
      expect(
        problems(ReorderLedgerPresetsDto, { kind: "charge", ids: [id, id] }),
      ).not.toEqual([]);
      expect(
        problems(ReorderLedgerPresetsDto, { kind: "charge", ids: ["nope"] }),
      ).not.toEqual([]);
    });
  });
});
