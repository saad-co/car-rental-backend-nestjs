import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { DataSource } from "typeorm";
import { InspectionExportService } from "../src/inspections/inspection-export.service.js";
import { pdfSafe } from "../src/inspections/inspection-report.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

class FakeStorage implements FileStorage {
  files = new Map<string, Buffer>();
  /** Keys the bucket "loses": reading them fails. */
  broken = new Set<string>();
  put(key: string, body: Buffer) {
    this.files.set(key, body);
    return Promise.resolve();
  }
  get(key: string) {
    const file = this.files.get(key);
    return file && !this.broken.has(key)
      ? Promise.resolve(file)
      : Promise.reject(new Error(`no file ${key}`));
  }
  presignGet(key: string) {
    return Promise.resolve(`https://bucket.test/${key}?signed`);
  }
  delete(key: string) {
    this.files.delete(key);
    return Promise.resolve();
  }
}

/** The names and bytes in a ZIP, read back through its central directory. */
function readZip(zip: Buffer) {
  const endAt = zip.length - 22;
  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    expect(zip.readUInt32LE(at + 16)).toBe(
      crc32(
        zip.subarray(
          localAt + 30 + zip.readUInt16LE(localAt + 26),
          localAt + 30 + zip.readUInt16LE(localAt + 26) + size,
        ),
      ),
    );
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26);
    files.set(name, zip.subarray(dataAt, dataAt + size));
    at += 46 + nameLength;
  }
  return files;
}

describe("vehicle inspections, ZIP and PDF export (Module 3 chat 2 step 4, test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;
  let service: InspectionExportService;
  let adminId: string;
  let driverId: string;
  let inspectionId: string;
  let thumb: Buffer;

  const audits = async () =>
    (await db.query(
      `SELECT action, after FROM audit_logs WHERE entity_type = 'inspection' ORDER BY created_at, id`,
    )) as { action: string; after: Record<string, unknown> }[];

  /** A photo row plus its two files in the fake bucket. Returns the original's bytes. */
  const addPhoto = async (
    shotId: string,
    position = 1,
    note: string | null = null,
  ) => {
    const original = Buffer.from(`original-${shotId}-${position}`);
    const storageKey = `inspections/${inspectionId}/${shotId}-${position}.jpg`;
    const thumbKey = `inspections/${inspectionId}/${shotId}-${position}.thumb.jpg`;
    storage.files.set(storageKey, original);
    storage.files.set(thumbKey, thumb);
    await db.query(
      `INSERT INTO inspection_photos (inspection_id, shot_id, position, storage_key, thumb_key, driver_note, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        inspectionId,
        shotId,
        position,
        storageKey,
        thumbKey,
        note,
        "b".repeat(64),
      ],
    );
    return { original, storageKey, thumbKey };
  };

  beforeAll(async () => {
    db = await openTestDatabase();
    thumb = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#3b82f6" },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE damage_items, inspection_events, inspection_photos, inspections, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@export.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Eva', 'Driver', 'eva@export.test', '+13125550105') RETURNING id`,
    )) as [{ id: string }];
    [{ id: inspectionId }] = (await db.query(
      `INSERT INTO inspections (reference, type, status, driver_id, vehicle_model, vehicle_plate, token_hash, token_expires_at,
                                submitted_at, attested_at, odometer_miles, fuel_level, gps_lat, gps_lng, device_info)
       VALUES ($1, 'check_in', 'submitted', $2, '2021 Toyota Camry', 'AB 12345', $3, now(), now(), now(), 84213, '3_4',
               41.88, -87.63, 'Safari on iPhone')
       RETURNING id`,
      [
        `INS-2026-9${Math.floor(Math.random() * 90000) + 10000}`,
        driverId,
        randomUUID().replace(/-/g, "").padEnd(64, "0"),
      ],
    )) as [{ id: string }];
    storage = new FakeStorage();
    service = new InspectionExportService(db, storage);
    service.now = () => new Date("2026-11-17T18:00:00Z");
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("ZIP", () => {
    it("holds every original under <reference>/NN_SHOT.jpg and damage_N.jpg, byte for byte", async () => {
      const front = await addPhoto("EXT_FRONT");
      const side = await addPhoto("EXT_DRIVER_SIDE");
      const damage = await addPhoto("DAMAGE", 2, "Scratch");
      const { fileName, data } = await service.zip(inspectionId, adminId);
      const [{ reference }] = (await db.query(
        `SELECT reference FROM inspections WHERE id = $1`,
        [inspectionId],
      )) as { reference: string }[];
      expect(fileName).toBe(`${reference}.zip`);
      const files = readZip(data);
      expect([...files.keys()]).toEqual([
        `${reference}/01_EXT_DRIVER_SIDE.jpg`,
        `${reference}/04_EXT_FRONT.jpg`,
        `${reference}/damage_2.jpg`,
      ]);
      expect(
        files.get(`${reference}/01_EXT_DRIVER_SIDE.jpg`)!.equals(side.original),
      ).toBe(true);
      expect(
        files.get(`${reference}/04_EXT_FRONT.jpg`)!.equals(front.original),
      ).toBe(true);
      expect(
        files.get(`${reference}/damage_2.jpg`)!.equals(damage.original),
      ).toBe(true);
    });

    it("leaves out a photo the bucket cannot give and says so inside the ZIP and in the audit trail", async () => {
      await addPhoto("EXT_FRONT");
      const lost = await addPhoto("EXT_REAR");
      storage.broken.add(lost.storageKey);
      const { data } = await service.zip(inspectionId, adminId);
      const files = readZip(data);
      const names = [...files.keys()];
      expect(names.some((n) => n.endsWith("04_EXT_FRONT.jpg"))).toBe(true);
      expect(names.some((n) => n.endsWith("EXT_REAR.jpg"))).toBe(false);
      const missing = [...files.entries()].find(([n]) =>
        n.endsWith("MISSING.txt"),
      );
      expect(missing?.[1].toString()).toContain("11_EXT_REAR.jpg");
      expect((await audits()).at(-1)).toMatchObject({
        action: "inspection.export_zip",
        after: { photos: 1, missing: 1 },
      });
    });

    it("writes one audit line per export", async () => {
      await addPhoto("EXT_FRONT");
      await service.zip(inspectionId, adminId);
      await service.zip(inspectionId, adminId);
      expect((await audits()).map((a) => a.action)).toEqual([
        "inspection.export_zip",
        "inspection.export_zip",
      ]);
    });

    it("refuses an inspection with no photos, an unknown one, and a missing bucket", async () => {
      await expect(service.zip(inspectionId, adminId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.zip(randomUUID(), adminId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        new InspectionExportService(db, null).zip(inspectionId, adminId),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await audits()).toEqual([]);
    });
  });

  describe("PDF report", () => {
    it("makes a readable PDF with the photos, and an audit line", async () => {
      for (const shot of [
        "EXT_DRIVER_SIDE",
        "EXT_FRONT",
        "EXT_REAR",
        "INT_ODOMETER",
      ])
        await addPhoto(shot);
      await addPhoto("DAMAGE", 1, "Rayón en la puerta — 車 “scratch”");
      const { fileName, data } = await service.report(inspectionId, adminId);
      expect(fileName.endsWith(".pdf")).toBe(true);
      expect(data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const pdf = await PDFDocument.load(data);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
      expect((await audits()).at(-1)).toMatchObject({
        action: "inspection.export_pdf",
        after: { photos: 5, unreadable: 0 },
      });
    });

    it("still makes the report when a thumbnail cannot be read, and counts it", async () => {
      await addPhoto("EXT_FRONT");
      const lost = await addPhoto("EXT_REAR");
      storage.broken.add(lost.thumbKey);
      const { data } = await service.report(inspectionId, adminId);
      expect(data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect((await audits()).at(-1)?.after).toMatchObject({ unreadable: 1 });
    });

    it("counts a thumbnail that was read but cannot be drawn (not a JPEG), instead of dropping it silently", async () => {
      await addPhoto("EXT_FRONT");
      const bad = await addPhoto("EXT_REAR");
      storage.files.set(bad.thumbKey, Buffer.from("<Error>not a jpeg</Error>"));
      const { data } = await service.report(inspectionId, adminId);
      expect(data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect((await audits()).at(-1)?.after).toMatchObject({ unreadable: 1 });
    });

    it("works with no photos, spreads 19 photos over more than one page, and handles a long note", async () => {
      const empty = await PDFDocument.load(
        (await service.report(inspectionId, adminId)).data,
      );
      expect(empty.getPageCount()).toBe(1);

      const shots = (await db.query(
        `SELECT shot_id AS "shotId" FROM inspection_shots ORDER BY position`,
      )) as { shotId: string }[];
      for (const { shotId } of shots) await addPhoto(shotId);
      await addPhoto("DAMAGE", 1, "x".repeat(190));
      const full = await PDFDocument.load(
        (await service.report(inspectionId, adminId)).data,
      );
      expect(full.getPageCount()).toBeGreaterThan(1);
    });

    it("includes the damage staff marked and its charge without failing", async () => {
      const [{ id: outId }] = (await db.query(
        `INSERT INTO inspections (reference, type, status, driver_id, vehicle_model, token_hash, token_expires_at,
                                  submitted_at, attested_at, odometer_miles, fuel_level, paired_inspection_id)
         VALUES ('INS-2026-988888', 'check_out', 'flagged', $1, '2021 Toyota Camry', $2, now(), now(), now(), 85000, '1_2', $3)
         RETURNING id`,
        [driverId, "c".repeat(64), inspectionId],
      )) as [{ id: string }];
      const [{ id: photoId }] = (await db.query(
        `INSERT INTO inspection_photos (inspection_id, shot_id, position, storage_key, thumb_key, sha256)
         VALUES ($1, 'EXT_FRONT', 1, 'k', 't', $2) RETURNING id`,
        [outId, "d".repeat(64)],
      )) as [{ id: string }];
      storage.files.set("k", Buffer.from("o"));
      storage.files.set("t", thumb);
      await db.query(
        `INSERT INTO damage_items (inspection_id, photo_id, description) VALUES ($1, $2, 'Cracked bumper')`,
        [outId, photoId],
      );
      const { data } = await service.report(outId, adminId);
      expect(data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });
  });

  describe("pdfSafe", () => {
    it("keeps Latin-1, turns typographic marks into plain ones, and never leaves a character the font cannot draw", () => {
      expect(pdfSafe("Rayón “nuevo” — ok…")).toBe('Rayón "nuevo" - ok...');
      expect(pdfSafe("車")).toBe("?");
      expect(pdfSafe("line\nbreak")).toBe("line break");
    });
  });
});
