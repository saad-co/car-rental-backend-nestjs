import type { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { Application } from "../src/applications/application.entity.js";
import type { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { ListApplicationsQueryDto } from "../src/applications/dto/list-applications-query.dto.js";
import type { SmsService } from "../src/sms/sms.service.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase } from "./test-database.js";

/** The query DTO as the ValidationPipe builds it from the query string (text in, defaults and trimming applied). */
function query(values: Record<string, string>): ListApplicationsQueryDto {
  const instance = plainToInstance(ListApplicationsQueryDto, values);
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
  return instance;
}

describe("GET /applications: search, status and pages (test database)", () => {
  let db: DataSource;
  let service: ApplicationsService;

  /** The names on a page, in order. */
  const names = async (values: Record<string, string>) =>
    (await service.list(query(values))).items.map(
      (a) => `${a.firstName} ${a.lastName}`,
    );

  async function add(
    firstName: string,
    lastName: string,
    fields: { email?: string; phone?: string; city?: string; status?: string },
  ) {
    await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, city, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', now() - ($8 || ' minutes')::interval)`,
      [
        `req-${firstName}`,
        firstName,
        lastName,
        fields.email ?? `${firstName.toLowerCase()}@test.dev`,
        fields.phone ?? "6305550000",
        fields.city ?? null,
        fields.status ?? "pending",
        // Added in order; each one a minute older, so "newest first" is the order below.
        String(await count()),
      ],
    );
  }
  const count = async () =>
    Number(
      (
        (await db.query("SELECT count(*) AS n FROM applications")) as [
          { n: string },
        ]
      )[0].n,
    );

  beforeAll(async () => {
    db = await openTestDatabase();
    service = new ApplicationsService(
      db.getRepository(Application),
      db,
      new PasswordService(),
      {} as SmsService,
      {} as ApplicationAlertService,
      null,
      {} as MessageTemplatesService,
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE applications, drivers, users CASCADE");
    await add("Patricia", "Gomez", {
      phone: "(312) 555-0101",
      city: "Chicago",
    });
    await add("Sam", "Patel", { city: "Evanston", status: "rejected" });
    await add("Kim", "Lee", {
      email: "kim.lee@mail.test",
      phone: "773-555-0199",
      city: "Los Angeles",
    });
    await add("Ana", "Ruiz", { email: "ana_50%@test.dev", city: "Cicero" });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("without a search, lists everything newest first", async () => {
    expect(await names({})).toEqual([
      "Patricia Gomez",
      "Sam Patel",
      "Kim Lee",
      "Ana Ruiz",
    ]);
  });

  it("matches first or last name anywhere, ignoring case", async () => {
    expect(await names({ search: "PAT" })).toEqual([
      "Patricia Gomez",
      "Sam Patel",
    ]);
  });

  it("matches the full name with a space", async () => {
    expect(await names({ search: "kim lee" })).toEqual(["Kim Lee"]);
  });

  it("matches email and city", async () => {
    expect(await names({ search: "mail.test" })).toEqual(["Kim Lee"]);
    expect(await names({ search: "angeles" })).toEqual(["Kim Lee"]);
  });

  it("matches the phone by its digits, whatever the formatting on either side", async () => {
    expect(await names({ search: "312 555-01" })).toEqual(["Patricia Gomez"]);
    expect(await names({ search: "7735550199" })).toEqual(["Kim Lee"]);
  });

  it("searches % and _ as plain characters, not wildcards", async () => {
    expect(await names({ search: "_50%" })).toEqual(["Ana Ruiz"]);
    expect(await names({ search: "%" })).toEqual(["Ana Ruiz"]);
  });

  it("combines search with the status filter, and counts only the matches", async () => {
    const result = await service.list(
      query({ search: "pat", status: "rejected" }),
    );
    expect(result.items.map((a) => a.firstName)).toEqual(["Sam"]);
    expect(result.total).toBe(1);
  });

  it("pages the matches: 8 rows per page, total counts all of them", async () => {
    for (let i = 0; i < 9; i++) await add(`Extra${i}`, "Applicant", {});
    const first = await service.list(
      query({ search: "applicant", limit: "8" }),
    );
    const second = await service.list(
      query({ search: "applicant", limit: "8", page: "2" }),
    );
    expect(first.items).toHaveLength(8);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(9);
  });

  it("treats an empty or blank search as no search, and refuses one over 100 characters", async () => {
    expect(query({ search: "   " }).search).toBeUndefined();
    expect(await names({ search: "  " })).toHaveLength(4);
    expect(() => query({ search: "x".repeat(101) })).toThrow();
  });
});
