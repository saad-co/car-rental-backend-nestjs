import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { LedgerDirection } from "../src/ledger/ledger-entry.entity.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import type { CreateLedgerEntryDto } from "../src/ledger/dto/ledger-entry.dto.js";
import { InspectionDamageService } from "../src/inspections/inspection-damage.service.js";
import { InspectionType } from "../src/inspections/inspection.entity.js";
import { InspectionsService } from "../src/inspections/inspections.service.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { SmsService } from "../src/sms/sms.service.js";
import { chicagoDate } from "../src/common/chicago-date.js";
import { openTestDatabase } from "./test-database.js";

describe("vehicle inspections, compare, damage items and the charge (Module 3 chat 2 step 3, test database)", () => {
  let db: DataSource;
  let adminId: string;
  let driverId: string;
  let inspections: InspectionsService;
  let ledger: LedgerService;
  let damage: InspectionDamageService;

  let checkInId: string;
  let checkOutId: string;

  const buildInspections = () =>
    new InspectionsService(
      db,
      new SmsService(db, {
        mode: "dry_run",
        quo: {} as never,
        phoneNumberId: "PNtest",
        quoApiKey: null,
        storage: null,
      }),
      new SettingsService(db.getRepository(AppSetting)),
      { getOrThrow: () => "https://app.test/" } as unknown as ConfigService,
      null,
    );

  /** Puts one photo row on an inspection. Returns its id. */
  const addPhoto = async (
    inspectionId: string,
    shotId: string,
    position = 1,
    note: string | null = null,
  ) => {
    const [{ id }] = (await db.query(
      `INSERT INTO inspection_photos (inspection_id, shot_id, position, storage_key, thumb_key, driver_note, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        inspectionId,
        shotId,
        position,
        `k/${randomUUID()}`,
        `t/${randomUUID()}`,
        note,
        "a".repeat(64),
      ],
    )) as [{ id: string }];
    return id;
  };

  /** All 19 shots on an inspection, and its readings; submitted. */
  const finish = async (
    id: string,
    odometer: number,
    fuel: string,
  ): Promise<Map<string, string>> => {
    const shots = (await db.query(
      `SELECT shot_id AS "shotId" FROM inspection_shots ORDER BY position`,
    )) as { shotId: string }[];
    const photoIds = new Map<string, string>();
    for (const shot of shots) {
      photoIds.set(shot.shotId, await addPhoto(id, shot.shotId));
    }
    await db.query(
      `UPDATE inspections SET status = 'submitted', submitted_at = now(), attested_at = now(), odometer_miles = $2, fuel_level = $3 WHERE id = $1`,
      [id, odometer, fuel],
    );
    return photoIds;
  };

  const status = async (id: string) =>
    (
      (await db.query(`SELECT status FROM inspections WHERE id = $1`, [
        id,
      ])) as { status: string }[]
    )[0].status;
  const debits = async () =>
    (await db.query(
      `SELECT id, amount_cents AS "amountCents", description FROM ledger_entries WHERE driver_id = $1 AND direction = 'debit'`,
      [driverId],
    )) as { id: string; amountCents: number; description: string }[];
  const chargeBody = (
    over: Partial<CreateLedgerEntryDto> = {},
  ): CreateLedgerEntryDto => ({
    direction: LedgerDirection.debit,
    amountCents: 25_000,
    effectiveDate: chicagoDate(new Date()),
    reason: "Damage: front bumper",
    requestKey: randomUUID(),
    ...over,
  });

  let checkInPhotos: Map<string, string>;
  let checkOutPhotos: Map<string, string>;

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE damage_items, inspection_events, inspection_photos, inspections, sms_messages, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@damage.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Dana', 'Driver', 'dana@damage.test', '+13125550104') RETURNING id`,
    )) as [{ id: string }];
    inspections = buildInspections();
    ledger = new LedgerService(db);
    damage = new InspectionDamageService(db, inspections, ledger);

    const vehicle = { model: "2021 Toyota Camry" };
    const checkIn = await inspections.create(
      driverId,
      { type: InspectionType.checkIn, vehicle },
      adminId,
    );
    checkInId = checkIn.id;
    checkInPhotos = await finish(checkInId, 84_000, "full");
    await addPhoto(checkInId, "DAMAGE", 1, "Scratch on the front bumper");
    const checkOut = await inspections.create(
      driverId,
      { type: InspectionType.checkOut, vehicle },
      adminId,
    );
    checkOutId = checkOut.id;
    checkOutPhotos = await finish(checkOutId, 85_001, "1_2");
    await addPhoto(checkOutId, "DAMAGE", 1, "Dent on rear door");
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("compare", () => {
    it("sets the 19 check-out photos beside the check-in's and works out miles and fuel", async () => {
      const compare = await damage.compare(checkOutId);
      expect(compare.available).toBe(true);
      expect(compare.pairs).toHaveLength(19);
      expect(compare.pairs.every((p) => p.checkIn && p.checkOut)).toBe(true);
      expect(compare.milesDriven).toBe(1001);
      expect(compare.fuelChangeEighths).toBe(-4);
      expect(compare.checkIn?.id).toBe(checkInId);
    });

    it("lists the pickup damage read-only and the return damage as markable", async () => {
      const compare = await damage.compare(checkOutId);
      expect(compare.checkInDamage.map((p) => p.driverNote)).toEqual([
        "Scratch on the front bumper",
      ]);
      expect(compare.checkOutDamage).toHaveLength(1);
      expect(compare.checkOutDamage[0].photo.driverNote).toBe(
        "Dent on rear door",
      );
      expect(compare.checkOutDamage[0].damageItem).toBeNull();
    });

    it("says why when there is nothing to compare, instead of failing", async () => {
      const onCheckIn = await damage.compare(checkInId);
      expect(onCheckIn).toMatchObject({ available: false, pairs: [] });
      expect(onCheckIn.reason).toMatch(/check-out/);

      await db.query(
        `UPDATE inspections SET paired_inspection_id = NULL WHERE id = $1`,
        [checkOutId],
      );
      const unpaired = await damage.compare(checkOutId);
      expect(unpaired.available).toBe(false);
      expect(unpaired.reason).toMatch(/nothing to compare/);
    });

    it("refuses a check-out the driver has not submitted", async () => {
      await db.query(
        `UPDATE inspections SET status = 'link_sent', submitted_at = NULL WHERE id = $1`,
        [checkOutId],
      );
      expect((await damage.compare(checkOutId)).available).toBe(false);
    });

    it("404s for an unknown inspection", async () => {
      await expect(damage.compare(randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("mark and unmark", () => {
    it("marks a shot, flags the inspection and shows up in the compare", async () => {
      const item = await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_FRONT")!, description: "Cracked" },
        adminId,
      );
      expect(item).toMatchObject({
        shotId: "EXT_FRONT",
        source: "staff_flagged",
        status: "new_during_rental",
        description: "Cracked",
        createdByEmail: "admin@damage.test",
      });
      expect(await status(checkOutId)).toBe("flagged");
      const compare = await damage.compare(checkOutId);
      expect(
        compare.pairs.find((p) => p.shotId === "EXT_FRONT")?.damageItem?.id,
      ).toBe(item.id);
    });

    it("marks a driver's damage close-up as driver_reported", async () => {
      const compare = await damage.compare(checkOutId);
      const item = await damage.mark(
        checkOutId,
        {
          photoId: compare.checkOutDamage[0].photo.id,
          description: "Dent, rear door",
        },
        adminId,
      );
      expect(item.source).toBe("driver_reported");
      expect(
        (await damage.compare(checkOutId)).checkOutDamage[0].damageItem?.id,
      ).toBe(item.id);
    });

    it("refuses to mark the same photo twice", async () => {
      const body = {
        photoId: checkOutPhotos.get("EXT_WINDSHIELD")!,
        description: "Hail dent",
      };
      await damage.mark(checkOutId, body, adminId);
      await expect(
        damage.mark(checkOutId, body, adminId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        await db.query(`SELECT 1 FROM damage_items WHERE inspection_id = $1`, [
          checkOutId,
        ]),
      ).toHaveLength(1);
    });

    it("refuses a photo of another inspection, a check-in, and an unsubmitted check-out", async () => {
      await expect(
        damage.mark(
          checkOutId,
          { photoId: checkInPhotos.get("EXT_WINDSHIELD")!, description: "x" },
          adminId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        damage.mark(
          checkInId,
          { photoId: checkInPhotos.get("EXT_WINDSHIELD")!, description: "x" },
          adminId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await db.query(
        `UPDATE inspections SET status = 'in_progress', submitted_at = NULL WHERE id = $1`,
        [checkOutId],
      );
      await expect(
        damage.mark(
          checkOutId,
          { photoId: checkOutPhotos.get("EXT_WINDSHIELD")!, description: "x" },
          adminId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("refuses a check-out with no paired check-in", async () => {
      await db.query(
        `UPDATE inspections SET paired_inspection_id = NULL WHERE id = $1`,
        [checkOutId],
      );
      await expect(
        damage.mark(
          checkOutId,
          { photoId: checkOutPhotos.get("EXT_WINDSHIELD")!, description: "x" },
          adminId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("unmarking the last item puts the inspection back to submitted, or reviewed if it had been", async () => {
      const first = await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_WINDSHIELD")!, description: "a" },
        adminId,
      );
      await damage.unmark(first.id, adminId);
      expect(await status(checkOutId)).toBe("submitted");

      await db.query(
        `UPDATE inspections SET status = 'reviewed', reviewed_at = now(), reviewed_by_id = $2 WHERE id = $1`,
        [checkOutId, adminId],
      );
      const second = await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_WINDSHIELD")!, description: "b" },
        adminId,
      );
      expect(await status(checkOutId)).toBe("flagged");
      await damage.unmark(second.id, adminId);
      expect(await status(checkOutId)).toBe("reviewed");
    });

    it("stays flagged while another item is left", async () => {
      const a = await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_WINDSHIELD")!, description: "a" },
        adminId,
      );
      await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_REAR")!, description: "b" },
        adminId,
      );
      await damage.unmark(a.id, adminId);
      expect(await status(checkOutId)).toBe("flagged");
    });

    it("writes the log and the audit trail", async () => {
      const item = await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_WINDSHIELD")!, description: "a" },
        adminId,
      );
      await damage.unmark(item.id, adminId);
      const events = (await db.query(
        `SELECT type FROM inspection_events WHERE inspection_id = $1 AND type LIKE 'damage%' ORDER BY created_at, id`,
        [checkOutId],
      )) as { type: string }[];
      expect(events.map((e) => e.type)).toEqual([
        "damage_marked",
        "damage_cleared",
      ]);
      const audits = (await db.query(
        `SELECT action FROM audit_logs WHERE entity_type = 'damage_item' ORDER BY created_at, id`,
      )) as { action: string }[];
      expect(audits.map((a) => a.action)).toEqual([
        "damage_item.mark",
        "damage_item.unmark",
      ]);
    });

    it("rejects a blank description (the database check agrees)", async () => {
      await expect(
        db.query(
          `INSERT INTO damage_items (inspection_id, photo_id, description) VALUES ($1, $2, '   ')`,
          [checkOutId, checkOutPhotos.get("EXT_WINDSHIELD")!],
        ),
      ).rejects.toThrow(/damage_items_description_not_blank/);
    });
  });

  describe("charge", () => {
    const markHood = () =>
      damage.mark(
        checkOutId,
        {
          photoId: checkOutPhotos.get("EXT_WINDSHIELD")!,
          description: "Hail dent",
        },
        adminId,
      );

    it("makes exactly one ledger debit, links it and marks the item charged", async () => {
      const item = await markHood();
      const result = await damage.charge(item.id, chargeBody(), adminId);
      expect(result.entry).toMatchObject({
        direction: "debit",
        amountCents: 25_000,
      });
      expect(result.item).toMatchObject({
        status: "charged",
        ledgerEntryId: result.entry.id,
        ledgerRef: result.entry.ref,
        amountCents: 25_000,
      });
      expect(await debits()).toHaveLength(1);
      const events = (await db.query(
        `SELECT type FROM inspection_events WHERE inspection_id = $1 AND type = 'damage_charged'`,
        [checkOutId],
      )) as unknown[];
      expect(events).toHaveLength(1);
    });

    it("answers a repeat with the same key by the same entry and no second charge", async () => {
      const item = await markHood();
      const body = chargeBody();
      const first = await damage.charge(item.id, body, adminId);
      const again = await damage.charge(item.id, body, adminId);
      expect(again.entry.id).toBe(first.entry.id);
      expect(await debits()).toHaveLength(1);
    });

    it("refuses a second charge with another key", async () => {
      const item = await markHood();
      await damage.charge(item.id, chargeBody(), adminId);
      await expect(
        damage.charge(item.id, chargeBody(), adminId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await debits()).toHaveLength(1);
    });

    it("makes one charge when two admins press together", async () => {
      const item = await markHood();
      const results = await Promise.allSettled([
        damage.charge(item.id, chargeBody(), adminId),
        damage.charge(item.id, chargeBody(), adminId),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(await debits()).toHaveLength(1);
    });

    it("refuses a credit", async () => {
      const item = await markHood();
      await expect(
        damage.charge(
          item.id,
          chargeBody({ direction: LedgerDirection.credit }),
          adminId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await debits()).toHaveLength(0);
    });

    it("leaves the item uncharged when the ledger refuses the amount or the date", async () => {
      const item = await markHood();
      await expect(
        damage.charge(
          item.id,
          chargeBody({ effectiveDate: "2099-01-01" }),
          adminId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      const [row] = (await db.query(
        `SELECT status, ledger_entry_id AS "entry" FROM damage_items WHERE id = $1`,
        [item.id],
      )) as { status: string; entry: string | null }[];
      expect(row).toEqual({ status: "new_during_rental", entry: null });
      // ...and a corrected try works.
      await damage.charge(item.id, chargeBody(), adminId);
      expect(await debits()).toHaveLength(1);
    });

    it("404s for an unknown item", async () => {
      await expect(
        damage.charge(randomUUID(), chargeBody(), adminId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("cannot remove a charged item; a later reversal of the entry leaves it charged", async () => {
      const item = await markHood();
      const { entry } = await damage.charge(item.id, chargeBody(), adminId);
      await expect(damage.unmark(item.id, adminId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await ledger.reverse(driverId, entry.id, "Charged by mistake", adminId);
      const compare = await damage.compare(checkOutId);
      expect(
        compare.pairs.find((p) => p.shotId === "EXT_WINDSHIELD")?.damageItem,
      ).toMatchObject({ id: item.id, status: "charged" });
    });

    it("the database refuses two items sharing one charge, and a status that disagrees with the link", async () => {
      const first = await markHood();
      const second = await damage.mark(
        checkOutId,
        { photoId: checkOutPhotos.get("EXT_REAR")!, description: "Roof dent" },
        adminId,
      );
      const { entry } = await damage.charge(first.id, chargeBody(), adminId);
      await expect(
        db.query(
          `UPDATE damage_items SET status = 'charged', ledger_entry_id = $2 WHERE id = $1`,
          [second.id, entry.id],
        ),
      ).rejects.toThrow(/damage_items_ledger_entry_unique/);
      await expect(
        db.query(`UPDATE damage_items SET status = 'charged' WHERE id = $1`, [
          second.id,
        ]),
      ).rejects.toThrow(/damage_items_charged_iff_entry/);
    });
  });
});
