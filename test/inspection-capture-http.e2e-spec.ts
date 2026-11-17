import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import sharp from "sharp";
import request from "supertest";
import type { App } from "supertest/types.js";
import type { DataSource } from "typeorm";
import { AppModule } from "../src/app.module.js";
import { FixedWindowLimiter } from "../src/inspections/fixed-window-limiter.js";
import { InspectionsService } from "../src/inspections/inspections.service.js";
import { TokenRateLimitGuard } from "../src/inspections/token-rate-limit.guard.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { FILE_STORAGE } from "../src/sms/storage/file-storage.module.js";
import { openTestDatabase } from "./test-database.js";

class FakeStorage implements FileStorage {
  files = new Map<string, Buffer>();
  put(key: string, body: Buffer) {
    this.files.set(key, body);
    return Promise.resolve();
  }
  get(key: string) {
    return Promise.resolve(this.files.get(key)!);
  }
  presignGet(key: string) {
    return Promise.resolve(`https://bucket.test/${key}?signed`);
  }
  delete(key: string) {
    this.files.delete(key);
    return Promise.resolve();
  }
}

const jpeg = () =>
  sharp({
    create: { width: 800, height: 600, channels: 3, background: "teal" },
  })
    .jpeg()
    .toBuffer();

/**
 * The public routes over real HTTP, through the whole app (Module 3 step 3): what the services tests cannot see: that the routes
 * need no login, that the multipart text fields are read and checked as the global pipe does, the status codes, and the rate limit.
 */
describe("the public link routes over HTTP (test database)", () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let storage: FakeStorage;
  let token: string;
  let guard: TokenRateLimitGuard;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    db = await openTestDatabase();
    storage = new FakeStorage();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    // The same global pipe as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    guard = app.get(TokenRateLimitGuard);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE inspection_events, inspection_shot_answers, inspection_photos, inspections, sms_messages, drivers, users CASCADE",
    );
    const [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@http.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    const [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Maria', 'Driver', 'maria@http.test', '+13125550101') RETURNING id`,
    )) as [{ id: string }];
    const staff = app.get(InspectionsService);
    const made = await staff.create(
      driverId,
      { type: "check_in" as never, vehicle: { model: "Camry", plate: "AB1" } },
      adminId,
    );
    token = (await staff.reissue(made.id, adminId)).link.split("/i/")[1];
    storage.files.clear();
    guard.limiter = new FixedWindowLimiter(1000, 60_000);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it("opens the page's state with no login", async () => {
    const res = await request(server()).get(`/i/${token}`).expect(200);
    expect(res.body).toMatchObject({
      state: "open",
      type: "check_in",
      vehicle: { model: "Camry", plate: "AB1", vinLast4: null },
    });
    expect(res.body.shots).toHaveLength(21);
    expect(res.body.answers).toEqual([]);
  });

  it("answers an unknown token with 200 and 'expired', like a real one that ran out", async () => {
    const res = await request(server())
      .get(`/i/${"A".repeat(43)}`)
      .expect(200);
    expect(res.body.state).toBe("expired");
    const junk = await request(server()).get("/i/nonsense").expect(200);
    expect(junk.body.state).toBe("expired");
  });

  it("leaves the staff routes behind the login", async () => {
    await request(server())
      .get("/inspections/00000000-0000-4000-8000-000000000000")
      .expect(401);
    await request(server())
      .get("/drivers/00000000-0000-4000-8000-000000000000/inspections")
      .expect(401);
    await request(server())
      .post("/inspections/00000000-0000-4000-8000-000000000000/send")
      .expect(401);
  });

  it("takes a photo as multipart form data, with its text fields", async () => {
    const res = await request(server())
      .put(`/i/${token}/photos/INT_ODOMETER`)
      .attach("photo", await jpeg(), {
        filename: "odo.jpg",
        contentType: "image/jpeg",
      })
      .field("odometerMiles", "84213")
      .field("note", "dash is dusty")
      .field("capturedAt", "2026-11-16T14:59:00.000Z")
      .expect(200);
    expect(res.body).toMatchObject({
      shotId: "INT_ODOMETER",
      position: 1,
      stored: true,
      retakeCount: 0,
    });
    expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.files.size).toBe(2); // the photo and its thumbnail
    const [row] = (await db.query(
      `SELECT odometer_miles FROM inspections`,
    )) as { odometer_miles: number }[];
    expect(row.odometer_miles).toBe(84213);
    const again = await request(server()).get(`/i/${token}`).expect(200);
    expect(again.body.odometerMiles).toBe(84213);
    expect(again.body.photos).toHaveLength(1);
  });

  it("repeats an upload safely", async () => {
    const photo = await jpeg();
    const send = () =>
      request(server())
        .put(`/i/${token}/photos/EXT_FRONT`)
        .attach("photo", photo, {
          filename: "a.jpg",
          contentType: "image/jpeg",
        });
    expect((await send().expect(200)).body.stored).toBe(true);
    expect((await send().expect(200)).body.stored).toBe(false);
    expect(await db.query(`SELECT 1 FROM inspection_photos`)).toHaveLength(1);
  });

  it("refuses bad fields and files with 400 and a sentence", async () => {
    const bad = await request(server())
      .put(`/i/${token}/photos/INT_ODOMETER`)
      .attach("photo", await jpeg(), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .field("odometerMiles", "84k")
      .expect(400);
    expect(JSON.stringify(bad.body.message)).toContain("odometerMiles");
    await request(server())
      .put(`/i/${token}/photos/EXT_FRONT`)
      .attach("photo", Buffer.from("not a picture"), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .expect(400);
    await request(server())
      .put(`/i/${token}/photos/EXT_FRONT`)
      .field("note", "x")
      .expect(400);
    await request(server())
      .put(`/i/${token}/photos/NOPE`)
      .attach("photo", await jpeg(), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .expect(404);
    await request(server())
      .put(`/i/${token}/photos/EXT_FRONT`)
      .field("surprise", "x")
      .expect(400);
    expect(storage.files.size).toBe(0);
  });

  it("takes a damage close-up for a shot as form data, and the damage answer as JSON (D112)", async () => {
    const closeUp = await request(server())
      .put(`/i/${token}/photos/DAMAGE`)
      .attach("photo", await jpeg(), {
        filename: "c.jpg",
        contentType: "image/jpeg",
      })
      .field("parentShotId", "EXT_RIGHT_MIRROR")
      .field("position", "2")
      .field("note", "cracked glass")
      .expect(200);
    expect(closeUp.body).toMatchObject({
      shotId: "DAMAGE",
      parentShotId: "EXT_RIGHT_MIRROR",
      position: 2,
      stored: true,
    });
    await request(server())
      .put(`/i/${token}/shots/EXT_FRONT/damage-answer`)
      .send({ hasDamage: false })
      .expect(200, { shotId: "EXT_FRONT", hasDamage: false });
    await request(server())
      .put(`/i/${token}/shots/EXT_FRONT/damage-answer`)
      .send({ hasDamage: "no" })
      .expect(400);
    await request(server())
      .put(`/i/${token}/shots/EXT_FRONT/damage-answer`)
      .send({})
      .expect(400);
    await request(server())
      .put(`/i/${token}/shots/NOPE/damage-answer`)
      .send({ hasDamage: true })
      .expect(404);
    // "No" for a shot that has a close-up: 409.
    await request(server())
      .put(`/i/${token}/shots/EXT_RIGHT_MIRROR/damage-answer`)
      .send({ hasDamage: false })
      .expect(409);
    await request(server())
      .put(`/i/${"A".repeat(43)}/shots/EXT_FRONT/damage-answer`)
      .send({ hasDamage: true })
      .expect(410);
    const state = await request(server()).get(`/i/${token}`).expect(200);
    expect(state.body.answers).toEqual(
      expect.arrayContaining([
        { shotId: "EXT_FRONT", hasDamage: false },
        { shotId: "EXT_RIGHT_MIRROR", hasDamage: true },
      ]),
    );
  });

  it("answers 410 for a photo sent to an unknown token", async () => {
    await request(server())
      .put(`/i/${"A".repeat(43)}/photos/EXT_FRONT`)
      .attach("photo", await jpeg(), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .expect(410);
  });

  it("refuses a submit with a photo missing (400, naming them) and without the box ticked", async () => {
    const res = await request(server())
      .post(`/i/${token}/submit`)
      .send({ attested: true })
      .expect(400);
    expect(res.body.missing).toHaveLength(21);
    await request(server()).post(`/i/${token}/submit`).send({}).expect(400);
    await request(server())
      .post(`/i/${token}/submit`)
      .send({ attested: true, extra: 1 })
      .expect(400);
  });

  it("saves the language", async () => {
    const res = await request(server())
      .post(`/i/${token}/language`)
      .send({ language: "es" })
      .expect(200);
    expect(res.body).toEqual({ language: "es" });
    await request(server())
      .post(`/i/${token}/language`)
      .send({ language: "fr" })
      .expect(400);
  });

  describe("rate limit", () => {
    it("answers 429 with Retry-After once an address passes the limit, on these routes only", async () => {
      guard.limiter = new FixedWindowLimiter(3, 60_000);
      for (let i = 0; i < 3; i += 1) {
        await request(server()).get(`/i/${token}`).expect(200);
      }
      const limited = await request(server()).get(`/i/${token}`).expect(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      await request(server())
        .post(`/i/${token}/language`)
        .send({ language: "en" })
        .expect(429);
      // Everything else is untouched: the login check still answers 401, not 429.
      await request(server()).get("/drivers").expect(401);
      await request(server()).get("/").expect(200);
    });

    it("counts each address on its own", async () => {
      guard.limiter = new FixedWindowLimiter(1, 60_000);
      await request(server())
        .get(`/i/${token}`)
        .set("X-Forwarded-For", "203.0.113.5")
        .expect(200);
      await request(server())
        .get(`/i/${token}`)
        .set("X-Forwarded-For", "203.0.113.5")
        .expect(429);
      await request(server())
        .get(`/i/${token}`)
        .set("X-Forwarded-For", "203.0.113.6")
        .expect(200);
    });
  });
});
