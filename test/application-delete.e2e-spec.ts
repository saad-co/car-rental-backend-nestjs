import { ConflictException } from "@nestjs/common";
import type { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { Application } from "../src/applications/application.entity.js";
import type { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { ApplicationsController } from "../src/applications/applications.controller.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { DeleteApplicationsDto } from "../src/applications/dto/delete-applications.dto.js";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import type { SmsService } from "../src/sms/sms.service.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase } from "./test-database.js";

/** Our bucket in memory. Keys in `failing` throw on delete, like a bucket that is down. */
class FakeStorage implements FileStorage {
  files = new Set<string>();
  failing = new Set<string>();
  put(key: string) {
    this.files.add(key);
    return Promise.resolve();
  }
  get(key: string) {
    return Promise.reject(new Error(`no file ${key}`));
  }
  presignGet(key: string) {
    return Promise.resolve(`https://bucket.test/${key}?signed`);
  }
  delete(key: string) {
    if (this.failing.has(key))
      return Promise.reject(new Error("bucket unreachable"));
    this.files.delete(key);
    return Promise.resolve();
  }
}

const ADMIN_ID = "00000000-0000-0000-0000-00000000a0a0";
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe("ApplicationsService.deleteMany (test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;

  const service = (bucket: FileStorage | null = storage) =>
    new ApplicationsService(
      db.getRepository(Application),
      db,
      new PasswordService(),
      {} as SmsService,
      {} as ApplicationAlertService,
      bucket,
      {} as MessageTemplatesService,
    );

  const count = async (sql: string) =>
    Number(
      (
        (await db.query(`SELECT count(*) AS n FROM ${sql}`)) as [{ n: string }]
      )[0].n,
    );

  /** Stores an application the way intake would, with a copied licence file. Returns its id. */
  async function addApplication(
    name: string,
    phone: string,
    status = "pending",
  ): Promise<string> {
    let driverId: string | null = null;
    if (status === "approved") {
      // An approved application must point at its driver (CHECK applications_approved_has_driver).
      [{ id: driverId }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone)
         VALUES ($1, 'Driver', $2, '+13125550199') RETURNING id`,
        [name, `${name.toLowerCase()}@driver.test`],
      )) as [{ id: string }];
    }
    const [{ id }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, driver_id)
       VALUES ($1, $2, 'Applicant', $3, $4, '{}', $5, $6) RETURNING id`,
      [
        `req-${name}`,
        name,
        `${name.toLowerCase()}@test.dev`,
        phone,
        status,
        driverId,
      ],
    )) as [{ id: string }];
    const key = `applications/${id}/license-1.png`;
    await db.query(
      `INSERT INTO application_documents (application_id, kind, source_path, status, storage_key, size_bytes)
       VALUES ($1, 'license', 'site/licence.png', 'stored', $2, 7)`,
      [id, key],
    );
    storage.files.add(key);
    return id;
  }

  /** One inbound text with a copied photo, as the webhook would store it. Returns the photo's bucket key. */
  async function addTextWithPhoto(phone: string): Promise<string> {
    const [{ id }] = (await db.query(
      `INSERT INTO sms_messages (direction, contact_phone, body, status, occurred_at)
       VALUES ('inbound', $1, 'photo', 'received', now()) RETURNING id`,
      [phone],
    )) as [{ id: string }];
    const key = `sms/${id}/0.jpg`;
    await db.query(
      `INSERT INTO sms_attachments (message_id, position, source_url, status, storage_key, size_bytes)
       VALUES ($1, 0, 'https://quo.test/0.jpg', 'stored', $2, 5)`,
      [id, key],
    );
    storage.files.add(key);
    return key;
  }

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE sms_attachments, sms_messages, application_documents, applications, drivers, users CASCADE",
    );
    storage = new FakeStorage();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("deletes pending, rejected and on-hold applications with their document rows and files", async () => {
    const pending = await addApplication("Pat", "3125550101");
    const rejected = await addApplication("Sam", "3125550102", "rejected");
    const onHold = await addApplication("Kim", "3125550103", "on_hold");
    const kept = await addApplication("Lee", "3125550104");

    const result = await service().deleteMany(
      [pending, rejected, onHold],
      ADMIN_ID,
    );

    expect(result).toEqual({ deleted: 3, filesNotRemoved: 0 });
    expect(await count("applications")).toBe(1);
    expect(await count("application_documents")).toBe(1);
    expect([...storage.files]).toEqual([`applications/${kept}/license-1.png`]);
  });

  it("deletes the text history and its files when no one else uses the phone", async () => {
    const id = await addApplication("Pat", "(312) 555-0101");
    const photo = await addTextWithPhoto("+13125550101");
    const otherChat = await addTextWithPhoto("+13125550177");

    await service().deleteMany([id], ADMIN_ID);

    expect(await count("sms_messages")).toBe(1);
    expect(await count("sms_attachments")).toBe(1);
    expect(storage.files.has(photo)).toBe(false);
    expect(storage.files.has(otherChat)).toBe(true);
  });

  it("keeps the text history when another application or a driver has the same phone", async () => {
    const first = await addApplication("Pat", "3125550101");
    await addApplication("Pat2", "312-555-0101"); // the same person applied twice, typed differently
    const second = await addApplication("Sam", "3125550102");
    await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Sam', 'Driver', 'sam@driver.test', '+13125550102')`,
    );
    const patPhoto = await addTextWithPhoto("+13125550101");
    const samPhoto = await addTextWithPhoto("+13125550102");

    const result = await service().deleteMany([first, second], ADMIN_ID);

    expect(result.deleted).toBe(2);
    expect(await count("sms_messages")).toBe(2);
    expect(storage.files.has(patPhoto)).toBe(true);
    expect(storage.files.has(samPhoto)).toBe(true);
  });

  it("refuses the whole batch if one is approved, naming it, and deletes nothing", async () => {
    const pending = await addApplication("Pat", "3125550101");
    const approved = await addApplication("Ada", "3125550199", "approved");

    const error = await service()
      .deleteMany([pending, approved], ADMIN_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain("Ada Applicant");
    expect((error as Error).message).toContain("Nothing was deleted");
    expect(await count("applications")).toBe(2);
    expect(await count("application_documents")).toBe(2);
    expect(storage.files.size).toBe(2);
  });

  it("ignores unknown ids, so deleting twice is not an error", async () => {
    const id = await addApplication("Pat", "3125550101");

    expect(await service().deleteMany([id, UNKNOWN_ID], ADMIN_ID)).toEqual({
      deleted: 1,
      filesNotRemoved: 0,
    });
    expect(await service().deleteMany([id], ADMIN_ID)).toEqual({
      deleted: 0,
      filesNotRemoved: 0,
    });
  });

  it("a file the bucket cannot remove is counted, and the delete still stands", async () => {
    const id = await addApplication("Pat", "3125550101");
    storage.failing.add(`applications/${id}/license-1.png`);

    const result = await service().deleteMany([id], ADMIN_ID);

    expect(result).toEqual({ deleted: 1, filesNotRemoved: 1 });
    expect(await count("applications")).toBe(0);
  });

  it("with no bucket set up, every copied file is counted as not removed", async () => {
    const id = await addApplication("Pat", "3125550101");

    expect(await service(null).deleteMany([id], ADMIN_ID)).toEqual({
      deleted: 1,
      filesNotRemoved: 1,
    });
  });
});

describe("POST /applications/bulk-delete: body and access", () => {
  const body = (values: unknown) =>
    validateSync(plainToInstance(DeleteApplicationsDto, values));

  it("accepts 1 to 100 UUIDs and rejects anything else (the ValidationPipe answers 400)", () => {
    expect(body({ ids: [UNKNOWN_ID] })).toHaveLength(0);
    expect(body({ ids: [] })).not.toHaveLength(0);
    expect(body({ ids: ["not-a-uuid"] })).not.toHaveLength(0);
    expect(body({ ids: UNKNOWN_ID })).not.toHaveLength(0);
    expect(body({})).not.toHaveLength(0);
    expect(
      body({ ids: Array.from({ length: 101 }, () => UNKNOWN_ID) }),
    ).not.toHaveLength(0);
  });

  it("is admin-only: not public, and not opened to drivers", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- read as metadata, never called
    const handler = ApplicationsController.prototype.bulkDelete;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });
});
