import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { Application } from "../src/applications/application.entity.js";
import { ApplicationsController } from "../src/applications/applications.controller.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { MAX_UPLOAD_BYTES } from "../src/applications/documents/upload-file.js";
import { ManualApplicationDto } from "../src/applications/manual/manual-application.dto.js";
import type { ManualApplicationFiles } from "../src/applications/manual/manual-payload.js";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { MessageTemplate } from "../src/message-templates/message-template.entity.js";
import { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import type {
  QuoClient,
  QuoMessage,
  QuoMessagePage,
} from "../src/sms/quo/quo-client.js";
import { SmsService } from "../src/sms/sms.service.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase, seedTestTemplates } from "./test-database.js";

/** A bucket in memory. `failPutAfter`: the put after this many successful ones throws. */
class FakeStorage implements FileStorage {
  files = new Map<string, { body: Buffer; contentType: string | null }>();
  failPutAfter: number | null = null;
  private puts = 0;

  put(key: string, body: Buffer, contentType: string | null) {
    if (this.failPutAfter !== null && this.puts >= this.failPutAfter) {
      return Promise.reject(new Error("bucket down"));
    }
    this.puts++;
    this.files.set(key, { body, contentType });
    return Promise.resolve();
  }
  presignGet(key: string) {
    return Promise.resolve(`https://bucket.test/${key}?signed`);
  }
  delete(key: string) {
    this.files.delete(key);
    return Promise.resolve();
  }
}

/** A Quo that accepts everything (the approval texts). */
class FakeQuo implements QuoClient {
  sendText(to: string, text: string): Promise<QuoMessage> {
    return Promise.resolve({
      id: "AC1",
      direction: "outgoing",
      from: "+13127362939",
      to: [to],
      text,
      status: "queued",
      createdAt: new Date(),
      media: [],
      errorCode: null,
    });
  }
  listConversation(): Promise<QuoMessagePage> {
    return Promise.resolve({ messages: [], nextPageToken: null });
  }
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png body"),
]);
const PDF = Buffer.from("%PDF-1.4 pdf body");
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("jpeg body"),
]);

/** What multer hands the service for one uploaded file. */
const upload = (buffer: Buffer, name = "file.png"): Express.Multer.File =>
  ({ buffer, size: buffer.length, originalname: name }) as Express.Multer.File;

/** The text fields exactly as the browser form sends them (all strings, `platforms` repeated). */
const rawFields = (overrides: Record<string, unknown> = {}) => ({
  request_id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  first_name: "Pat",
  last_name: "Applicant",
  email: "Pat.Applicant@Test.dev",
  phone: "(305) 721-0909",
  street: "100 Test Street",
  apt: "",
  city: "Chicago",
  zip: "60601",
  age: "30",
  years_driving: "3 to 5 years",
  violations: "0",
  accidents: "1",
  platforms: ["Uber", "Lyft"],
  driver_rating: "4.9",
  earnings: "1200",
  previous_companies: "",
  referred_by: "",
  start_date: "2026-10-25",
  duration: "corto",
  has_startup_funds: "yes",
  capital: "",
  has_insurance: "yes",
  has_insurance_last_45_days: "no",
  ...overrides,
});

/** Runs what the global ValidationPipe runs (transform + whitelist rules) and returns the DTO, or the error messages. */
function validate(raw: Record<string, unknown>) {
  const dto = plainToInstance(ManualApplicationDto, raw);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
    properties: errors.map((e) => e.property),
  };
}

describe("an admin adds an application by hand (D68, test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;
  let alerted: number;
  let adminId: string;

  const build = (bucket: FileStorage | null = storage) => {
    const sms = new SmsService(db, {
      mode: "dry_run",
      quo: new FakeQuo(),
      phoneNumberId: "PNtest",
      storage: null,
    });
    return new ApplicationsService(
      db.getRepository(Application),
      db,
      new PasswordService(),
      sms,
      {
        notifyInBackground: () => {
          alerted++;
        },
      } as unknown as ApplicationAlertService,
      { getOrThrow: () => "https://app.test" } as unknown as ConfigService,
      bucket,
      new MessageTemplatesService(db.getRepository(MessageTemplate)),
    );
  };

  const fieldsOf = (overrides: Record<string, unknown> = {}) => {
    const { dto, messages } = validate(rawFields(overrides));
    expect(messages).toEqual([]);
    return dto;
  };
  const licenseOnly = (): ManualApplicationFiles => ({
    license: upload(PNG, "licence.png"),
  });
  const applicationCount = async () =>
    (
      (await db.query(`SELECT COUNT(*)::int AS n FROM applications`)) as [
        { n: number },
      ]
    )[0].n;

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE application_documents, applications, drivers, users CASCADE",
    );
    await seedTestTemplates(db);
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    storage = new FakeStorage();
    alerted = 0;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the form's rules (the website's)", () => {
    it("accepts a complete form and normalises it", () => {
      const { dto, messages } = validate(rawFields());
      expect(messages).toEqual([]);
      expect(dto).toMatchObject({
        email: "pat.applicant@test.dev",
        phone: "3057210909",
        platforms: ["Uber", "Lyft"],
        age: "30",
      });
      // Empty optional answers count as not filled in.
      expect(dto.apt).toBeUndefined();
      expect(dto.referred_by).toBeUndefined();
    });

    it("accepts 3+ violations and accidents, and a start-up amount when funds are missing", () => {
      const { dto, messages } = validate(
        rawFields({
          violations: "3+",
          accidents: "3+",
          has_startup_funds: "no",
          capital: "400.50",
        }),
      );
      expect(messages).toEqual([]);
      expect(dto).toMatchObject({
        violations: "3+",
        accidents: "3+",
        capital: "400.50",
      });
    });

    it("ignores the amount when the funds are covered", () => {
      const { messages } = validate(
        rawFields({ has_startup_funds: "yes", capital: "not asked" }),
      );
      expect(messages).toEqual([]);
    });

    it("takes one platform sent as a single value, and an 11-digit phone with the country code", () => {
      const { dto, messages } = validate(
        rawFields({ platforms: "Roadie", phone: "+1 305 721 0909" }),
      );
      expect(messages).toEqual([]);
      expect(dto.platforms).toEqual(["Roadie"]);
      expect(dto.phone).toBe("3057210909");
    });

    it.each([
      ["first_name", { first_name: "  " }],
      ["last_name", { last_name: undefined }],
      ["street", { street: "" }],
      ["city", { city: "" }],
      ["email", { email: "not-an-email" }],
      ["phone", { phone: "305721" }],
      ["zip", { zip: "6060" }],
      ["age", { age: "24" }],
      ["age", { age: "abc" }],
      ["years_driving", { years_driving: "Forever" }],
      ["violations", { violations: "4" }],
      ["violations", { violations: "21" }],
      ["accidents", { accidents: "-1" }],
      ["accidents", { accidents: "three" }],
      // The amount is required, as an amount, only when the first week and deposit are not covered.
      ["capital", { has_startup_funds: "no", capital: "" }],
      ["capital", { has_startup_funds: "no", capital: "lots" }],
      ["platforms", { platforms: [] }],
      ["platforms", { platforms: ["Bolt"] }],
      ["start_date", { start_date: "2026-02-30" }],
      ["start_date", { start_date: "10/25/2026" }],
      ["duration", { duration: "short" }],
      ["has_startup_funds", { has_startup_funds: "maybe" }],
      ["has_insurance", { has_insurance: "" }],
      ["has_insurance_last_45_days", { has_insurance_last_45_days: "Y" }],
      // The vehicle is not a question on the website form.
      ["vehicle_preference", { vehicle_preference: "prius" }],
      ["request_id", { request_id: "abc" }],
    ])("refuses a bad %s", (property, override) => {
      const { properties } = validate(rawFields(override));
      expect(properties).toContain(property);
    });

    it("refuses a field the form does not have", () => {
      const { properties } = validate(rawFields({ is_admin: "true" }));
      expect(properties).toContain("is_admin");
    });

    it("the route needs a login (it is not public)", () => {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          Object.getOwnPropertyDescriptor(
            ApplicationsController.prototype,
            "createManual",
          )?.value,
        ),
      ).toBeUndefined();
    });
  });

  it("stores the application in the website's shape, with its three documents and an alert", async () => {
    const result = await build().createManual(
      fieldsOf(),
      {
        license: upload(PNG, "licence.png"),
        rating: upload(JPEG, "rating.jpg"),
        earnings: upload(PDF, "earnings.pdf"),
      },
      adminId,
    );

    expect(result.created).toBe(true);
    const [row] = (await db.query(`SELECT * FROM applications WHERE id = $1`, [
      result.id,
    ])) as Record<string, unknown>[];
    expect(row).toMatchObject({
      status: "pending",
      first_name: "Pat",
      email: "pat.applicant@test.dev",
      phone: "3057210909",
      city: "Chicago",
      zip: "60601",
      created_by_id: adminId,
      license_storage_path: null,
      rating_storage_path: null,
      earnings_storage_path: null,
    });
    expect(row.payload).toMatchObject({
      source: "admin",
      platforms: ["Uber", "Lyft"],
      duration: "corto",
      years_driving: "3 to 5 years",
      has_insurance: "yes",
      license_file_name: "licence.png",
      has_license_file: true,
      has_earnings_file: true,
      earnings_count: 1,
    });
    // Empty optional answers are not in the payload at all.
    expect(row.payload).not.toHaveProperty("capital");
    expect(row.payload).not.toHaveProperty("apt");

    const documents = (await db.query(
      `SELECT kind, origin, status, source_path, uploaded_by_id, storage_key, size_bytes, content_type
       FROM application_documents WHERE application_id = $1 ORDER BY kind`,
      [result.id],
    )) as Record<string, unknown>[];
    expect(documents.map((d) => [d.kind, d.content_type])).toEqual([
      ["license", "image/png"],
      ["rating", "image/jpeg"],
      ["earnings", "application/pdf"],
    ]);
    for (const document of documents) {
      expect(document).toMatchObject({
        origin: "admin",
        status: "stored",
        source_path: null,
        uploaded_by_id: adminId,
      });
      expect(storage.files.has(document.storage_key as string)).toBe(true);
      expect(document.storage_key).toMatch(
        new RegExp(`^applications/${result.id}/`),
      );
    }
    expect(storage.files.size).toBe(3);
    expect(alerted).toBe(1);
  });

  it("keeps the start-up amount only when the funds are missing", async () => {
    const service = build();
    const missing = await service.createManual(
      fieldsOf({
        request_id: "11111111-1111-4111-8111-111111111111",
        has_startup_funds: "no",
        capital: "400",
      }),
      licenseOnly(),
      adminId,
    );
    const covered = await service.createManual(
      fieldsOf({
        request_id: "22222222-2222-4222-8222-222222222222",
        has_startup_funds: "yes",
        capital: "999",
      }),
      licenseOnly(),
      adminId,
    );
    const payloadOf = async (id: string) =>
      (
        (await db.query(`SELECT payload FROM applications WHERE id = $1`, [
          id,
        ])) as [{ payload: Record<string, unknown> }]
      )[0].payload;
    expect(await payloadOf(missing.id)).toMatchObject({
      has_startup_funds: "no",
      capital: "400",
    });
    expect(await payloadOf(covered.id)).not.toHaveProperty("capital");
  });

  it("works with the licence alone", async () => {
    const result = await build().createManual(
      fieldsOf(),
      licenseOnly(),
      adminId,
    );
    const kinds = (await db.query(
      `SELECT kind FROM application_documents WHERE application_id = $1`,
      [result.id],
    )) as { kind: string }[];
    expect(kinds).toEqual([{ kind: "license" }]);
  });

  it("refuses a missing licence and stores nothing", async () => {
    await expect(
      build().createManual(fieldsOf(), { rating: upload(PNG) }, adminId),
    ).rejects.toThrow(/license is required/);
    expect(await applicationCount()).toBe(0);
    expect(storage.files.size).toBe(0);
    expect(alerted).toBe(0);
  });

  it("refuses a text file renamed .png, and one over 10 MB, and stores nothing", async () => {
    await expect(
      build().createManual(
        fieldsOf(),
        { license: upload(Buffer.from("just text"), "licence.png") },
        adminId,
      ),
    ).rejects.toThrow(
      "Driver's licence: Only JPG, PNG or PDF files, at most 10 MB.",
    );
    await expect(
      build().createManual(
        fieldsOf(),
        {
          license: upload(PNG),
          rating: { ...upload(PNG), size: MAX_UPLOAD_BYTES + 1 },
        },
        adminId,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      build().createManual(
        fieldsOf(),
        { license: upload(Buffer.alloc(0)) },
        adminId,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(await applicationCount()).toBe(0);
    expect(storage.files.size).toBe(0);
  });

  it("answers 503 when no bucket is set up", async () => {
    await expect(
      build(null).createManual(fieldsOf(), licenseOnly(), adminId),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(await applicationCount()).toBe(0);
  });

  it("removes the files already stored when the bucket fails half way", async () => {
    storage.failPutAfter = 1;
    await expect(
      build().createManual(
        fieldsOf(),
        { license: upload(PNG), rating: upload(JPEG), earnings: upload(PDF) },
        adminId,
      ),
    ).rejects.toThrow("bucket down");
    expect(await applicationCount()).toBe(0);
    expect(storage.files.size).toBe(0);
    expect(alerted).toBe(0);
  });

  it("the same request_id twice makes one application, no new files, one alert", async () => {
    const service = build();
    const first = await service.createManual(
      fieldsOf(),
      licenseOnly(),
      adminId,
    );
    const again = await service.createManual(
      fieldsOf(),
      licenseOnly(),
      adminId,
    );

    expect(again).toEqual({ id: first.id, created: false });
    expect(await applicationCount()).toBe(1);
    expect(storage.files.size).toBe(1);
    expect(alerted).toBe(1);
  });

  it("two requests with the same request_id at the same instant: one wins, the loser's files are removed", async () => {
    const service = build();
    const [a, b] = await Promise.all([
      service.createManual(fieldsOf(), licenseOnly(), adminId),
      service.createManual(fieldsOf(), licenseOnly(), adminId),
    ]);

    expect(a.id).toBe(b.id);
    expect(
      [a.created, b.created].sort((x, y) => Number(x) - Number(y)),
    ).toEqual([false, true]);
    expect(await applicationCount()).toBe(1);
    expect(storage.files.size).toBe(1);
    const [{ storage_key }] = (await db.query(
      `SELECT storage_key FROM application_documents`,
    )) as [{ storage_key: string }];
    expect(storage.files.has(storage_key)).toBe(true);
    expect(alerted).toBe(1);
  });

  it("is then approved like any application: a driver in onboarding with a login", async () => {
    const service = build();
    const { id } = await service.createManual(
      fieldsOf(),
      licenseOnly(),
      adminId,
    );

    const detail = await service.findOne(id);
    expect(detail.createdBy).toEqual({ id: adminId, email: "admin@test.dev" });

    const approved = await service.approve(id, adminId);
    expect(approved).toMatchObject({ status: "approved" });
    expect(approved.createdBy?.email).toBe("admin@test.dev");
    const [driver] = (await db.query(
      `SELECT d.status, d.phone, d.email, u.role FROM drivers d JOIN users u ON u.id = d.user_id`,
    )) as { status: string; phone: string; email: string; role: string }[];
    expect(driver).toEqual({
      status: "onboarding",
      phone: "+13057210909",
      email: "pat.applicant@test.dev",
      role: "driver",
    });
  });

  it("a website application has no 'added by'", async () => {
    const [{ id }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
       VALUES ('w1', 'Web', 'Site', 'web@test.dev', '3125550101', '{}') RETURNING id`,
    )) as [{ id: string }];
    expect((await build().findOne(id)).createdBy).toBeNull();
  });
});
