import { BadRequestException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { chicagoDate } from "../src/common/chicago-date.js";
import { LinkedArchiveBackfill1792660000000 } from "../src/database/migrations/1792660000000-LinkedArchiveBackfill.js";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Application } from "../src/applications/application.entity.js";
import type { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { ListApplicationsQueryDto } from "../src/applications/dto/list-applications-query.dto.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { ListDriversQueryDto } from "../src/drivers/dto/list-drivers-query.dto.js";
import { OnboardingStep } from "../src/drivers/dto/set-onboarding-step.dto.js";
import type { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { Payment } from "../src/payments/payment.entity.js";
import type { SmsService } from "../src/sms/sms.service.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase } from "./test-database.js";

/** A query DTO as the ValidationPipe builds it from the query string (text in, transformed and checked). */
function query<T extends object>(
  type: new () => T,
  values: Record<string, string> = {},
): T {
  const instance = plainToInstance(type, values);
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
  return instance;
}

describe("Approved applications, start onboarding, archive (D80, test database)", () => {
  let db: DataSource;
  let applications: ApplicationsService;
  let drivers: DriversService;
  let adminId: string;

  /** An approved application with no driver yet; returns its id. */
  async function approved(name: string, extra: { archived?: boolean } = {}) {
    const [{ id }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, status, payload, archived_at)
       VALUES ($1, $2, 'Applicant', $3, $4, 'approved', '{}', $5) RETURNING id`,
      [
        `req-${name}`,
        name,
        `${name.toLowerCase()}@test.dev`,
        `(305) 721-${String(1000 + name.length * 7 + name.charCodeAt(0)).slice(-4)}`,
        extra.archived ? new Date() : null,
      ],
    )) as [{ id: string }];
    return id;
  }

  const approvedNames = async (values: Record<string, string> = {}) =>
    (
      await applications.listApproved(query(ListApplicationsQueryDto, values))
    ).items.map((a) => a.firstName);
  const applicationNames = async (values: Record<string, string> = {}) =>
    (await applications.list(query(ListApplicationsQueryDto, values))).items
      .map((a) => a.firstName)
      .sort();
  const driverNames = async (values: Record<string, string> = {}) =>
    (await drivers.list(query(ListDriversQueryDto, values))).items
      .map((d) => d.firstName)
      .sort();

  /** Puts a driver into a status the way the real flow does (all three steps for active). */
  async function setDriver(
    driverId: string,
    status: "onboarding" | "active" | "inactive",
  ) {
    await db.query(
      `UPDATE drivers SET status = $2::driver_status,
         contract_signed_at = CASE WHEN $2::text = 'active' THEN now() ELSE contract_signed_at END,
         deposit_paid_at = CASE WHEN $2::text = 'active' THEN now() ELSE deposit_paid_at END,
         vehicle_assigned_at = CASE WHEN $2::text = 'active' THEN now() ELSE vehicle_assigned_at END
       WHERE id = $1`,
      [driverId, status],
    );
  }

  const archivedAtOf = async (table: string, id: string) =>
    (
      (await db.query(`SELECT archived_at FROM ${table} WHERE id = $1`, [
        id,
      ])) as [{ archived_at: Date | null }]
    )[0].archived_at;

  beforeAll(async () => {
    db = await openTestDatabase();
    applications = new ApplicationsService(
      db.getRepository(Application),
      db,
      new PasswordService(),
      {} as SmsService,
      {} as ApplicationAlertService,
      null,
      {} as MessageTemplatesService,
    );
    drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE payments, payment_aliases, applications, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("start onboarding", () => {
    it("creates the login and the driver in onboarding, and links it to the application", async () => {
      const id = await approved("Pat");
      const detail = await applications.startOnboarding(id, adminId);

      const [driver] = (await db.query(
        `SELECT d.id, d.status, d.email, d.phone, u.role, u.must_change_password
         FROM drivers d JOIN users u ON u.id = d.user_id`,
      )) as {
        id: string;
        status: string;
        email: string;
        phone: string;
        role: string;
        must_change_password: boolean;
      }[];
      expect(driver).toMatchObject({
        status: "onboarding",
        email: "pat@test.dev",
        role: "driver",
        must_change_password: true,
      });
      expect(driver.phone).toMatch(/^\+1305721\d{4}$/);
      expect(detail.driverId).toBe(driver.id);
    });

    it("a second press is refused and creates nothing more", async () => {
      const id = await approved("Pat");
      await applications.startOnboarding(id, adminId);
      await expect(applications.startOnboarding(id, adminId)).rejects.toThrow(
        "Onboarding has already been started",
      );
      expect(
        (
          (await db.query("SELECT count(*)::int AS n FROM drivers")) as [
            { n: number },
          ]
        )[0].n,
      ).toBe(1);
    });

    it("two presses at the same instant create one driver", async () => {
      const id = await approved("Pat");
      const results = await Promise.allSettled([
        applications.startOnboarding(id, adminId),
        applications.startOnboarding(id, adminId),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          (await db.query("SELECT count(*)::int AS n FROM drivers")) as [
            { n: number },
          ]
        )[0].n,
      ).toBe(1);
    });

    it("refuses an application that is not approved", async () => {
      const [{ id }] = (await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
         VALUES ('p1', 'Pen', 'Ding', 'pen@test.dev', '3055550101', '{}') RETURNING id`,
      )) as [{ id: string }];
      await expect(applications.startOnboarding(id, adminId)).rejects.toThrow(
        "Only an approved application can start onboarding.",
      );
    });

    it("refuses an archived application, and an unknown one", async () => {
      const id = await approved("Pat", { archived: true });
      await expect(applications.startOnboarding(id, adminId)).rejects.toThrow(
        "archived",
      );
      await expect(
        applications.startOnboarding(
          "00000000-0000-4000-8000-000000000000",
          adminId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses an email a driver already has, and creates nothing", async () => {
      const first = await approved("Pat");
      await applications.startOnboarding(first, adminId);
      const [{ id: second }] = (await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, status, payload)
         VALUES ('dup', 'Pat', 'Again', 'pat@test.dev', '3055550199', 'approved', '{}') RETURNING id`,
      )) as [{ id: string }];
      await expect(
        applications.startOnboarding(second, adminId),
      ).rejects.toThrow("A driver with this email already exists.");
      expect(await archivedAtOf("applications", second)).toBeNull();
      expect(
        (
          (await db.query("SELECT count(*)::int AS n FROM drivers")) as [
            { n: number },
          ]
        )[0].n,
      ).toBe(1);
    });
  });

  describe("the Approved applications list", () => {
    it("lists approved applications with no driver or an onboarding driver, with the progress", async () => {
      const noDriver = await approved("Ann");
      const onboarding = await approved("Bob");
      const active = await approved("Cy");
      const inactive = await approved("Di");
      await applications.startOnboarding(onboarding, adminId);
      await applications.startOnboarding(active, adminId);
      await applications.startOnboarding(inactive, adminId);
      const driverOf = async (appId: string) =>
        (
          (await db.query(`SELECT driver_id FROM applications WHERE id = $1`, [
            appId,
          ])) as [{ driver_id: string }]
        )[0].driver_id;
      await setDriver(await driverOf(active), "active");
      await setDriver(await driverOf(inactive), "inactive");
      await drivers.setOnboardingStep(
        await driverOf(onboarding),
        OnboardingStep.deposit,
        true,
        adminId,
        50_000,
      );

      const page = await applications.listApproved(
        query(ListApplicationsQueryDto),
      );
      expect(page.items.map((a) => a.firstName).sort()).toEqual(["Ann", "Bob"]);
      expect(page.total).toBe(2);
      const byName = Object.fromEntries(
        page.items.map((a) => [a.firstName, a.driver]),
      );
      expect(byName.Ann).toBeNull();
      expect(byName.Bob).toMatchObject({
        status: "onboarding",
        contractSignedAt: null,
        vehicleAssignedAt: null,
      });
      expect(byName.Bob?.depositPaidAt).not.toBeNull();
      expect(noDriver).toBeDefined();
    });

    it("leaves out applications that are not approved, and honours the search", async () => {
      await approved("Ann");
      await approved("Bob");
      await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
         VALUES ('p1', 'Pen', 'Ding', 'pen@test.dev', '3055550101', '{}')`,
      );
      expect((await approvedNames()).sort()).toEqual(["Ann", "Bob"]);
      expect(await approvedNames({ search: "bob" })).toEqual(["Bob"]);
    });

    it("hides archived ones unless asked, and then shows only them", async () => {
      await approved("Ann");
      await approved("Bob", { archived: true });
      expect(await approvedNames()).toEqual(["Ann"]);
      expect(await approvedNames({ archived: "false" })).toEqual(["Ann"]);
      expect(await approvedNames({ archived: "true" })).toEqual(["Bob"]);
    });
  });

  describe("archive and unarchive an application", () => {
    it("hides it from the main list and the Archived filter shows it; unarchive brings it back", async () => {
      const id = await approved("Ann");
      await approved("Bob");
      const archived = await applications.archive(id, adminId);
      expect(archived.archivedAt).not.toBeNull();
      expect(await applicationNames()).toEqual(["Bob"]);
      expect(await applicationNames({ archived: "true" })).toEqual(["Ann"]);

      const back = await applications.unarchive(id, adminId);
      expect(back.archivedAt).toBeNull();
      expect(await applicationNames()).toEqual(["Ann", "Bob"]);
      expect(await applicationNames({ archived: "true" })).toEqual([]);
    });

    it("works for any status, and repeating it changes nothing", async () => {
      const [{ id }] = (await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
         VALUES ('p1', 'Pen', 'Ding', 'pen@test.dev', '3055550101', '{}') RETURNING id`,
      )) as [{ id: string }];
      await applications.archive(id, adminId);
      const first = await archivedAtOf("applications", id);
      await applications.archive(id, adminId);
      expect(await archivedAtOf("applications", id)).toEqual(first);
      await applications.unarchive(id, adminId);
      await applications.unarchive(id, adminId);
      expect(await archivedAtOf("applications", id)).toBeNull();
    });

    it("an approved application in onboarding takes its driver with it, and brings it back", async () => {
      const id = await approved("Ann");
      const { driverId } = await applications.startOnboarding(id, adminId);
      await applications.archive(id, adminId);
      expect(await archivedAtOf("drivers", driverId!)).not.toBeNull();
      expect(await approvedNames()).toEqual([]);
      expect(await approvedNames({ archived: "true" })).toEqual(["Ann"]);

      await applications.unarchive(id, adminId);
      expect(await archivedAtOf("drivers", driverId!)).toBeNull();
      expect(await approvedNames()).toEqual(["Ann"]);
    });

    it("archives an active or inactive driver with it, and unarchive brings both back (D84)", async () => {
      for (const status of ["active", "inactive"] as const) {
        const id = await approved(`Ann${status}`);
        const { driverId } = await applications.startOnboarding(id, adminId);
        await setDriver(driverId!, status);
        const archived = await applications.archive(id, adminId);
        expect(archived.archivedAt).not.toBeNull();
        expect(await archivedAtOf("drivers", driverId!)).not.toBeNull();
        // The driver keeps the status it had.
        expect((await drivers.findOne(driverId!)).status).toBe(status);

        await applications.unarchive(id, adminId);
        expect(await archivedAtOf("applications", id)).toBeNull();
        expect(await archivedAtOf("drivers", driverId!)).toBeNull();
      }
    });

    it("an unknown application is a 404", async () => {
      await expect(
        applications.archive("00000000-0000-4000-8000-000000000000", adminId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("delete is unchanged: an approved application still cannot be deleted", async () => {
      const id = await approved("Ann");
      await applications.archive(id, adminId);
      await expect(applications.deleteMany([id], adminId)).rejects.toThrow(
        "Approved applications cannot be deleted",
      );
    });
  });

  describe("the application and its driver are archived together (D84)", () => {
    /** A driver made through the real start-onboarding path; returns both ids. */
    async function pair(
      name: string,
      status: "onboarding" | "active" | "inactive",
    ) {
      const applicationId = await approved(name);
      const { driverId } = await applications.startOnboarding(
        applicationId,
        adminId,
      );
      await setDriver(driverId!, status);
      return { applicationId, driverId: driverId! };
    }

    it("archiving the driver archives the application, and unarchiving the driver brings both back", async () => {
      const { applicationId, driverId } = await pair("Ann", "active");
      await drivers.archive(driverId, adminId);
      expect(await archivedAtOf("applications", applicationId)).not.toBeNull();
      expect(await applicationNames({ archived: "true" })).toEqual(["Ann"]);

      await drivers.unarchive(driverId, adminId);
      expect(await archivedAtOf("applications", applicationId)).toBeNull();
      expect(await archivedAtOf("drivers", driverId)).toBeNull();
    });

    it("both rows get the same archive time", async () => {
      const { applicationId, driverId } = await pair("Ann", "inactive");
      await applications.archive(applicationId, adminId);
      expect(await archivedAtOf("applications", applicationId)).toEqual(
        await archivedAtOf("drivers", driverId),
      );
    });

    it("a driver with no application (imported) is archived alone", async () => {
      const { applicationId, driverId } = await pair("Ann", "active");
      await db.query(`UPDATE applications SET driver_id = NULL WHERE id = $1`, [
        applicationId,
      ]);
      await drivers.archive(driverId, adminId);
      expect(await archivedAtOf("drivers", driverId)).not.toBeNull();
      expect(await archivedAtOf("applications", applicationId)).toBeNull();
      expect((await drivers.findOne(driverId)).applicationId).toBeNull();
    });

    it("unarchiving an active driver starts billing from today, so the days away are never billed (D83)", async () => {
      const { applicationId, driverId } = await pair("Ann", "active");
      await db.query(
        `UPDATE drivers SET rent_from = '2026-01-05' WHERE id = $1`,
        [driverId],
      );
      await applications.archive(applicationId, adminId);
      await applications.unarchive(applicationId, adminId);
      const [{ rent_from }] = (await db.query(
        `SELECT rent_from::text FROM drivers WHERE id = $1`,
        [driverId],
      )) as [{ rent_from: string }];
      expect(rent_from).toBe(chicagoDate(new Date()));
    });

    it("the driver and the application link to each other", async () => {
      const { applicationId, driverId } = await pair("Ann", "active");
      expect((await drivers.findOne(driverId)).applicationId).toBe(
        applicationId,
      );
      const detail = await applications.findOne(applicationId);
      expect(detail.driverId).toBe(driverId);
      expect(detail.driverStatus).toBe("active");
    });

    it("pressing Archive on both pages at the same instant ends with both archived and no deadlock", async () => {
      const { applicationId, driverId } = await pair("Ann", "active");
      await Promise.all([
        applications.archive(applicationId, adminId),
        drivers.archive(driverId, adminId),
        applications.archive(applicationId, adminId),
        drivers.archive(driverId, adminId),
      ]);
      expect(await archivedAtOf("applications", applicationId)).not.toBeNull();
      expect(await archivedAtOf("drivers", driverId)).not.toBeNull();
      await Promise.all([
        applications.unarchive(applicationId, adminId),
        drivers.unarchive(driverId, adminId),
      ]);
      expect(await archivedAtOf("applications", applicationId)).toBeNull();
      expect(await archivedAtOf("drivers", driverId)).toBeNull();
    });
  });

  describe("the Applications list leaves out people who became drivers (D84)", () => {
    async function seed() {
      await db.query(
        `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
         VALUES ('p1', 'Pen', 'Ding', 'pen@test.dev', '3055550101', '{}')`,
      );
      await approved("NoDriver");
      for (const [name, status] of [
        ["Onb", "onboarding"],
        ["Act", "active"],
        ["Ina", "inactive"],
      ] as const) {
        const id = await approved(name);
        const { driverId } = await applications.startOnboarding(id, adminId);
        await setDriver(driverId!, status);
      }
    }

    it("the default list has applications without a driver or with one in onboarding", async () => {
      await seed();
      expect(await applicationNames()).toEqual(["NoDriver", "Onb", "Pen"]);
    });

    it("becameDriver=true lists only the active and inactive ones", async () => {
      await seed();
      expect(await applicationNames({ becameDriver: "true" })).toEqual([
        "Act",
        "Ina",
      ]);
    });

    it("the status filter and the search work on both views", async () => {
      await seed();
      expect(
        await applicationNames({ status: "pending", becameDriver: "true" }),
      ).toEqual([]);
      expect(await applicationNames({ status: "approved" })).toEqual([
        "NoDriver",
        "Onb",
      ]);
      expect(
        await applicationNames({ becameDriver: "true", search: "ina" }),
      ).toEqual(["Ina"]);
    });

    it("archived=true lists the archived ones whatever their driver, and not together with becameDriver", async () => {
      await seed();
      const [{ id }] = (await db.query(
        `SELECT id FROM applications WHERE first_name = 'Act'`,
      )) as [{ id: string }];
      await applications.archive(id, adminId);
      expect(await applicationNames({ archived: "true" })).toEqual(["Act"]);
      expect(await applicationNames({ becameDriver: "true" })).toEqual(["Ina"]);
      await expect(
        applications.list(
          query(ListApplicationsQueryDto, {
            archived: "true",
            becameDriver: "true",
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a bad becameDriver value", () => {
      expect(() =>
        query(ListApplicationsQueryDto, { becameDriver: "maybe" }),
      ).toThrow();
    });

    it("the list rows carry the driver's status", async () => {
      await seed();
      const rows = (
        await applications.list(
          query(ListApplicationsQueryDto, { becameDriver: "true" }),
        )
      ).items;
      expect(rows.map((r) => r.driverStatus)).toEqual(
        expect.arrayContaining(["active", "inactive"]),
      );
      expect(rows).toHaveLength(2);
    });

    it("the Approved applications page is unchanged", async () => {
      await seed();
      expect((await approvedNames()).sort()).toEqual(["NoDriver", "Onb"]);
    });
  });

  describe("backfill of applications of drivers archived before D84", () => {
    it("archives the application of an already archived driver, and nothing else", async () => {
      const a = await approved("Old");
      const { driverId } = await applications.startOnboarding(a, adminId);
      await setDriver(driverId!, "active");
      await db.query(`UPDATE drivers SET archived_at = now() WHERE id = $1`, [
        driverId,
      ]);
      const b = await approved("Live");
      const { driverId: liveDriver } = await applications.startOnboarding(
        b,
        adminId,
      );
      await setDriver(liveDriver!, "active");
      const c = await approved("Alone");

      const runner = db.createQueryRunner();
      try {
        await new LinkedArchiveBackfill1792660000000().up(runner);
      } finally {
        await runner.release();
      }
      expect(await archivedAtOf("applications", a)).toEqual(
        await archivedAtOf("drivers", driverId!),
      );
      expect(await archivedAtOf("applications", b)).toBeNull();
      expect(await archivedAtOf("applications", c)).toBeNull();
    });
  });

  describe("drivers: archive, unarchive and the lists", () => {
    /** A driver with a given status, made through the real start-onboarding path. */
    async function driver(
      name: string,
      status: "onboarding" | "active" | "inactive",
    ) {
      const id = await approved(name);
      const { driverId } = await applications.startOnboarding(id, adminId);
      await setDriver(driverId!, status);
      return driverId!;
    }

    it("archives an active driver directly (no need to deactivate), keeping the status; unarchive restores it", async () => {
      const id = await driver("Ann", "active");
      const archived = await drivers.archive(id, adminId);
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.status).toBe("active");
      expect(await driverNames()).toEqual([]);
      expect(await driverNames({ archived: "true" })).toEqual(["Ann"]);

      const back = await drivers.unarchive(id, adminId);
      expect(back.archivedAt).toBeNull();
      expect(back.status).toBe("active");
      expect(await driverNames()).toEqual(["Ann"]);
    });

    it("archives an inactive driver, and does not touch the login", async () => {
      const id = await driver("Bob", "inactive");
      const before = (await db.query(
        `SELECT u.active FROM users u JOIN drivers d ON d.user_id = u.id WHERE d.id = $1`,
        [id],
      )) as { active: boolean }[];
      await drivers.archive(id, adminId);
      const after = (await db.query(
        `SELECT u.active FROM users u JOIN drivers d ON d.user_id = u.id WHERE d.id = $1`,
        [id],
      )) as { active: boolean }[];
      expect(after).toEqual(before);
    });

    it("repeating archive or unarchive changes nothing", async () => {
      const id = await driver("Ann", "active");
      await drivers.archive(id, adminId);
      const first = await archivedAtOf("drivers", id);
      await drivers.archive(id, adminId);
      expect(await archivedAtOf("drivers", id)).toEqual(first);
      await drivers.unarchive(id, adminId);
      await drivers.unarchive(id, adminId);
      expect(await archivedAtOf("drivers", id)).toBeNull();
    });

    it("archives a driver still in onboarding too, with their application (D84)", async () => {
      const id = await driver("Cy", "onboarding");
      await drivers.archive(id, adminId);
      expect(await archivedAtOf("drivers", id)).not.toBeNull();
      expect(await approvedNames()).toEqual([]);
      await drivers.unarchive(id, adminId);
      expect(await archivedAtOf("drivers", id)).toBeNull();
      expect(await approvedNames()).toEqual(["Cy"]);
    });

    it("an unknown driver is a 404", async () => {
      await expect(
        drivers.archive("00000000-0000-4000-8000-000000000000", adminId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("onboarding=false leaves out drivers in onboarding; without it every status is listed (payment pickers)", async () => {
      await driver("Ann", "active");
      await driver("Bob", "inactive");
      await driver("Cy", "onboarding");
      expect(await driverNames({ onboarding: "false" })).toEqual([
        "Ann",
        "Bob",
      ]);
      expect(await driverNames()).toEqual(["Ann", "Bob", "Cy"]);
      expect(await driverNames({ status: "onboarding" })).toEqual(["Cy"]);
    });

    it("an archived onboarding driver is hidden from the default list too", async () => {
      const id = await approved("Cy");
      await applications.startOnboarding(id, adminId);
      await applications.archive(id, adminId);
      expect(await driverNames()).toEqual([]);
      expect(await driverNames({ archived: "true" })).toEqual(["Cy"]);
    });

    it("rejects a bad archived value", () => {
      expect(() => query(ListDriversQueryDto, { archived: "maybe" })).toThrow();
      expect(() => query(ListDriversQueryDto, { onboarding: "1" })).toThrow();
    });

    it("an archived driver keeps their payments and still counts as a driver for matching", async () => {
      const id = await driver("Ann", "active");
      await drivers.archive(id, adminId);
      // Matching loads every driver without a filter (MatchingService), so an archived one is still found.
      const all = await db.getRepository(Driver).find();
      expect(all.map((d) => d.id)).toContain(id);
      expect((await drivers.findOne(id)).archivedAt).not.toBeNull();
    });
  });
});
