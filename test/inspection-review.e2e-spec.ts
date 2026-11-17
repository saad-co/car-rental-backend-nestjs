import { ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import {
  AddInspectionNoteDto,
  ReviewInspectionDto,
} from "../src/inspections/dto/inspection.dto.js";
import { InspectionType } from "../src/inspections/inspection.entity.js";
import { InspectionsService } from "../src/inspections/inspections.service.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { SmsService } from "../src/sms/sms.service.js";
import { openTestDatabase } from "./test-database.js";

const T0 = new Date("2026-11-16T15:00:00Z");
const HOUR = 3_600_000;

describe("vehicle inspections, staff review (Module 3 chat 2 step 2, test database)", () => {
  let db: DataSource;
  let adminId: string;
  let otherAdminId: string;
  let driverId: string;
  let clock: Date;
  let service: InspectionsService;

  const build = () => {
    const built = new InspectionsService(
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
    built.now = () => clock;
    return built;
  };

  const make = (type = InspectionType.checkIn) =>
    service.create(
      driverId,
      { type, vehicle: { model: "2021 Toyota Camry" } },
      adminId,
    );
  /** Makes an inspection and puts it in the state a finished one has. */
  const submitted = async (
    type = InspectionType.checkIn,
    at = new Date(T0.getTime() - HOUR),
  ) => {
    const made = await make(type);
    await db.query(
      `UPDATE inspections SET status = 'submitted', submitted_at = $2, attested_at = $2, odometer_miles = 1000, fuel_level = 'full' WHERE id = $1`,
      [made.id, at],
    );
    return made;
  };
  const setStatus = (id: string, status: string) =>
    db.query(`UPDATE inspections SET status = $2 WHERE id = $1`, [id, status]);
  const logTypes = async (id: string) =>
    (
      (await db.query(
        `SELECT type FROM inspection_events WHERE inspection_id = $1 ORDER BY created_at, id`,
        [id],
      )) as { type: string }[]
    ).map((e) => e.type);
  const audits = async () =>
    (
      (await db.query(
        `SELECT action FROM audit_logs WHERE entity_type = 'inspection' ORDER BY created_at, id`,
      )) as { action: string }[]
    ).map((a) => a.action);

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE inspection_events, inspection_photos, inspections, sms_messages, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@review.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: otherAdminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('other@review.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Maria', 'Driver', 'maria@review.test', '+13125550103') RETURNING id`,
    )) as [{ id: string }];
    clock = T0;
    service = build();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("marking reviewed", () => {
    it("records who, when and the note, and writes the log and the audit trail", async () => {
      const made = await submitted();
      const result = await service.review(
        made.id,
        { note: "All good." },
        adminId,
      );
      expect(result).toMatchObject({ status: "reviewed", reviewedAt: T0 });
      const detail = await service.findOne(made.id);
      expect(detail).toMatchObject({
        reviewedByEmail: "admin@review.test",
        reviewNote: "All good.",
      });
      expect(await logTypes(made.id)).toEqual(["created", "reviewed"]);
      expect(await audits()).toEqual([
        "inspection.create",
        "inspection.review",
      ]);
    });

    it("works without a note", async () => {
      const made = await submitted();
      await service.review(made.id, {}, adminId);
      expect((await service.findOne(made.id)).reviewNote).toBeNull();
    });

    it("also reviews a flagged inspection", async () => {
      const made = await submitted();
      await setStatus(made.id, "flagged");
      expect(await service.review(made.id, {}, adminId)).toMatchObject({
        status: "reviewed",
      });
    });

    it("refuses a second review and keeps the first reviewer", async () => {
      const made = await submitted();
      await service.review(made.id, { note: "first" }, adminId);
      await expect(
        service.review(made.id, { note: "second" }, otherAdminId),
      ).rejects.toThrow(ConflictException);
      const detail = await service.findOne(made.id);
      expect(detail.reviewedByEmail).toBe("admin@review.test");
      expect(detail.reviewNote).toBe("first");
    });

    it("two admins pressing at once review it once", async () => {
      const made = await submitted();
      const results = await Promise.allSettled([
        service.review(made.id, {}, adminId),
        service.review(made.id, {}, otherAdminId),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (await logTypes(made.id)).filter((t) => t === "reviewed"),
      ).toHaveLength(1);
    });

    it.each(["created", "link_sent", "opened", "in_progress", "revoked"])(
      "refuses an inspection that is %s",
      async (status) => {
        const made = await make();
        await setStatus(made.id, status);
        await expect(service.review(made.id, {}, adminId)).rejects.toThrow(
          /Only a submitted inspection/,
        );
        expect(await logTypes(made.id)).toEqual(["created"]);
      },
    );

    it("is a 404 for an unknown inspection", async () => {
      await expect(
        service.review("00000000-0000-4000-8000-000000000000", {}, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it("limits the note to 500 characters and trims it", () => {
      const check = (note: unknown) =>
        validateSync(plainToInstance(ReviewInspectionDto, { note }));
      expect(check("a".repeat(500))).toHaveLength(0);
      expect(check("a".repeat(501))).toHaveLength(1);
      const trimmed = plainToInstance(ReviewInspectionDto, { note: "  ok  " });
      expect(trimmed.note).toBe("ok");
      const blank = plainToInstance(ReviewInspectionDto, { note: "   " });
      expect(blank.note).toBeNull();
    });
  });

  describe("staff notes", () => {
    it("adds a line to the log with the text and the author, and an audit line", async () => {
      const made = await submitted();
      const note = await service.addNote(
        made.id,
        { text: "Rear bumper scuff looks old." },
        adminId,
      );
      expect(note).toMatchObject({
        type: "staff_note",
        actorEmail: "admin@review.test",
        meta: { text: "Rear bumper scuff looks old." },
      });
      const detail = await service.findOne(made.id);
      expect(detail.events.map((e) => e.type)).toEqual([
        "created",
        "staff_note",
      ]);
      expect(await audits()).toEqual(["inspection.create", "inspection.note"]);
    });

    it("keeps every note, oldest first, whoever wrote it", async () => {
      const made = await submitted();
      await service.addNote(made.id, { text: "one" }, adminId);
      clock = new Date(T0.getTime() + 1000);
      await service.addNote(made.id, { text: "two" }, otherAdminId);
      const notes = (await service.findOne(made.id)).events.filter(
        (e) => e.type === "staff_note",
      );
      expect(notes.map((n) => [n.meta?.text, n.actorEmail])).toEqual([
        ["one", "admin@review.test"],
        ["two", "other@review.test"],
      ]);
    });

    it("is allowed on any state, even a revoked inspection", async () => {
      const made = await make();
      await setStatus(made.id, "revoked");
      await expect(
        service.addNote(
          made.id,
          { text: "Driver quit before pickup." },
          adminId,
        ),
      ).resolves.toMatchObject({ type: "staff_note" });
    });

    it("is a 404 for an unknown inspection", async () => {
      await expect(
        service.addNote(
          "00000000-0000-4000-8000-000000000000",
          { text: "x" },
          adminId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("needs 1 to 500 characters after trimming", () => {
      const check = (text: unknown) =>
        validateSync(plainToInstance(AddInspectionNoteDto, { text }));
      expect(check("ok")).toHaveLength(0);
      expect(check("a".repeat(500))).toHaveLength(0);
      expect(check("a".repeat(501))).toHaveLength(1);
      expect(check("")).toHaveLength(1);
      expect(check("    ")).toHaveLength(1);
      expect(check(undefined)).toHaveLength(1);
    });
  });

  describe("needs attention (flagged, or unreviewed for more than 24 hours)", () => {
    const attention = async (id: string) =>
      (await service.findOne(id)).needsAttention;

    it("is false just inside 24 hours and true just after", async () => {
      const made = await submitted(InspectionType.checkIn, T0);
      clock = new Date(T0.getTime() + 24 * HOUR);
      expect(await attention(made.id)).toBe(false); // exactly 24 hours is not "over"
      clock = new Date(T0.getTime() + 24 * HOUR + 1000);
      expect(await attention(made.id)).toBe(true);
    });

    it("stops once it is reviewed, however old", async () => {
      const made = await submitted(InspectionType.checkIn, T0);
      clock = new Date(T0.getTime() + 72 * HOUR);
      expect(await attention(made.id)).toBe(true);
      await service.review(made.id, {}, adminId);
      expect(await attention(made.id)).toBe(false);
    });

    it("is always true for a flagged one", async () => {
      const made = await submitted();
      await setStatus(made.id, "flagged");
      expect(await attention(made.id)).toBe(true);
    });

    it("is false for an inspection that is not submitted yet, however old", async () => {
      const made = await make();
      clock = new Date(T0.getTime() + 100 * HOUR);
      expect(await attention(made.id)).toBe(false);
    });

    it("shows in the driver's list too", async () => {
      const made = await submitted(InspectionType.checkIn, T0);
      clock = new Date(T0.getTime() + 30 * HOUR);
      const list = await service.list(driverId, { page: 1, limit: 5 });
      expect(list.items.find((i) => i.id === made.id)?.needsAttention).toBe(
        true,
      );
    });
  });

  describe("the latest check-in and check-out", () => {
    it("has nothing for a driver with no inspections", async () => {
      expect(await service.latest(driverId)).toEqual({
        checkIn: null,
        checkOut: null,
      });
    });

    it("returns one of each type", async () => {
      const checkIn = await submitted(InspectionType.checkIn);
      const checkOut = await make(InspectionType.checkOut);
      const latest = await service.latest(driverId);
      expect(latest.checkIn?.id).toBe(checkIn.id);
      expect(latest.checkOut?.id).toBe(checkOut.id);
    });

    it("takes the newest of a type", async () => {
      const older = await submitted(InspectionType.checkIn);
      // A second check-in can be made once the first is submitted. The database stamps both with its own clock, so the
      // two times are set by hand.
      const newer = await make(InspectionType.checkIn);
      await db.query(`UPDATE inspections SET created_at = $2 WHERE id = $1`, [
        older.id,
        T0,
      ]);
      await db.query(`UPDATE inspections SET created_at = $2 WHERE id = $1`, [
        newer.id,
        new Date(T0.getTime() + HOUR),
      ]);
      expect((await service.latest(driverId)).checkIn?.id).toBe(newer.id);
    });

    it("leaves out a revoked one", async () => {
      const kept = await submitted(InspectionType.checkIn);
      const gone = await make(InspectionType.checkOut);
      await setStatus(gone.id, "revoked");
      const latest = await service.latest(driverId);
      expect(latest.checkIn?.id).toBe(kept.id);
      expect(latest.checkOut).toBeNull();
    });

    it("does not mix up drivers", async () => {
      const [{ id: other }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone)
         VALUES ('Omar', 'Other', 'omar@review.test', '+13125550104') RETURNING id`,
      )) as [{ id: string }];
      await submitted(InspectionType.checkIn);
      expect(await service.latest(other)).toEqual({
        checkIn: null,
        checkOut: null,
      });
    });

    it("is a 404 for an unknown driver", async () => {
      await expect(
        service.latest("00000000-0000-4000-8000-000000000000"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
