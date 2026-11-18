import { NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { DataSource } from "typeorm";
import { InspectionType } from "../src/inspections/inspection.entity.js";
import { InspectionsService } from "../src/inspections/inspections.service.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { SmsService } from "../src/sms/sms.service.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

/** A bucket that only signs links: records what it was asked to sign. */
class SigningStorage implements FileStorage {
  signed: { key: string; seconds: number; downloadName?: string }[] = [];
  put() {
    return Promise.resolve();
  }
  get(): Promise<Buffer> {
    return Promise.reject(new Error("not used"));
  }
  presignGet(
    key: string,
    seconds: number,
    options?: { downloadName?: string },
  ) {
    this.signed.push({ key, seconds, downloadName: options?.downloadName });
    return Promise.resolve(
      `https://bucket.test/${key}?exp=${seconds}${options?.downloadName ? `&dl=${options.downloadName}` : ""}`,
    );
  }
  delete() {
    return Promise.resolve();
  }
}

const SITE = "https://app.test/";

describe("vehicle inspections, staff photo viewer (Module 3 chat 2 step 1, test database)", () => {
  let db: DataSource;
  let adminId: string;
  let driverId: string;
  let storage: SigningStorage;
  let service: InspectionsService;

  const build = (bucket: FileStorage | null) =>
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
      { getOrThrow: () => SITE } as unknown as ConfigService,
      bucket,
    );

  const makeInspection = async () => {
    const made = await service.create(
      driverId,
      {
        type: InspectionType.checkIn,
        vehicle: { model: "2021 Toyota Camry", plate: "AB 12345" },
      },
      adminId,
    );
    await db.query(
      `UPDATE inspections SET status = 'submitted', submitted_at = now(), attested_at = now(), odometer_miles = 84213,
              fuel_level = '3_4', gps_lat = 41.88, gps_lng = -87.63, device_info = 'Pixel 8 Chrome' WHERE id = $1`,
      [made.id],
    );
    return made;
  };

  let counter = 0;
  const addPhoto = (
    inspectionId: string,
    shotId: string,
    position = 1,
    note: string | null = null,
    parentShotId: string | null = null,
  ) => {
    counter += 1;
    const slot = `${parentShotId ?? ""}${shotId}_${position}`;
    return db.query(
      `INSERT INTO inspection_photos (inspection_id, shot_id, position, storage_key, thumb_key, captured_at, driver_note, sha256, retake_count, parent_shot_id)
       VALUES ($1, $2, $3, $4, $5, '2026-11-16T14:00:00Z', $6, $7, 1, $8)`,
      [
        inspectionId,
        shotId,
        position,
        `inspections/${inspectionId}/${slot}.jpg`,
        `inspections/${inspectionId}/thumbs/${slot}.jpg`,
        note,
        counter.toString(16).padStart(64, "0"),
        parentShotId,
      ],
    );
  };

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE inspection_events, inspection_photos, inspections, sms_messages, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@viewer.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Maria', 'Driver', 'maria@viewer.test', '+13125550102') RETURNING id`,
    )) as [{ id: string }];
    storage = new SigningStorage();
    service = build(storage);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("returns the readings, the place and the device with the detail", async () => {
    const made = await makeInspection();
    const detail = await service.findOne(made.id);
    expect(detail).toMatchObject({
      odometerMiles: 84213,
      fuelLevel: "3_4",
      gpsLat: 41.88,
      gpsLng: -87.63,
      deviceInfo: "Pixel 8 Chrome",
      photos: [],
    });
    expect(detail.attestedAt).toBeInstanceOf(Date);
  });

  it("lists the 19 shots in their order, then the damage photos by number, whatever order they arrived in", async () => {
    const made = await makeInspection();
    await addPhoto(made.id, "DAMAGE", 2, "second dent");
    await addPhoto(made.id, "INT_FUEL"); // shot 19
    await addPhoto(made.id, "EXT_FRONT"); // shot 5
    await addPhoto(made.id, "DAMAGE", 1, "first dent");
    await addPhoto(made.id, "EXT_DRIVER_SIDE"); // shot 1
    const { photos } = await service.findOne(made.id);
    expect(photos.map((p) => `${p.shotId}:${p.position}`)).toEqual([
      "EXT_DRIVER_SIDE:1",
      "EXT_FRONT:1",
      "INT_FUEL:1",
      "DAMAGE:1",
      "DAMAGE:2",
    ]);
    expect(photos[3].driverNote).toBe("first dent");
  });

  it("gives every photo three signed links that last ten minutes, and never the storage key", async () => {
    const made = await makeInspection();
    await addPhoto(made.id, "EXT_FRONT");
    const [photo] = (await service.findOne(made.id)).photos;
    expect(photo.thumbUrl).toBe(
      `https://bucket.test/inspections/${made.id}/thumbs/EXT_FRONT_1.jpg?exp=600`,
    );
    expect(photo.fullUrl).toBe(
      `https://bucket.test/inspections/${made.id}/EXT_FRONT_1.jpg?exp=600`,
    );
    expect(photo.downloadUrl).toContain("&dl=");
    expect(photo).not.toHaveProperty("storageKey");
    expect(photo).not.toHaveProperty("thumbKey");
    expect(storage.signed.every((s) => s.seconds === 600)).toBe(true);
  });

  it("puts each shot's close-ups right after it, and tells which shot they belong to (D112)", async () => {
    const made = await makeInspection();
    await addPhoto(made.id, "DAMAGE", 2, "deep", "EXT_FRONT");
    await addPhoto(made.id, "EXT_REAR");
    await addPhoto(made.id, "DAMAGE", 1, null, "EXT_REAR");
    await addPhoto(made.id, "EXT_FRONT");
    await addPhoto(made.id, "DAMAGE", 1, "light", "EXT_FRONT");
    await addPhoto(made.id, "DAMAGE", 4, "old style"); // before D112: no shot
    await db.query(
      `INSERT INTO inspection_shot_answers (inspection_id, shot_id, has_damage) VALUES ($1, 'EXT_FRONT', true), ($1, 'EXT_REAR', true), ($1, 'EXT_WINDSHIELD', false)`,
      [made.id],
    );
    const detail = await service.findOne(made.id);
    expect(
      detail.photos.map(
        (p) => `${p.shotId}:${p.parentShotId ?? "-"}:${p.position}`,
      ),
    ).toEqual([
      "EXT_FRONT:-:1",
      "DAMAGE:EXT_FRONT:1",
      "DAMAGE:EXT_FRONT:2",
      "EXT_REAR:-:1",
      "DAMAGE:EXT_REAR:1",
      "DAMAGE:-:4",
    ]);
    expect(detail.answers).toEqual(
      expect.arrayContaining([
        { shotId: "EXT_FRONT", hasDamage: true },
        { shotId: "EXT_REAR", hasDamage: true },
        { shotId: "EXT_WINDSHIELD", hasDamage: false },
      ]),
    );
    expect(detail.answers).toHaveLength(3);
    expect(detail.photoCount).toBe(2);
    expect(detail.damagePhotoCount).toBe(4);
    expect(detail.requiredPhotoCount).toBe(21);
  });

  it("names a download after the reference and the shot, its close-up number, or an old damage number", async () => {
    const made = await makeInspection();
    await addPhoto(made.id, "EXT_FRONT"); // the 5th shot
    await addPhoto(made.id, "DAMAGE", 2, null, "EXT_FRONT");
    await addPhoto(made.id, "DAMAGE", 3);
    await service.findOne(made.id);
    const names = storage.signed
      .map((s) => s.downloadName)
      .filter((n): n is string => !!n);
    expect(names).toEqual([
      `${made.reference}_05_EXT_FRONT.jpg`,
      `${made.reference}_05_EXT_FRONT_damage_2.jpg`,
      `${made.reference}_damage_3.jpg`,
    ]);
  });

  it("keeps the photo facts a dispute needs: capture time, upload time, retakes, fingerprint", async () => {
    const made = await makeInspection();
    await addPhoto(made.id, "EXT_FRONT");
    const [photo] = (await service.findOne(made.id)).photos;
    expect(photo.capturedAt).toEqual(new Date("2026-11-16T14:00:00Z"));
    expect(photo.uploadedAt).toBeInstanceOf(Date);
    expect(photo.retakeCount).toBe(1);
    expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has no links when no bucket is set up, and still lists the photos", async () => {
    const made = await makeInspection();
    await addPhoto(made.id, "EXT_FRONT");
    const bare = build(null);
    const [photo] = (await bare.findOne(made.id)).photos;
    expect(photo).toMatchObject({
      shotId: "EXT_FRONT",
      thumbUrl: null,
      fullUrl: null,
      downloadUrl: null,
    });
  });

  it("only shows the photos of the inspection asked for", async () => {
    const first = await makeInspection();
    await addPhoto(first.id, "EXT_FRONT");
    await db.query(`DELETE FROM inspection_photos`); // free the slot name; the second has none
    const second = await service.create(
      driverId,
      {
        type: InspectionType.checkOut,
        vehicle: { model: "2021 Toyota Camry" },
      },
      adminId,
    );
    await addPhoto(first.id, "EXT_FRONT");
    expect((await service.findOne(second.id)).photos).toEqual([]);
    expect((await service.findOne(first.id)).photos).toHaveLength(1);
  });

  it("is a 404 for an unknown inspection", async () => {
    await expect(
      service.findOne("00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(NotFoundException);
  });
});
