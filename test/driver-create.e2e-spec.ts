import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Application } from "../src/applications/application.entity.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { ApplicationDocumentKind } from "../src/applications/documents/application-document.entity.js";
import { ApplicationDocumentsService } from "../src/applications/documents/application-documents.service.js";
import { MAX_UPLOAD_BYTES } from "../src/applications/documents/upload-file.js";
import { Driver } from "../src/drivers/driver.entity.js";
import {
  DriversService,
  type NewDriverFiles,
} from "../src/drivers/drivers.service.js";
import { AddContractDocumentKind1794086000000 } from "../src/database/migrations/1794086000000-AddContractDocumentKind.js";
import { CreateDriverDto } from "../src/drivers/dto/create-driver.dto.js";
import { UpdateDriverProfileDto } from "../src/drivers/dto/driver-profile.dto.js";
import { ListDriversQueryDto } from "../src/drivers/dto/list-drivers-query.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase } from "./test-database.js";

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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png body"),
]);
const PDF = Buffer.from("%PDF-1.4 pdf body");

/** What multer hands the service for one uploaded file. */
const upload = (buffer: Buffer, name = "file.png"): Express.Multer.File =>
  ({ buffer, size: buffer.length, originalname: name }) as Express.Multer.File;

/** Runs what the global ValidationPipe runs on the multipart text fields and returns the DTO, or the problems. */
function validateCreate(raw: Record<string, unknown>) {
  const dto = plainToInstance(CreateDriverDto, raw);
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

const rawDriver = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Pat",
  lastName: "Driver",
  email: "Pat.Driver@Test.dev",
  phone: "(305) 721-0909",
  ...overrides,
});

describe("an admin adds a driver directly (D85, test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;
  let drivers: DriversService;
  let adminId: string;

  const build = (bucket: FileStorage | null = storage) =>
    new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
      bucket,
    );
  const documentsService = () =>
    new ApplicationDocumentsService(db, { source: null, storage });
  const dtoOf = (overrides: Record<string, unknown> = {}) => {
    const { dto, messages } = validateCreate(rawDriver(overrides));
    expect(messages).toEqual([]);
    return dto;
  };
  const create = (
    overrides: Record<string, unknown> = {},
    files: NewDriverFiles = {},
  ) => drivers.create(dtoOf(overrides), files, adminId);
  const count = async (table: string) =>
    (
      (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)) as [
        { n: number },
      ]
    )[0].n;
  const documentRows = (driverId: string) =>
    db.query(
      `SELECT kind, origin, status, application_id, storage_key, uploaded_by_id
       FROM application_documents WHERE driver_id = $1 ORDER BY kind`,
      [driverId],
    ) as Promise<
      {
        kind: string;
        origin: string;
        status: string;
        application_id: string | null;
        storage_key: string;
        uploaded_by_id: string;
      }[]
    >;

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE application_documents, applications, payment_aliases, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@create.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    storage = new FakeStorage();
    drivers = build();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the form's fields", () => {
    it("needs only a name, an email and a phone", () => {
      expect(validateCreate({}).properties.sort()).toEqual([
        "email",
        "firstName",
        "lastName",
        "phone",
      ]);
      expect(validateCreate(rawDriver()).messages).toEqual([]);
    });

    it("trims text, lower-cases the email and turns empty optional answers into nothing", () => {
      const { dto } = validateCreate(
        rawDriver({
          firstName: "  Pat ",
          middleName: "  ",
          city: " Chicago ",
          dateOfBirth: "",
          hasInsurance: "",
        }),
      );
      expect(dto.firstName).toBe("Pat");
      expect(dto.email).toBe("pat.driver@test.dev");
      expect(dto.middleName).toBeNull();
      expect(dto.city).toBe("Chicago");
      expect(dto.dateOfBirth).toBeNull();
      expect(dto.hasInsurance).toBeNull();
    });

    it("reads the insurance answer from the text a form sends", () => {
      const read = (value: string) =>
        validateCreate(rawDriver({ hasInsurance: value })).dto.hasInsurance;
      expect(read("true")).toBe(true);
      expect(read("yes")).toBe(true);
      expect(read("false")).toBe(false);
      expect(read("no")).toBe(false);
      expect(
        validateCreate(rawDriver({ hasInsurance: "maybe" })).properties,
      ).toContain("hasInsurance");
    });

    it("accepts a real day for the date of birth and nothing else", () => {
      expect(
        validateCreate(rawDriver({ dateOfBirth: "1990-06-15" })).messages,
      ).toEqual([]);
      for (const bad of [
        "06/15/1990",
        "1990-13-01",
        "1990-02-30",
        "yesterday",
      ]) {
        expect(
          validateCreate(rawDriver({ dateOfBirth: bad })).properties,
        ).toContain("dateOfBirth");
      }
    });

    it("reads the aliases from the JSON text of a multipart body", () => {
      const { dto, messages } = validateCreate(
        rawDriver({
          aliases: JSON.stringify([
            { type: "zelle", value: "  Pat   Example " },
          ]),
        }),
      );
      expect(messages).toEqual([]);
      expect(dto.aliases).toHaveLength(1);
      expect(dto.aliases?.[0].value).toBe("Pat Example");
    });

    it("refuses aliases that are not a JSON list, or a method that does not exist", () => {
      expect(
        validateCreate(rawDriver({ aliases: "not json" })).properties,
      ).toContain("aliases");
      expect(
        validateCreate(
          rawDriver({
            aliases: JSON.stringify([{ type: "bitcoin", value: "x" }]),
          }),
        ).properties,
      ).toContain("aliases");
    });
  });

  describe("creating", () => {
    it("saves a driver from the four required fields: onboarding, no login, nothing else", async () => {
      const driver = await drivers.create(dtoOf(), {}, adminId);

      expect(driver).toMatchObject({
        firstName: "Pat",
        lastName: "Driver",
        email: "pat.driver@test.dev",
        phone: "+13057210909",
        status: "onboarding",
        applicationId: null,
        archivedAt: null,
        balanceCents: 0,
        aliases: [],
        profile: {
          middleName: null,
          street: null,
          apt: null,
          city: null,
          state: null,
          zip: null,
          dateOfBirth: null,
          age: null,
          hasInsurance: null,
        },
      });
      const [row] = (await db.query(
        `SELECT user_id, legacy_id FROM drivers WHERE id = $1`,
        [driver.id],
      )) as [{ user_id: string | null; legacy_id: string | null }];
      expect(row.user_id).toBeNull();
      expect(await count("users")).toBe(1); // the admin only: no login for the driver
      expect(await count("application_documents")).toBe(0);
      expect(await count("applications")).toBe(0);
      expect(storage.files.size).toBe(0);
    });

    it("works without a bucket when there are no files", async () => {
      drivers = build(null);
      await expect(create()).resolves.toMatchObject({ status: "onboarding" });
    });

    it("saves the profile, both files and the aliases together", async () => {
      const driver = await create(
        {
          middleName: "Lee",
          street: "100 Test St",
          apt: "4B",
          city: "Chicago",
          state: "IL",
          zip: "60601",
          dateOfBirth: "1990-06-15",
          hasInsurance: "yes",
          aliases: JSON.stringify([
            { type: "zelle", value: "Pat Example" },
            { type: "cashapp", value: "$PatEx" },
          ]),
        },
        {
          license: upload(PNG, "licence.png"),
          earnings: upload(PDF, "earnings.pdf"),
        },
      );

      expect(driver.profile).toMatchObject({
        middleName: "Lee",
        street: "100 Test St",
        apt: "4B",
        city: "Chicago",
        state: "IL",
        zip: "60601",
        dateOfBirth: "1990-06-15",
        hasInsurance: true,
      });
      expect(driver.profile.age).toBeGreaterThanOrEqual(35);
      expect(driver.aliases.map((a) => [a.type, a.value, a.source])).toEqual([
        ["zelle", "Pat Example", "manual"],
        ["cashapp", "$PatEx", "manual"],
      ]);
      const [normalized] = (await db.query(
        `SELECT value_normalized AS v FROM payment_aliases WHERE type = 'cashapp'`,
      )) as [{ v: string }];
      expect(normalized.v).toBe("patex");

      const documents = await documentRows(driver.id);
      expect(documents.map((d) => d.kind)).toEqual(["license", "earnings"]);
      for (const document of documents) {
        expect(document).toMatchObject({
          origin: "admin",
          status: "stored",
          application_id: null,
          uploaded_by_id: adminId,
        });
        expect(document.storage_key).toMatch(
          new RegExp(`^drivers/${driver.id}/${document.kind}-.+\\.(png|pdf)$`),
        );
        expect(storage.files.has(document.storage_key)).toBe(true);
      }
    });

    it("keeps one alias when the same method and handle are typed twice", async () => {
      const driver = await create({
        aliases: JSON.stringify([
          { type: "zelle", value: "Pat Example" },
          { type: "zelle", value: "  pat   example " },
        ]),
      });
      expect(driver.aliases).toHaveLength(1);
    });

    it("stores no profile in the list: the list item has no profile", async () => {
      await create({ street: "100 Test St", dateOfBirth: "1990-06-15" });
      const list = await drivers.list(
        plainToInstance(ListDriversQueryDto, { page: 1, limit: 10 }),
      );
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).not.toHaveProperty("profile");
      expect(JSON.stringify(list)).not.toContain("100 Test St");
      expect(JSON.stringify(list)).not.toContain("1990-06-15");
    });

    it("refuses a date of birth in the future and stores nothing", async () => {
      await expect(create({ dateOfBirth: "2999-01-01" })).rejects.toThrow(
        BadRequestException,
      );
      expect(await count("drivers")).toBe(0);
    });
  });

  describe("what it refuses, and what is left behind", () => {
    it("a phone that is not a US number: 400, nothing stored", async () => {
      await expect(
        create({ phone: "12345" }, { license: upload(PNG) }),
      ).rejects.toThrow(BadRequestException);
      expect(await count("drivers")).toBe(0);
      expect(storage.files.size).toBe(0);
    });

    it("an email a driver already has (any case): 409, no file is put in the bucket", async () => {
      await create();
      await expect(
        create(
          { email: "PAT.DRIVER@test.dev", phone: "3125550199" },
          { license: upload(PNG) },
        ),
      ).rejects.toThrow("A driver with this email already exists.");
      expect(await count("drivers")).toBe(1);
      expect(storage.files.size).toBe(0);
    });

    it("a phone a driver already has is fine: two drivers share it (B117)", async () => {
      await create();
      await create({ email: "other@test.dev", phone: "+1 305-721-0909" });
      expect(await count("drivers WHERE phone = '+13057210909'")).toBe(2);
    });

    it("a file that is not a picture or PDF: 400, nothing stored", async () => {
      await expect(
        create({}, { license: upload(Buffer.from("just text"), "notes.txt") }),
      ).rejects.toThrow("Only JPG, PNG or PDF files, at most 10 MB.");
      expect(await count("drivers")).toBe(0);
      expect(storage.files.size).toBe(0);
    });

    it("a file over 10 MB: 400, nothing stored", async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]);
      await expect(
        create({}, { earnings: upload(big, "big.png") }),
      ).rejects.toThrow(BadRequestException);
      expect(await count("drivers")).toBe(0);
    });

    it("files but no bucket: 503, nothing stored", async () => {
      drivers = build(null);
      await expect(create({}, { license: upload(PNG) })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(await count("drivers")).toBe(0);
    });

    it("the bucket failing on the second file removes the first and stores no driver", async () => {
      storage.failPutAfter = 1;
      await expect(
        create({}, { license: upload(PNG), earnings: upload(PDF) }),
      ).rejects.toThrow("bucket down");
      expect(storage.files.size).toBe(0);
      expect(await count("drivers")).toBe(0);
      expect(await count("application_documents")).toBe(0);
    });

    it("an alias that belongs to another driver: 409 naming the owner, and nothing at all is saved", async () => {
      const owner = await create({
        email: "owner@test.dev",
        phone: "3125550101",
      });
      await drivers.addAlias(
        owner.id,
        { type: "zelle", value: "Shared Name" } as never,
        adminId,
      );
      const before = await count("payment_aliases");

      await expect(
        create(
          {
            aliases: JSON.stringify([
              { type: "venmo", value: "fresh-handle" },
              { type: "zelle", value: "shared name" },
            ]),
          },
          { license: upload(PNG) },
        ),
      ).rejects.toThrow(/belongs to Pat Driver/);

      expect(await count("drivers")).toBe(1);
      expect(await count("payment_aliases")).toBe(before); // the first alias was rolled back too
      expect(await count("application_documents")).toBe(0);
      expect(storage.files.size).toBe(0); // the licence put before the failure is removed again
    });

    it("an invalid alias (a phone that is not a US number): 400, nothing stored", async () => {
      await expect(
        create({ aliases: JSON.stringify([{ type: "phone", value: "123" }]) }),
      ).rejects.toThrow("That is not a US phone number (10 digits).");
      expect(await count("drivers")).toBe(0);
    });

    it("sending the form twice at once makes one driver, and the loser leaves no file behind", async () => {
      const results = await Promise.allSettled([
        create({}, { license: upload(PNG) }),
        create({}, { license: upload(PNG) }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected");
      expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(
        ConflictException,
      );
      expect(await count("drivers")).toBe(1);
      expect(await count("application_documents")).toBe(1);
      expect(storage.files.size).toBe(1);
    });
  });

  describe("editing the profile", () => {
    const edit = (id: string, body: Record<string, unknown>) =>
      drivers.updateProfile(
        id,
        plainToInstance(UpdateDriverProfileDto, body),
        adminId,
      );

    it("changes the fields sent, keeps the ones left out and clears the ones sent empty", async () => {
      const driver = await create({
        street: "100 Test St",
        city: "Chicago",
        state: "IL",
      });

      const changed = await edit(driver.id, {
        city: "Springfield",
        state: "",
        dateOfBirth: "1985-03-01",
        hasInsurance: false,
        middleName: " Lee ",
      });

      expect(changed.profile).toMatchObject({
        street: "100 Test St",
        city: "Springfield",
        state: null,
        dateOfBirth: "1985-03-01",
        hasInsurance: false,
        middleName: "Lee",
      });
      expect(changed.profile.age).toBeGreaterThanOrEqual(41);
      expect(changed.firstName).toBe("Pat"); // names, email and phone are not changed here
    });

    it("refuses a date of birth in the future, and an unknown driver", async () => {
      const driver = await create();
      await expect(
        edit(driver.id, { dateOfBirth: "2999-01-01" }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        edit("00000000-0000-0000-0000-000000000000", { city: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("the list filter for drivers added directly", () => {
    const list = (query: Record<string, unknown>) =>
      drivers.list(
        plainToInstance(ListDriversQueryDto, { page: 1, limit: 20, ...query }),
      );

    it("withoutApplication leaves out drivers who came from an application", async () => {
      const direct = await create();
      const [{ id: fromApplication }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Sam', 'Applied', 'sam@test.dev', '+13125550102') RETURNING id`,
      )) as [{ id: string }];
      await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, driver_id)
         VALUES (gen_random_uuid(), 'Sam', 'Applied', 'sam@test.dev', '3125550102', '{}', 'approved', $1)`,
        [fromApplication],
      );

      const everyone = await list({});
      expect(everyone.total).toBe(2);
      const direct_only = await list({
        withoutApplication: "true",
        status: "onboarding",
      });
      expect(direct_only.items.map((d) => d.id)).toEqual([direct.id]);
      expect((await list({ withoutApplication: "false" })).total).toBe(2);
    });

    it("an archived direct driver is hidden like any other and listed with archived=true", async () => {
      const direct = await create();
      await drivers.archive(direct.id, adminId);
      expect((await list({ withoutApplication: "true" })).total).toBe(0);
      expect(
        (await list({ withoutApplication: "true", archived: "true" })).total,
      ).toBe(1);
    });
  });

  describe("the driver's documents", () => {
    it("lists a direct driver's own files with links, and replaces one in place", async () => {
      const driver = await create({}, { license: upload(PNG, "licence.png") });
      const documents = documentsService();

      const before = await documents.listForDriver(driver.id);
      expect(before.items.map((d) => d.kind)).toEqual(["license"]);
      expect(before.items[0].url).toMatch(/^https:\/\/bucket\.test\/drivers\//);
      const oldKey = (await documentRows(driver.id))[0].storage_key;

      const replaced = await documents.uploadForDriver(
        driver.id,
        ApplicationDocumentKind.license,
        upload(PDF, "new.pdf"),
        adminId,
      );

      expect(replaced.contentType).toBe("application/pdf");
      const rows = await documentRows(driver.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].storage_key).not.toBe(oldKey);
      expect(storage.files.has(oldKey)).toBe(false);
      expect(storage.files.has(rows[0].storage_key)).toBe(true);
    });

    it("fills an empty slot of a direct driver", async () => {
      const driver = await create();
      const documents = documentsService();
      await documents.uploadForDriver(
        driver.id,
        ApplicationDocumentKind.earnings,
        upload(PNG),
        adminId,
      );
      const rows = await documentRows(driver.id);
      expect(rows).toMatchObject([
        { kind: "earnings", origin: "admin", application_id: null },
      ]);
    });

    it("shows and replaces the application's file for a driver who came from an application, never making a second row", async () => {
      const [{ id: driverId }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Sam', 'Applied', 'sam@test.dev', '+13125550102') RETURNING id`,
      )) as [{ id: string }];
      const [{ id: applicationId }] = (await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, driver_id)
         VALUES (gen_random_uuid(), 'Sam', 'Applied', 'sam@test.dev', '3125550102', '{}', 'approved', $1) RETURNING id`,
        [driverId],
      )) as [{ id: string }];
      storage.files.set("applications/old/license.png", {
        body: PNG,
        contentType: "image/png",
      });
      await db.query(
        `INSERT INTO application_documents (application_id, kind, origin, status, storage_key, size_bytes)
         VALUES ($1, 'license', 'admin', 'stored', 'applications/old/license.png', $2)`,
        [applicationId, PNG.length],
      );
      const documents = documentsService();

      expect((await documents.listForDriver(driverId)).items).toHaveLength(1);
      await documents.uploadForDriver(
        driverId,
        ApplicationDocumentKind.license,
        upload(PDF),
        adminId,
      );

      const all = (await db.query(
        `SELECT application_id, driver_id FROM application_documents`,
      )) as { application_id: string | null; driver_id: string | null }[];
      expect(all).toEqual([{ application_id: applicationId, driver_id: null }]);
      expect(storage.files.has("applications/old/license.png")).toBe(false);
    });

    it("an unknown driver is 404", async () => {
      await expect(
        documentsService().listForDriver(
          "00000000-0000-0000-0000-000000000000",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    describe("the signed contract (D90)", () => {
      /** A driver that came from an application that already holds a licence file. */
      async function driverWithApplication() {
        const [{ id: driverId }] = (await db.query(
          `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Sam', 'Applied', 'sam@test.dev', '+13125550102') RETURNING id`,
        )) as [{ id: string }];
        const [{ id: applicationId }] = (await db.query(
          `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, driver_id)
           VALUES (gen_random_uuid(), 'Sam', 'Applied', 'sam@test.dev', '3125550102', '{}', 'approved', $1) RETURNING id`,
          [driverId],
        )) as [{ id: string }];
        storage.files.set("applications/old/license.png", {
          body: PNG,
          contentType: "image/png",
        });
        await db.query(
          `INSERT INTO application_documents (application_id, kind, origin, status, storage_key, size_bytes)
           VALUES ($1, 'license', 'admin', 'stored', 'applications/old/license.png', $2)`,
          [applicationId, PNG.length],
        );
        return { driverId, applicationId };
      }

      it("is kept on a direct driver and listed with a link", async () => {
        const driver = await create();
        const documents = documentsService();

        const slot = await documents.uploadForDriver(
          driver.id,
          ApplicationDocumentKind.contract,
          upload(PDF, "contract.pdf"),
          adminId,
        );

        expect(slot).toMatchObject({
          kind: "contract",
          contentType: "application/pdf",
          origin: "admin",
        });
        const rows = await documentRows(driver.id);
        expect(rows).toMatchObject([
          { kind: "contract", application_id: null, status: "stored" },
        ]);
        expect(rows[0].storage_key).toMatch(
          /^drivers\/[0-9a-f-]+\/contract-[0-9a-f-]+\.pdf$/,
        );
        expect(storage.files.has(rows[0].storage_key)).toBe(true);
        const listed = await documents.listForDriver(driver.id);
        expect(listed.items.map((d) => d.kind)).toEqual(["contract"]);
        expect(listed.items[0].url).toMatch(
          /^https:\/\/bucket\.test\/drivers\//,
        );
      });

      it("belongs to the driver, not the application, and is listed after the application's files", async () => {
        const { driverId, applicationId } = await driverWithApplication();
        const documents = documentsService();

        await documents.uploadForDriver(
          driverId,
          ApplicationDocumentKind.contract,
          upload(PDF),
          adminId,
        );

        const contractRows = (await db.query(
          `SELECT application_id, driver_id FROM application_documents WHERE kind = 'contract'`,
        )) as { application_id: string | null; driver_id: string | null }[];
        expect(contractRows).toEqual([
          { application_id: null, driver_id: driverId },
        ]);
        expect(
          (await documents.listForDriver(driverId)).items.map((d) => d.kind),
        ).toEqual(["license", "contract"]);
        // The application's own page still shows only its application files.
        expect(
          (await documents.list(applicationId)).items.map((d) => d.kind),
        ).toEqual(["license"]);
      });

      it("survives deleting the application, which takes the application's own files with it", async () => {
        const { driverId, applicationId } = await driverWithApplication();
        await documentsService().uploadForDriver(
          driverId,
          ApplicationDocumentKind.contract,
          upload(PDF),
          adminId,
        );

        await db.query(`DELETE FROM applications WHERE id = $1`, [
          applicationId,
        ]);

        const kinds = (await db.query(
          `SELECT kind FROM application_documents ORDER BY kind`,
        )) as { kind: string }[];
        expect(kinds).toEqual([{ kind: "contract" }]);
      });

      it("replaces in place: one row, the old object removed", async () => {
        const driver = await create();
        const documents = documentsService();
        await documents.uploadForDriver(
          driver.id,
          ApplicationDocumentKind.contract,
          upload(PDF, "first.pdf"),
          adminId,
        );
        const oldKey = (await documentRows(driver.id))[0].storage_key;

        await documents.uploadForDriver(
          driver.id,
          ApplicationDocumentKind.contract,
          upload(Buffer.from("%PDF-1.4 second"), "second.pdf"),
          adminId,
        );

        const rows = await documentRows(driver.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].storage_key).not.toBe(oldKey);
        expect(storage.files.has(oldKey)).toBe(false);
        expect(storage.files.has(rows[0].storage_key)).toBe(true);
      });

      it("cannot be put on an application: 400, nothing stored", async () => {
        const { applicationId } = await driverWithApplication();
        const before = storage.files.size;

        await expect(
          documentsService().upload(
            applicationId,
            ApplicationDocumentKind.contract,
            upload(PDF),
            adminId,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(storage.files.size).toBe(before);
        expect(await count("application_documents")).toBe(1);
      });

      it("refuses a file that is not a picture or PDF, and an unknown driver", async () => {
        const driver = await create();
        const documents = documentsService();

        await expect(
          documents.uploadForDriver(
            driver.id,
            ApplicationDocumentKind.contract,
            upload(Buffer.from("just text"), "contract.txt"),
            adminId,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          documents.uploadForDriver(
            "00000000-0000-0000-0000-000000000000",
            ApplicationDocumentKind.contract,
            upload(PDF),
            adminId,
          ),
        ).rejects.toThrow(NotFoundException);

        expect(storage.files.size).toBe(0);
        expect(await count("application_documents")).toBe(0);
      });

      it("the migration refuses to be reverted while a contract is stored (it never deletes one)", async () => {
        const driver = await create();
        await documentsService().uploadForDriver(
          driver.id,
          ApplicationDocumentKind.contract,
          upload(PDF),
          adminId,
        );
        const runner = db.createQueryRunner();
        try {
          await expect(
            new AddContractDocumentKind1794086000000().down(runner),
          ).rejects.toThrow(/1 signed contract file/);
        } finally {
          await runner.release();
        }
        expect(await count("application_documents")).toBe(1);
      });
    });

    it("the database allows a file only one owner", async () => {
      const driver = await create();
      const [{ id: applicationId }] = (await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
         VALUES (gen_random_uuid(), 'A', 'B', 'ab@test.dev', '3125550103', '{}') RETURNING id`,
      )) as [{ id: string }];
      await expect(
        db.query(
          `INSERT INTO application_documents (application_id, driver_id, kind, origin, status, storage_key, size_bytes)
           VALUES ($1, $2, 'license', 'admin', 'stored', 'k', 1)`,
          [applicationId, driver.id],
        ),
      ).rejects.toThrow(/application_documents_one_owner/);
      await expect(
        db.query(
          `INSERT INTO application_documents (kind, origin, status, storage_key, size_bytes)
           VALUES ('license', 'admin', 'stored', 'k', 1)`,
        ),
      ).rejects.toThrow(/application_documents_one_owner/);
    });
  });

  describe("starting onboarding on an application copies its profile to the driver", () => {
    const applications = () =>
      new ApplicationsService(
        db.getRepository(Application),
        db,
        new PasswordService(),
        {} as never,
        {} as never,
        null,
        {} as never,
      );

    const approved = async (
      payload: Record<string, unknown>,
      city: string | null,
      zip: string | null,
    ) =>
      (
        (await db.query(
          `INSERT INTO applications (request_id, first_name, last_name, email, phone, city, zip, payload, status)
           VALUES (gen_random_uuid(), 'Sam', 'Applied', 'sam@test.dev', '3125550102', $1, $2, $3, 'approved') RETURNING id`,
          [city, zip, JSON.stringify(payload)],
        )) as [{ id: string }]
      )[0].id;

    it("takes street, apt, city, zip and insurance; the rest stays empty", async () => {
      const id = await approved(
        { street: "200 Applied Ave", apt: "2", has_insurance: "no" },
        "Springfield",
        "62701",
      );

      const started = await applications().startOnboarding(id, adminId);

      const driver = await drivers.findOne(started.driverId!);
      expect(driver.applicationId).toBe(id);
      expect(driver.profile).toEqual({
        middleName: null,
        street: "200 Applied Ave",
        apt: "2",
        city: "Springfield",
        state: null,
        zip: "62701",
        dateOfBirth: null,
        age: null,
        hasInsurance: false,
      });
    });

    it("an application with none of it gives an empty profile, and the driver can fill it in", async () => {
      const id = await approved({}, null, null);
      const started = await applications().startOnboarding(id, adminId);
      const driver = await drivers.findOne(started.driverId!);
      expect(Object.values(driver.profile).every((v) => v === null)).toBe(true);

      const edited = await drivers.updateProfile(
        driver.id,
        plainToInstance(UpdateDriverProfileDto, {
          state: "IL",
          dateOfBirth: "1992-02-02",
        }),
        adminId,
      );
      expect(edited.profile).toMatchObject({
        state: "IL",
        dateOfBirth: "1992-02-02",
      });
    });
  });
});
