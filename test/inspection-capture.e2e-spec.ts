import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { DataSource } from "typeorm";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { SettingsService } from "../src/settings/settings.service.js";
import {
  SubmitInspectionDto,
  UploadPhotoDto,
} from "../src/inspections/dto/capture.dto.js";
import { InspectionCaptureService } from "../src/inspections/inspection-capture.service.js";
import { InspectionType } from "../src/inspections/inspection.entity.js";
import { InspectionsService } from "../src/inspections/inspections.service.js";
import { SmsService } from "../src/sms/sms.service.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

/** A bucket in memory. */
class FakeStorage implements FileStorage {
  files = new Map<string, { body: Buffer; contentType: string | null }>();
  puts = 0;
  failPuts = false;
  put(key: string, body: Buffer, contentType: string | null) {
    if (this.failPuts) return Promise.reject(new Error("bucket down"));
    this.puts++;
    this.files.set(key, { body, contentType });
    return Promise.resolve();
  }
  get(key: string) {
    const file = this.files.get(key);
    return file
      ? Promise.resolve(file.body)
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

const SHOTS = [
  "EXT_DRIVER_SIDE",
  "EXT_LEFT_FRONT_CORNER",
  "TIRE_FRONT_LEFT",
  "EXT_FRONT",
  "EXT_WINDSHIELD",
  "EXT_RIGHT_FRONT_CORNER",
  "TIRE_FRONT_RIGHT",
  "EXT_PASSENGER_SIDE",
  "EXT_RIGHT_REAR_CORNER",
  "TIRE_REAR_RIGHT",
  "EXT_REAR",
  "TRUNK_INTERIOR",
  "TRUNK_SPARE_JACK",
  "EXT_LEFT_REAR_CORNER",
  "TIRE_REAR_LEFT",
  "INT_ODOMETER",
  "INT_FUEL",
  "INT_FRONT_SEATS",
  "INT_REAR_SEATS",
];

const T0 = new Date("2026-11-16T15:00:00Z");
const sha = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

/** A real JPEG (the server decodes it to make the thumbnail). */
const jpeg = (r: number, width = 1200, height = 900) =>
  sharp({
    create: { width, height, channels: 3, background: { r, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();

/** What multer hands the service for one uploaded file. */
const upload = (buffer: Buffer): Express.Multer.File =>
  ({
    buffer,
    size: buffer.length,
    originalname: "photo.jpg",
  }) as Express.Multer.File;

/** Runs what the global ValidationPipe runs on the multipart text fields. */
const body = (raw: Record<string, unknown> = {}) =>
  plainToInstance(UploadPhotoDto, raw);
const problems = (raw: Record<string, unknown>) =>
  validateSync(body(raw), { whitelist: true, forbidNonWhitelisted: true }).map(
    (e) => e.property,
  );

describe("the driver's capture routes (Module 3 step 3, test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;
  let capture: InspectionCaptureService;
  let staff: InspectionsService;
  let clock: Date;
  let adminId: string;
  let driverId: string;
  let supportPhone: string | undefined;

  /** A check-in with a live link; returns its id and token. */
  async function openInspection(
    type = InspectionType.checkIn,
    id = driverId,
  ): Promise<{ id: string; token: string }> {
    const made = await staff.create(
      id,
      {
        type,
        vehicle: {
          model: "2021 Toyota Camry",
          plate: "AB 12345",
          vin: "4T1B11HK5KU123456",
        },
      },
      adminId,
    );
    const { link } = await staff.reissue(made.id, adminId);
    return { id: made.id, token: link.split("/i/")[1] };
  }

  /** Uploads every required shot, with the two readings. */
  async function uploadAll(token: string, skip: string[] = []) {
    const photo = await jpeg(150);
    for (const shotId of SHOTS) {
      if (skip.includes(shotId)) continue;
      await capture.uploadPhoto(
        token,
        shotId,
        body({
          ...(shotId === "INT_ODOMETER" ? { odometerMiles: "84213" } : {}),
          ...(shotId === "INT_FUEL" ? { fuelLevel: "3_4" } : {}),
        }),
        upload(photo),
      );
    }
  }

  const row = async (id: string) =>
    (
      (await db.query(`SELECT * FROM inspections WHERE id = $1`, [
        id,
      ])) as Record<string, unknown>[]
    )[0];
  const photos = (id: string) =>
    db.query(
      `SELECT * FROM inspection_photos WHERE inspection_id = $1 ORDER BY shot_id, position`,
      [id],
    ) as Promise<Record<string, unknown>[]>;
  const events = async (id: string) =>
    (
      (await db.query(
        `SELECT type FROM inspection_events WHERE inspection_id = $1 ORDER BY created_at, id`,
        [id],
      )) as { type: string }[]
    ).map((e) => e.type);
  const revoke = (id: string) => staff.revoke(id, adminId);

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE inspection_events, inspection_photos, inspections, sms_messages, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@capture.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Maria', 'Driver', 'maria@capture.test', '+13125550101') RETURNING id`,
    )) as [{ id: string }];
    storage = new FakeStorage();
    clock = T0;
    supportPhone = undefined;
    const config = {
      getOrThrow: () => "https://app.test",
      get: (key: string) =>
        key === "INSPECTION_SUPPORT_PHONE" ? supportPhone : undefined,
    } as unknown as ConfigService;
    capture = new InspectionCaptureService(db, storage, config);
    capture.now = () => clock;
    staff = new InspectionsService(
      db,
      new SmsService(db, {
        mode: "dry_run",
        quo: null,
        phoneNumberId: null,
        quoApiKey: null,
        storage: null,
      }),
      new SettingsService(db.getRepository(AppSetting)),
      config,
    );
    staff.now = () => clock;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the state of a link", () => {
    it("reads 'expired' for a token we never issued, and for text that cannot be a token", async () => {
      for (const token of [
        "A".repeat(43),
        "short",
        "",
        "../../etc/passwd",
        `${"a".repeat(42)}'`,
      ]) {
        const state = await capture.state(token);
        expect(state.state).toBe("expired");
        expect(state.reference).toBeNull();
        expect(state.photos).toEqual([]);
      }
    });

    it("gives the page what it needs for an open link", async () => {
      const { token } = await openInspection();
      const state = await capture.state(token);
      expect(state).toMatchObject({
        state: "open",
        type: "check_in",
        language: "en",
        vehicle: {
          model: "2021 Toyota Camry",
          plate: "AB 12345",
          vinLast4: "3456",
        },
        photos: [],
        odometerMiles: null,
        fuelLevel: null,
        priorDamage: [],
        maxDamagePhotos: 15,
        supportPhone: null,
      });
      expect(state.reference).toMatch(/^INS-2026-\d{6}$/);
      expect(state.shots.map((s) => s.shotId)).toEqual(SHOTS);
      expect(state.shots.every((s) => s.required)).toBe(true);
      expect(state.expiresAt).toEqual(new Date(T0.getTime() + 24 * 3_600_000));
    });

    it("never gives out the full VIN", async () => {
      const { token } = await openInspection();
      expect(JSON.stringify(await capture.state(token))).not.toContain(
        "4T1B11HK5KU123456",
      );
    });

    it("shows the driver's saved language and the support number when one is set", async () => {
      await db.query(`UPDATE drivers SET preferred_language = 'es'`);
      supportPhone = "+13125550199";
      const { token } = await openInspection();
      const state = await capture.state(token);
      expect(state.language).toBe("es");
      expect(state.supportPhone).toBe("+13125550199");
    });

    it("marks the inspection opened the first time, and only once", async () => {
      const { id, token } = await openInspection();
      expect((await row(id)).status).toBe("link_sent");
      await capture.state(token);
      await capture.state(token);
      const after = await row(id);
      expect(after.status).toBe("opened");
      expect(after.opened_at).toEqual(T0);
      expect((await events(id)).filter((e) => e === "opened")).toHaveLength(1);
    });

    it("reads 'expired' once the link time has passed, and 'revoked' after a revoke", async () => {
      const a = await openInspection(InspectionType.checkIn);
      const b = await openInspection(InspectionType.checkOut);
      clock = new Date(T0.getTime() + 25 * 3_600_000);
      expect((await capture.state(a.token)).state).toBe("expired");
      clock = T0;
      await revoke(b.id);
      expect((await capture.state(b.token)).state).toBe("revoked");
    });

    it("says 'submitted' with the reference once submitted", async () => {
      const { id, token } = await openInspection();
      await uploadAll(token);
      const done = await capture.submit(token, { attested: true });
      const state = await capture.state(token);
      expect(state.state).toBe("submitted");
      expect(state.reference).toBe(done.reference);
      expect(state.submittedAt).toEqual(T0);
      expect(state.photos).toEqual([]); // nothing more to do on this link
      expect((await row(id)).status).toBe("submitted");
    });

    it("resumes: shows the photos already received, with their thumbnails and notes", async () => {
      const { token } = await openInspection();
      const photo = await jpeg(10);
      await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body({ note: "chip" }),
        upload(photo),
      );
      await capture.uploadPhoto(
        token,
        "DAMAGE",
        body({ position: "1", note: "dent" }),
        upload(photo),
      );
      const state = await capture.state(token);
      expect(state.photos).toHaveLength(2);
      const front = state.photos.find((p) => p.shotId === "EXT_FRONT")!;
      expect(front).toMatchObject({ position: 1, note: "chip" });
      expect(front.thumbUrl).toContain("/thumbs/04_EXT_FRONT.jpg");
      expect(state.photos.find((p) => p.shotId === "DAMAGE")).toMatchObject({
        position: 1,
        note: "dent",
      });
    });

    it("shows the damage recorded at check-in at the top of a check-out", async () => {
      const checkIn = await openInspection(InspectionType.checkIn);
      const photo = await jpeg(10);
      await capture.uploadPhoto(
        checkIn.token,
        "DAMAGE",
        body({ position: "1", note: "scratch on the left door" }),
        upload(photo),
      );
      await capture.uploadPhoto(
        checkIn.token,
        "DAMAGE",
        body({ position: "2" }),
        upload(photo),
      );
      await uploadAll(checkIn.token);
      await capture.submit(checkIn.token, { attested: true });

      const checkOut = await openInspection(InspectionType.checkOut);
      const state = await capture.state(checkOut.token);
      expect(state.priorDamage).toHaveLength(2);
      expect(state.priorDamage[0].note).toBe("scratch on the left door");
      expect(state.priorDamage[0].thumbUrl).toContain("/thumbs/D01_DAMAGE.jpg");
      expect(state.priorDamage[1].note).toBeNull();
      // A check-in has nothing to compare with.
      expect((await capture.state(checkIn.token)).priorDamage).toEqual([]);
    });
  });

  describe("uploading a photo", () => {
    it("stores the file and a 400 px thumbnail under id-based keys, with the server's fingerprint", async () => {
      const { id, token } = await openInspection();
      const photo = await jpeg(150, 2048, 1536);
      const done = await capture.uploadPhoto(
        token,
        "EXT_DRIVER_SIDE",
        body({ capturedAt: "2026-11-16T14:59:00.000Z" }),
        upload(photo),
      );
      expect(done).toMatchObject({
        shotId: "EXT_DRIVER_SIDE",
        position: 1,
        stored: true,
        retakeCount: 0,
        sha256: sha(photo),
      });
      const key = `inspections/${id}/01_EXT_DRIVER_SIDE.jpg`;
      expect(storage.files.get(key)!.body.equals(photo)).toBe(true);
      expect(storage.files.get(key)!.contentType).toBe("image/jpeg");
      const thumb = storage.files.get(
        `inspections/${id}/thumbs/01_EXT_DRIVER_SIDE.jpg`,
      )!;
      const meta = await sharp(thumb.body).metadata();
      expect(meta.format).toBe("jpeg");
      expect(Math.max(meta.width!, meta.height!)).toBe(400);

      const [stored] = await photos(id);
      expect(stored).toMatchObject({
        shot_id: "EXT_DRIVER_SIDE",
        position: 1,
        sha256: sha(photo),
        retake_count: 0,
        storage_key: key,
        uploaded_at: T0,
        captured_at: new Date("2026-11-16T14:59:00.000Z"),
      });
      expect(done.thumbUrl).toContain("thumbs/01_EXT_DRIVER_SIDE.jpg");
    });

    it("moves the inspection to in progress and stamps when it was started", async () => {
      const { id, token } = await openInspection();
      await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body(),
        upload(await jpeg(10)),
      );
      const after = await row(id);
      expect(after.status).toBe("in_progress");
      expect(after.started_at).toEqual(T0);
      expect(await events(id)).toContain("photo_uploaded");
    });

    it("does nothing the second time the same file arrives (a retry on a weak signal)", async () => {
      const { id, token } = await openInspection();
      const photo = await jpeg(10);
      await capture.uploadPhoto(token, "EXT_FRONT", body(), upload(photo));
      const puts = storage.puts;
      clock = new Date(T0.getTime() + 60_000);
      const again = await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body(),
        upload(photo),
      );
      expect(again.stored).toBe(false);
      expect(again.retakeCount).toBe(0);
      expect(storage.puts).toBe(puts);
      expect(await photos(id)).toHaveLength(1);
      expect((await photos(id))[0].uploaded_at).toEqual(T0);
      expect(
        (await events(id)).filter((e) => e === "photo_uploaded"),
      ).toHaveLength(1);
    });

    it("keeps one row when two identical uploads arrive at the same moment", async () => {
      const { id, token } = await openInspection();
      const photo = await jpeg(10);
      const [a, b] = await Promise.all([
        capture.uploadPhoto(token, "EXT_REAR", body(), upload(photo)),
        capture.uploadPhoto(token, "EXT_REAR", body(), upload(photo)),
      ]);
      expect([a.stored, b.stored].filter(Boolean)).toHaveLength(1);
      expect(await photos(id)).toHaveLength(1);
    });

    it("treats different bytes for the same shot as a retake: the file is replaced and counted", async () => {
      const { id, token } = await openInspection();
      await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body({ note: "first" }),
        upload(await jpeg(10)),
      );
      clock = new Date(T0.getTime() + 60_000);
      const second = await jpeg(200);
      const retake = await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body(),
        upload(second),
      );
      expect(retake).toMatchObject({
        stored: true,
        retakeCount: 1,
        sha256: sha(second),
      });
      const rows = await photos(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sha256: sha(second),
        retake_count: 1,
        driver_note: "first",
      });
      expect(rows[0].uploaded_at).toEqual(clock);
      expect(
        storage.files
          .get(`inspections/${id}/04_EXT_FRONT.jpg`)!
          .body.equals(second),
      ).toBe(true);
    });

    it("updates the note or the capture time without a file, and clears a note sent empty", async () => {
      const { id, token } = await openInspection();
      const photo = await jpeg(10);
      await capture.uploadPhoto(token, "EXT_FRONT", body(), upload(photo));
      const noted = await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body({ note: "  small chip  " }),
        undefined,
      );
      expect(noted.stored).toBe(false);
      expect((await photos(id))[0].driver_note).toBe("small chip");
      await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body({ note: "" }),
        undefined,
      );
      expect((await photos(id))[0].driver_note).toBeNull();
    });

    it("asks for the photo first when there is none to update", async () => {
      const { token } = await openInspection();
      await expect(
        capture.uploadPhoto(token, "EXT_FRONT", body({ note: "x" }), undefined),
      ).rejects.toThrow("Send the photo first.");
    });

    it("numbers damage photos and keeps them apart", async () => {
      const { id, token } = await openInspection();
      const photo = await jpeg(10);
      await capture.uploadPhoto(
        token,
        "DAMAGE",
        body({ note: "one" }),
        upload(photo),
      ); // no number = 1
      await capture.uploadPhoto(
        token,
        "DAMAGE",
        body({ position: "2", note: "two" }),
        upload(await jpeg(20)),
      );
      await capture.uploadPhoto(
        token,
        "DAMAGE",
        body({ position: "15" }),
        upload(photo),
      );
      const rows = await photos(id);
      expect(rows.map((r) => r.position)).toEqual([1, 2, 15]);
      expect(storage.files.has(`inspections/${id}/D01_DAMAGE.jpg`)).toBe(true);
      expect(storage.files.has(`inspections/${id}/D15_DAMAGE.jpg`)).toBe(true);
      expect((await row(id)).status).toBe("in_progress");
    });

    it("gives a required shot only one photo", async () => {
      const { token } = await openInspection();
      await expect(
        capture.uploadPhoto(
          token,
          "EXT_FRONT",
          body({ position: "2" }),
          upload(await jpeg(10)),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("saves the mileage with the odometer photo and the fuel level with the fuel photo", async () => {
      const { id, token } = await openInspection();
      const photo = await jpeg(10);
      await capture.uploadPhoto(
        token,
        "INT_ODOMETER",
        body({ odometerMiles: "84213" }),
        upload(photo),
      );
      await capture.uploadPhoto(
        token,
        "INT_FUEL",
        body({ fuelLevel: "1_8" }),
        upload(photo),
      );
      expect(await row(id)).toMatchObject({
        odometer_miles: 84213,
        fuel_level: "1_8",
      });
      // Changed later without sending the picture again.
      await capture.uploadPhoto(
        token,
        "INT_ODOMETER",
        body({ odometerMiles: "84214" }),
        undefined,
      );
      expect((await row(id)).odometer_miles).toBe(84214);
    });

    it("refuses a reading sent with the wrong shot", async () => {
      const { token } = await openInspection();
      const photo = await jpeg(10);
      await expect(
        capture.uploadPhoto(
          token,
          "EXT_FRONT",
          body({ odometerMiles: "5" }),
          upload(photo),
        ),
      ).rejects.toThrow(/odometer/);
      await expect(
        capture.uploadPhoto(
          token,
          "INT_ODOMETER",
          body({ fuelLevel: "full" }),
          upload(photo),
        ),
      ).rejects.toThrow(/fuel/);
    });

    it("refuses an unknown shot", async () => {
      const { token } = await openInspection();
      await expect(
        capture.uploadPhoto(
          token,
          "NOT_A_SHOT",
          body(),
          upload(await jpeg(10)),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("refuses what is not a JPEG picture", async () => {
      const { id, token } = await openInspection();
      const png = await sharp({
        create: { width: 20, height: 20, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      for (const bad of [png, Buffer.from("just text"), Buffer.alloc(0)]) {
        await expect(
          capture.uploadPhoto(token, "EXT_FRONT", body(), upload(bad)),
        ).rejects.toThrow(BadRequestException);
      }
      // Starts like a JPEG but is not a picture.
      await expect(
        capture.uploadPhoto(
          token,
          "EXT_FRONT",
          body(),
          upload(
            Buffer.concat([
              Buffer.from([0xff, 0xd8, 0xff]),
              Buffer.from("not an image"),
            ]),
          ),
        ),
      ).rejects.toThrow(/could not be read/);
      expect(await photos(id)).toHaveLength(0);
      expect(storage.files.size).toBe(0);
    });

    it("refuses a file over 10 MB", async () => {
      const { token } = await openInspection();
      const big = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.alloc(10 * 1024 * 1024),
      ]);
      await expect(
        capture.uploadPhoto(token, "EXT_FRONT", body(), upload(big)),
      ).rejects.toThrow(BadRequestException);
    });

    it("says so, and saves nothing, when the bucket is down", async () => {
      const { id, token } = await openInspection();
      storage.failPuts = true;
      await expect(
        capture.uploadPhoto(token, "EXT_FRONT", body(), upload(await jpeg(10))),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(await photos(id)).toHaveLength(0);
      expect((await row(id)).status).toBe("link_sent");
    });

    it("says so when no bucket is set up on this server", async () => {
      const { token } = await openInspection();
      const noStorage = new InspectionCaptureService(db, null, {
        get: () => undefined,
      } as unknown as ConfigService);
      await expect(
        noStorage.uploadPhoto(
          token,
          "EXT_FRONT",
          body(),
          upload(await jpeg(10)),
        ),
      ).rejects.toThrow(/storage is not set up/);
    });

    it("answers the same 'expired' for an unknown token, a link that ran out and a revoked one, and saves nothing", async () => {
      const a = await openInspection(InspectionType.checkIn);
      const b = await openInspection(InspectionType.checkOut);
      const photo = await jpeg(10);
      await revoke(b.id);
      const unknown = capture.uploadPhoto(
        "A".repeat(43),
        "EXT_FRONT",
        body(),
        upload(photo),
      );
      const revoked = capture.uploadPhoto(
        b.token,
        "EXT_FRONT",
        body(),
        upload(photo),
      );
      clock = new Date(T0.getTime() + 25 * 3_600_000);
      const expired = capture.uploadPhoto(
        a.token,
        "EXT_FRONT",
        body(),
        upload(photo),
      );
      const messages: string[] = [];
      for (const attempt of [unknown, revoked, expired]) {
        await expect(attempt).rejects.toThrow(GoneException);
        await attempt.catch((e: Error) => messages.push(e.message));
      }
      expect(new Set(messages).size).toBe(1);
      expect(storage.files.size).toBe(0);
    });

    it("refuses a photo after the inspection was submitted", async () => {
      const { token } = await openInspection();
      await uploadAll(token);
      await capture.submit(token, { attested: true });
      await expect(
        capture.uploadPhoto(token, "EXT_FRONT", body(), upload(await jpeg(99))),
      ).rejects.toThrow(ConflictException);
    });

    it("refuses a photo the moment the link is revoked", async () => {
      const { id, token } = await openInspection();
      await capture.uploadPhoto(
        token,
        "EXT_FRONT",
        body(),
        upload(await jpeg(10)),
      );
      await revoke(id);
      await expect(
        capture.uploadPhoto(token, "EXT_REAR", body(), upload(await jpeg(20))),
      ).rejects.toThrow(GoneException);
      expect(await photos(id)).toHaveLength(1);
    });
  });

  describe("the text fields of an upload", () => {
    it("accepts the documented fields and turns the text numbers into numbers", () => {
      expect(
        problems({
          position: "3",
          note: "x",
          capturedAt: "2026-11-16T14:59:00Z",
          odometerMiles: "84213",
          fuelLevel: "full",
        }),
      ).toEqual([]);
      const dto = body({ position: "3", odometerMiles: "84213" });
      expect(dto.position).toBe(3);
      expect(dto.odometerMiles).toBe(84213);
    });

    it("refuses what the client's page would call wrong", () => {
      expect(problems({ odometerMiles: "84k" })).toEqual(["odometerMiles"]);
      expect(problems({ odometerMiles: "-5" })).toEqual(["odometerMiles"]);
      expect(problems({ odometerMiles: "12.5" })).toEqual(["odometerMiles"]);
      expect(problems({ fuelLevel: "2_3" })).toEqual(["fuelLevel"]);
      expect(problems({ position: "0" })).toEqual(["position"]);
      expect(problems({ position: "16" })).toEqual(["position"]);
      expect(problems({ note: "x".repeat(201) })).toEqual(["note"]);
      expect(problems({ capturedAt: "yesterday" })).toEqual(["capturedAt"]);
      expect(problems({ surprise: "x" })).toEqual(["surprise"]);
    });

    it("lets a form leave a field empty", () => {
      expect(
        problems({
          position: "",
          odometerMiles: "",
          fuelLevel: "",
          capturedAt: "",
          note: "",
        }),
      ).toEqual([]);
    });
  });

  describe("submitting", () => {
    it("refuses until every required photo is in, and names the missing ones", async () => {
      const { id, token } = await openInspection();
      await uploadAll(token, ["EXT_REAR", "INT_REAR_SEATS"]);
      const error = await capture
        .submit(token, { attested: true })
        .catch((e: BadRequestException) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        missing: ["EXT_REAR", "INT_REAR_SEATS"],
      });
      expect((await row(id)).status).toBe("in_progress");
    });

    it("refuses without the mileage or the fuel level", async () => {
      const { token } = await openInspection();
      const photo = await jpeg(10);
      for (const shotId of SHOTS) {
        await capture.uploadPhoto(token, shotId, body(), upload(photo));
      }
      await expect(capture.submit(token, { attested: true })).rejects.toThrow(
        /mileage/,
      );
      await capture.uploadPhoto(
        token,
        "INT_ODOMETER",
        body({ odometerMiles: "100" }),
        undefined,
      );
      await expect(capture.submit(token, { attested: true })).rejects.toThrow(
        /fuel/,
      );
      await capture.uploadPhoto(
        token,
        "INT_FUEL",
        body({ fuelLevel: "empty" }),
        undefined,
      );
      await expect(
        capture.submit(token, { attested: true }),
      ).resolves.toBeDefined();
    });

    it("counts only required photos: damage photos do not stand in for a shot", async () => {
      const { token } = await openInspection();
      await uploadAll(token, ["EXT_FRONT"]);
      await capture.uploadPhoto(token, "DAMAGE", body(), upload(await jpeg(5)));
      await expect(capture.submit(token, { attested: true })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("submits: stamps the time and the attestation, keeps the location and the device, ends the link", async () => {
      const { id, token } = await openInspection();
      await uploadAll(token);
      const done = await capture.submit(token, {
        attested: true,
        gpsLat: 41.8781,
        gpsLng: -87.6298,
        deviceInfo: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
      });
      expect(done.submittedAt).toEqual(T0);
      expect(await row(id)).toMatchObject({
        status: "submitted",
        submitted_at: T0,
        attested_at: T0,
        gps_lat: 41.8781,
        gps_lng: -87.6298,
        device_info: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
        odometer_miles: 84213,
        fuel_level: "3_4",
      });
      expect(await events(id)).toContain("submitted");
    });

    it("keeps a location only when both numbers came", async () => {
      const { id, token } = await openInspection();
      await uploadAll(token);
      await capture.submit(token, { attested: true, gpsLat: 41.8 });
      expect(await row(id)).toMatchObject({ gps_lat: null, gps_lng: null });
    });

    it("answers a second submit with the same reference and time instead of failing", async () => {
      const { token } = await openInspection();
      await uploadAll(token);
      const first = await capture.submit(token, { attested: true });
      clock = new Date(T0.getTime() + 60_000);
      const second = await capture.submit(token, { attested: true });
      expect(second).toEqual(first);
    });

    it("cannot submit an expired or revoked link, or an unknown token", async () => {
      const a = await openInspection(InspectionType.checkIn);
      const b = await openInspection(InspectionType.checkOut);
      await uploadAll(a.token);
      await uploadAll(b.token);
      await revoke(b.id);
      await expect(capture.submit(b.token, { attested: true })).rejects.toThrow(
        GoneException,
      );
      await expect(
        capture.submit("A".repeat(43), { attested: true }),
      ).rejects.toThrow(GoneException);
      clock = new Date(T0.getTime() + 25 * 3_600_000);
      await expect(capture.submit(a.token, { attested: true })).rejects.toThrow(
        GoneException,
      );
    });

    it("needs the box ticked", () => {
      const check = (raw: Record<string, unknown>) =>
        validateSync(plainToInstance(SubmitInspectionDto, raw), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }).map((e) => e.property);
      expect(check({})).toEqual(["attested"]);
      expect(check({ attested: false })).toEqual(["attested"]);
      expect(check({ attested: "true" })).toEqual(["attested"]);
      expect(check({ attested: true })).toEqual([]);
      expect(check({ attested: true, gpsLat: 91 })).toEqual(["gpsLat"]);
      expect(check({ attested: true, gpsLng: -181 })).toEqual(["gpsLng"]);
      expect(check({ attested: true, deviceInfo: "x".repeat(501) })).toEqual([
        "deviceInfo",
      ]);
    });
  });

  describe("the language choice", () => {
    it("is saved on the driver, so the next text goes out in it", async () => {
      const { id, token } = await openInspection();
      expect(await capture.setLanguage(token, "es" as never)).toEqual({
        language: "es",
      });
      expect(
        (
          (await db.query(`SELECT preferred_language FROM drivers`)) as {
            preferred_language: string;
          }[]
        )[0].preferred_language,
      ).toBe("es");
      expect(await events(id)).toContain("language_changed");
      expect((await capture.state(token)).language).toBe("es");
    });

    it("is refused for a link that is not good any more", async () => {
      const { token } = await openInspection();
      await uploadAll(token);
      await capture.submit(token, { attested: true });
      await expect(capture.setLanguage(token, "es" as never)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        capture.setLanguage("A".repeat(43), "es" as never),
      ).rejects.toThrow(GoneException);
    });
  });
});
