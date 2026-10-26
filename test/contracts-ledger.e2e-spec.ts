import "reflect-metadata";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { addDays, chicagoDate } from "../src/common/chicago-date.js";
import { ContractCompany } from "../src/contracts/contract-company.entity.js";
import { ContractRentJob } from "../src/contracts/contract-rent.job.js";
import { ContractTrackingJob } from "../src/contracts/contract-tracking.job.js";
import { ContractTrackingService } from "../src/contracts/contract-tracking.service.js";
import {
  Contract,
  ContractSchedule,
} from "../src/contracts/contract.entity.js";
import { ContractsService } from "../src/contracts/contracts.service.js";
import type { ContractInputDto } from "../src/contracts/dto/contract.dto.js";
import { Driver, DriverLeftReason } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { OnboardingStep } from "../src/drivers/dto/set-onboarding-step.dto.js";
import {
  FirmaError,
  type FirmaClient,
  type FirmaDownload,
  type FirmaRequestState,
  type FirmaSent,
} from "../src/firma/firma-client.js";
import {
  LedgerDirection,
  LedgerEntryKind,
} from "../src/ledger/ledger-entry.entity.js";
import {
  LedgerPeriod,
  LedgerTypeFilter,
} from "../src/ledger/dto/ledger-read.dto.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { Payment } from "../src/payments/payment.entity.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

const PDF = Buffer.from("%PDF-1.7 made-up signed contract");

/** A firma in memory: a sent request gets an id, and `setSigned` makes it finished with its files. */
class FakeFirma implements FirmaClient {
  private sentCount = 0;
  states = new Map<string, FirmaRequestState>();

  createAndSend(): Promise<FirmaSent> {
    this.sentCount++;
    return Promise.resolve({ signingRequestId: `firma-${this.sentCount}` });
  }

  getSigningRequest(id: string): Promise<FirmaRequestState> {
    const state = this.states.get(id);
    if (!state) return Promise.reject(new FirmaError("not found", 404));
    return Promise.resolve(state);
  }

  download(): Promise<FirmaDownload> {
    return Promise.resolve({ body: PDF, contentType: "application/pdf" });
  }

  setSigned(id: string, endedAt: Date) {
    this.states.set(id, {
      id,
      status: "finished",
      viewedAt: null,
      endedAt,
      signedPdfUrl: `https://files.test/${id}/final.pdf`,
      certificateUrl: `https://files.test/${id}/cert.pdf`,
    });
  }
}

/** A bucket in memory. */
class FakeStorage implements FileStorage {
  files = new Map<string, { body: Buffer; contentType: string | null }>();
  put(key: string, body: Buffer, contentType: string | null) {
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

interface EntryRow {
  kind: string;
  direction: string;
  amount_cents: number;
  description: string;
  day: string;
  created_by_id: string | null;
  idempotency_key: string;
}

describe("Contract charges on the ledger and rent billing (Module 2 step 5, D83, test database)", () => {
  let db: DataSource;
  let firma: FakeFirma;
  let storage: FakeStorage;
  let ledger: LedgerService;
  let drivers: DriversService;
  let tracking: ContractTrackingService;
  let trackingJob: ContractTrackingJob;
  let rentJob: ContractRentJob;
  let contracts: ContractsService;
  let admin: string;
  let driverId: string;
  let ashwoodId: string;

  /** The real clock's Chicago day: `rent_from` is set from it when a driver becomes active. */
  const today = chicagoDate(new Date());
  /** A moment whose Chicago day is the given one (noon UTC is the same day in Chicago all year). */
  const noon = (day: string) => new Date(`${day}T17:00:00Z`);

  const build = (ledgerService: LedgerService = ledger) => {
    drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
    tracking = new ContractTrackingService(
      db,
      firma,
      storage,
      drivers,
      ledgerService,
    );
    trackingJob = new ContractTrackingJob(db, tracking);
    rentJob = new ContractRentJob(db, ledger);
  };

  /** The Ashwood sample: weekly $409 from Tuesday 2026-10-13 with a $200 deposit. */
  const body = (
    overrides: Partial<ContractInputDto> = {},
  ): ContractInputDto => ({
    schedule: ContractSchedule.weekly,
    totalRateCents: 40_900,
    startDate: "2026-10-13",
    termMonths: 18,
    securityDepositCents: 20_000,
    documentationFeeCents: 0,
    insuranceStartFeeCents: 0,
    otherOneTimeCents: 0,
    holdVehicleCents: 0,
    excessMileageCents: 0,
    insuranceExcessCents: 0,
    otherRecurringCents: 0,
    companyId: ashwoodId,
    vehicleModel: "Toyota Camry Hybrid",
    vehicleVin: "1HGCM82633A004352",
    vehiclePlate: "AB12345",
    vehiclePlateState: "IL",
    purchaseOptionCents: 975_000,
    lesseeAddress: "1 Test Ave, Apt 2 Chicago IL 60601",
    licenseNumber: "T123-4567-8901",
    licenseState: "IL",
    dateOfBirth: "1983-04-04",
    ...overrides,
  });

  /** A driver with an application and a licence file, which sending needs. */
  const newDriver = async (n: number): Promise<string> => {
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Test', 'Driver', $1, $2) RETURNING id`,
      [`driver${n}@test.test`, `+1312555010${n}`],
    )) as [{ id: string }];
    const [{ id: applicationId }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, driver_id)
       VALUES (gen_random_uuid(), 'Test', 'Driver', $1, '3125550101', '{}', 'approved', $2) RETURNING id`,
      [`application-${id}@test.test`, id],
    )) as [{ id: string }];
    const key = `application-documents/${applicationId}/license.png`;
    storage.files.set(key, {
      body: await sharp({
        create: { width: 90, height: 60, channels: 3, background: "#888888" },
      })
        .png()
        .toBuffer(),
      contentType: "image/png",
    });
    await db.query(
      `INSERT INTO application_documents (application_id, kind, origin, status, storage_key, size_bytes)
       VALUES ($1, 'license', 'admin', 'stored', $2, 100)`,
      [applicationId, key],
    );
    return id;
  };

  /** Sends a contract (fake firma), without signing it. */
  const sent = async (
    overrides: Partial<ContractInputDto> = {},
    forDriver = driverId,
  ): Promise<{ id: string; firmaId: string }> => {
    const draft = await contracts.createDraft(
      forDriver,
      body(overrides),
      admin,
    );
    const done = await contracts.sendForSigning(draft.id, admin);
    const [{ firma_signing_request_id }] = (await db.query(
      `SELECT firma_signing_request_id FROM contracts WHERE id = $1`,
      [done.id],
    )) as [{ firma_signing_request_id: string }];
    return { id: done.id, firmaId: firma_signing_request_id };
  };

  /** Sends a contract and has the driver sign it (firma finished, our refresh applies it). Returns the contract id. */
  const signed = async (
    overrides: Partial<ContractInputDto> = {},
    signedAt = new Date("2026-10-22T15:00:00Z"),
    forDriver = driverId,
  ): Promise<string> => {
    const { id, firmaId } = await sent(overrides, forDriver);
    firma.setSigned(firmaId, signedAt);
    await tracking.refreshFromFirma(id);
    return id;
  };

  /** Makes the driver `active` as the three steps would, with billing starting from `rentFrom`. */
  const makeActive = (rentFrom: string | null, forDriver = driverId) =>
    db.query(
      `UPDATE drivers SET status = 'active', contract_signed_at = COALESCE(contract_signed_at, now()),
         deposit_paid_at = now(), vehicle_assigned_at = now(), rent_from = $2 WHERE id = $1`,
      [forDriver, rentFrom],
    );

  const entries = async (forDriver = driverId): Promise<EntryRow[]> =>
    (await db.query(
      `SELECT kind, direction, amount_cents, description, effective_date::text AS day, created_by_id, idempotency_key
       FROM ledger_entries WHERE driver_id = $1 ORDER BY entry_no`,
      [forDriver],
    )) as EntryRow[];

  const rentDays = async (forDriver = driverId): Promise<string[]> =>
    (await entries(forDriver))
      .filter((e) => e.kind === "rent")
      .map((e) => e.day);

  const driverRow = async (forDriver = driverId) =>
    (
      (await db.query(
        `SELECT status, contract_signed_at, rent_from::text AS rent_from FROM drivers WHERE id = $1`,
        [forDriver],
      )) as Record<string, any>[]
    )[0];

  const contractStatus = async (id: string): Promise<string> =>
    (
      (await db.query(`SELECT status FROM contracts WHERE id = $1`, [id])) as {
        status: string;
      }[]
    )[0].status;

  const credit = (cents: number, appliesToId?: string) =>
    ledger.addManualEntry(
      driverId,
      {
        direction: LedgerDirection.credit,
        amountCents: cents,
        effectiveDate: today,
        reason: "Cash payment",
        requestKey: randomUUID(),
        appliesToId,
      },
      admin,
    );

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE ledger_entries, contracts, drivers, users CASCADE",
    );
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    storage = new FakeStorage();
    firma = new FakeFirma();
    driverId = await newDriver(1);
    [{ id: ashwoodId }] = (await db.query(
      `SELECT id FROM contract_companies WHERE name = 'Ashwood Holdings LLC'`,
    )) as [{ id: string }];
    ledger = new LedgerService(db);
    build();
    contracts = new ContractsService(
      db.getRepository(Contract),
      db.getRepository(Driver),
      db.getRepository(ContractCompany),
      db,
      firma,
      storage,
    );
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("posting at signing", () => {
    it("puts the deposit and the first rent on the ledger as debits dated the start date, by the system", async () => {
      const id = await signed();

      expect(await entries()).toEqual([
        {
          kind: "contract_charge",
          direction: "debit",
          amount_cents: 20_000,
          description:
            "Security deposit (refundable), contract of October 13, 2026",
          day: "2026-10-13",
          created_by_id: null,
          idempotency_key: `contract:${id}:security_deposit`,
        },
        {
          kind: "rent",
          direction: "debit",
          amount_cents: 40_900,
          description: "Weekly rent, due October 13, 2026",
          day: "2026-10-13",
          created_by_id: null,
          idempotency_key: `rent:${driverId}:2026-10-13`,
        },
      ]);
    });

    it("leaves the driver owing $609.00, and a $609.00 payment brings the balance to $0.00", async () => {
      await signed();
      expect(await ledger.balanceCents(driverId)).toBe(-60_900);

      await credit(60_900);

      expect(await ledger.balanceCents(driverId)).toBe(0);
    });

    it("posts one entry per non-zero one-time charge and skips the zero ones", async () => {
      await signed({
        documentationFeeCents: 15_000,
        insuranceStartFeeCents: 25_000,
        otherOneTimeCents: 1_000,
        holdVehicleCents: 5_000,
      });

      expect((await entries()).map((e) => e.amount_cents)).toEqual([
        20_000, 15_000, 25_000, 1_000, 5_000, 40_900,
      ]);
      expect(await ledger.balanceCents(driverId)).toBe(-106_900);
    });

    it("posts only the first rent when the contract has no one-time charges", async () => {
      await signed({ securityDepositCents: 0 });
      expect((await entries()).map((e) => e.kind)).toEqual(["rent"]);
    });

    it("never posts the recurring extras (mileage, insurance excess, other recurring)", async () => {
      await signed({
        excessMileageCents: 25,
        insuranceExcessCents: 5_000,
        otherRecurringCents: 1_000,
      });
      expect(await ledger.balanceCents(driverId)).toBe(-60_900);
    });

    it("posts the daily contract: deposit $300.00 and daily rent $61.00", async () => {
      await signed({
        schedule: ContractSchedule.daily,
        totalRateCents: 6_100,
        securityDepositCents: 30_000,
      });
      expect(
        (await entries()).map((e) => [e.amount_cents, e.description]),
      ).toEqual([
        [30_000, "Security deposit (refundable), contract of October 13, 2026"],
        [6_100, "Daily rent, October 13, 2026"],
      ]);
    });

    it("posts the pickup charges for a driver who is still onboarding, and the rent job posts nothing for them", async () => {
      await signed();

      expect((await driverRow()).status).toBe("onboarding");
      expect(await entries()).toHaveLength(2);
      const summary = await rentJob.run(noon("2026-12-01"));
      expect(summary).toEqual({ checked: 0, posted: 0, failed: 0 });
      expect(await entries()).toHaveLength(2);
    });

    it("two refreshes and the job at the same moment post once", async () => {
      const { id, firmaId } = await sent();
      firma.setSigned(firmaId, new Date("2026-10-22T15:00:00Z"));

      await Promise.all([
        tracking.refreshFromFirma(id),
        tracking.refreshFromFirma(id),
        trackingJob.run(),
      ]);

      expect(await entries()).toHaveLength(2);
      expect(await contractStatus(id)).toBe("signed");
    });

    it("postSystemDebits skips a key that is already on the ledger", async () => {
      const id = await signed();
      const debits = [
        {
          key: `contract:${id}:security_deposit`,
          amountCents: 20_000,
          kind: LedgerEntryKind.contract_charge,
          description:
            "Security deposit (refundable), contract of October 13, 2026",
          effectiveDate: "2026-10-13",
        },
      ];

      const written = await db.transaction((manager) =>
        ledger.postSystemDebits(manager, driverId, debits),
      );

      expect(written).toBe(0);
      expect(await entries()).toHaveLength(2);
    });

    it("is all or nothing: when posting fails the contract stays sent, nothing is ticked, and the next try posts", async () => {
      const failing = Object.assign(new LedgerService(db), {
        postSystemDebits: () => Promise.reject(new Error("ledger is down")),
      });
      build(failing);
      const { id, firmaId } = await sent();
      firma.setSigned(firmaId, new Date("2026-10-22T15:00:00Z"));

      await expect(tracking.refreshFromFirma(id)).rejects.toThrow(
        "ledger is down",
      );

      expect(await contractStatus(id)).toBe("sent");
      expect((await driverRow()).contract_signed_at).toBeNull();
      expect(await entries()).toEqual([]);

      build();
      await tracking.refreshFromFirma(id);

      expect(await contractStatus(id)).toBe("signed");
      expect((await driverRow()).contract_signed_at).not.toBeNull();
      expect(await entries()).toHaveLength(2);
    });

    it("the job counts a failed posting and leaves the contract for the next run", async () => {
      const failing = Object.assign(new LedgerService(db), {
        postSystemDebits: () => Promise.reject(new Error("ledger is down")),
      });
      build(failing);
      const { id, firmaId } = await sent();
      firma.setSigned(firmaId, new Date("2026-10-22T15:00:00Z"));

      expect(await trackingJob.run()).toMatchObject({ failed: 1, changed: 0 });
      expect(await contractStatus(id)).toBe("sent");

      build();
      expect(await trackingJob.run()).toMatchObject({ changed: 1 });
      expect(await entries()).toHaveLength(2);
    });
  });

  describe("billing starts when a driver becomes active (rent_from)", () => {
    it("is empty for a driver who was never active", async () => {
      expect((await driverRow()).rent_from).toBeNull();
    });

    it("is set to today when the last onboarding step is done by an admin", async () => {
      await signed();
      await drivers.setOnboardingStep(
        driverId,
        OnboardingStep.deposit,
        true,
        admin,
        50_000,
      );
      expect((await driverRow()).rent_from).toBeNull();

      await drivers.setOnboardingStep(
        driverId,
        OnboardingStep.vehicle,
        true,
        admin,
      );

      expect(await driverRow()).toMatchObject({
        status: "active",
        rent_from: today,
      });
    });

    it("is set to today when the signing is the last step", async () => {
      await drivers.setOnboardingStep(
        driverId,
        OnboardingStep.deposit,
        true,
        admin,
        50_000,
      );
      await drivers.setOnboardingStep(
        driverId,
        OnboardingStep.vehicle,
        true,
        admin,
      );
      expect((await driverRow()).status).toBe("onboarding");

      await signed();

      expect(await driverRow()).toMatchObject({
        status: "active",
        rent_from: today,
      });
    });

    it("starts again from today when a step is un-ticked and ticked again", async () => {
      await signed();
      await makeActive("2026-08-04");
      await drivers.setOnboardingStep(
        driverId,
        OnboardingStep.vehicle,
        false,
        admin,
      );
      expect((await driverRow()).status).toBe("onboarding");

      await drivers.setOnboardingStep(
        driverId,
        OnboardingStep.vehicle,
        true,
        admin,
      );

      expect((await driverRow()).rent_from).toBe(today);
    });
  });

  describe("the rent job", () => {
    it("posts every missed due date once (catch-up after downtime), never the same one twice", async () => {
      await signed();
      await makeActive("2026-10-13");

      const first = await rentJob.run(noon("2026-11-03"));

      expect(first).toEqual({ checked: 1, posted: 3, failed: 0 });
      expect(await rentDays()).toEqual([
        "2026-10-13",
        "2026-10-20",
        "2026-10-27",
        "2026-11-03",
      ]);
      const rows = (await entries()).filter((e) => e.kind === "rent");
      expect(rows.every((e) => e.amount_cents === 40_900)).toBe(true);
      expect(rows.every((e) => e.created_by_id === null)).toBe(true);
      expect(rows[3].description).toBe("Weekly rent, due November 3, 2026");

      expect(await rentJob.run(noon("2026-11-03"))).toEqual({
        checked: 1,
        posted: 0,
        failed: 0,
      });
      expect(await rentDays()).toHaveLength(4);
    });

    it("two runs at the same moment post each due date once", async () => {
      await signed();
      await makeActive("2026-10-13");
      const now = noon("2026-11-10");

      const results = await Promise.all([rentJob.run(now), rentJob.run(now)]);

      const posted = results.reduce((sum, r) => sum + (r?.posted ?? 0), 0);
      expect(posted).toBe(4);
      expect(await rentDays()).toEqual([
        "2026-10-13",
        "2026-10-20",
        "2026-10-27",
        "2026-11-03",
        "2026-11-10",
      ]);
    });

    it("never bills a due date before the day billing started", async () => {
      await signed();
      await makeActive("2026-10-21");

      await rentJob.run(noon("2026-11-03"));

      expect(await rentDays()).toEqual([
        "2026-10-13",
        "2026-10-27",
        "2026-11-03",
      ]);
    });

    it("bills the due day itself, on the Chicago day (not the UTC day)", async () => {
      await signed();
      await makeActive("2026-10-13");

      // 04:30 UTC on 10-20 is 11:30 PM on 10-19 in Chicago: not due yet.
      expect(await rentJob.run(new Date("2026-10-20T04:30:00Z"))).toMatchObject(
        { posted: 0 },
      );
      // 05:30 UTC is 12:30 AM on 10-20 in Chicago: due.
      expect(await rentJob.run(new Date("2026-10-20T05:30:00Z"))).toMatchObject(
        { posted: 1 },
      );
      expect(await rentDays()).toEqual(["2026-10-13", "2026-10-20"]);
    });

    it("bills a daily contract every day", async () => {
      await signed({
        schedule: ContractSchedule.daily,
        totalRateCents: 6_100,
        securityDepositCents: 30_000,
      });
      await makeActive("2026-10-13");

      await rentJob.run(noon("2026-10-16"));

      const rows = (await entries()).filter((e) => e.kind === "rent");
      expect(rows.map((e) => e.day)).toEqual([
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
        "2026-10-16",
      ]);
      expect(rows[1]).toMatchObject({
        amount_cents: 6_100,
        description: "Daily rent, October 14, 2026",
      });
    });

    it("keeps billing after the 18 months, because the contract auto-extends", async () => {
      await signed();
      await makeActive("2028-04-01");

      await rentJob.run(noon("2028-04-25"));

      expect(await rentDays()).toEqual([
        "2026-10-13",
        "2028-04-04",
        "2028-04-11",
        "2028-04-18",
        "2028-04-25",
      ]);
    });

    it.each([
      [
        "a driver still in onboarding",
        `UPDATE drivers SET status = 'onboarding', vehicle_assigned_at = NULL WHERE id = $1`,
      ],
      [
        "an inactive driver",
        `UPDATE drivers SET status = 'inactive' WHERE id = $1`,
      ],
      [
        "an archived driver",
        `UPDATE drivers SET archived_at = now() WHERE id = $1`,
      ],
      [
        "an active driver with no billing start",
        `UPDATE drivers SET rent_from = NULL WHERE id = $1`,
      ],
    ])("posts no rent for %s", async (_name, change) => {
      await signed();
      await makeActive("2026-10-13");
      await db.query(change, [driverId]);

      const summary = await rentJob.run(noon("2026-12-01"));

      expect(summary).toEqual({ checked: 0, posted: 0, failed: 0 });
      expect(await rentDays()).toEqual(["2026-10-13"]);
    });

    it("posts nothing for an active driver whose contract is only sent, or who has no contract (the imported ones)", async () => {
      await sent();
      await makeActive("2026-10-13");
      const other = await newDriver(2);
      await makeActive("2026-10-13", other);

      const summary = await rentJob.run(noon("2026-12-01"));

      expect(summary).toMatchObject({ posted: 0, failed: 0 });
      expect(await entries()).toEqual([]);
      expect(await entries(other)).toEqual([]);
    });

    it("bills each driver from their own contract", async () => {
      await signed();
      await makeActive("2026-10-13");
      const other = await newDriver(2);
      await signed(
        {
          schedule: ContractSchedule.daily,
          totalRateCents: 6_100,
          securityDepositCents: 0,
        },
        new Date("2026-10-22T16:00:00Z"),
        other,
      );
      await makeActive("2026-10-13", other);

      const summary = await rentJob.run(noon("2026-10-15"));

      expect(summary).toEqual({ checked: 2, posted: 2, failed: 0 });
      expect(await rentDays(driverId)).toEqual(["2026-10-13"]);
      expect(await rentDays(other)).toEqual([
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
      ]);
    });

    describe("a newer contract", () => {
      it("takes over on its own start date, with no gap and no double day", async () => {
        await signed();
        await signed(
          { totalRateCents: 50_000, startDate: "2026-11-04" },
          new Date("2026-10-30T15:00:00Z"),
        );
        await makeActive("2026-10-13");

        await rentJob.run(noon("2026-11-12"));

        expect(
          (await entries())
            .filter((e) => e.kind === "rent")
            .map((e) => [e.day, e.amount_cents]),
        ).toEqual([
          ["2026-10-13", 40_900],
          ["2026-11-04", 50_000],
          ["2026-10-20", 40_900],
          ["2026-10-27", 40_900],
          ["2026-11-03", 40_900],
          ["2026-11-11", 50_000],
        ]);
      });

      it("one that has not started yet leaves the old contract billing until its start", async () => {
        await signed();
        await signed(
          { totalRateCents: 50_000, startDate: "2026-12-01" },
          new Date("2026-10-30T15:00:00Z"),
        );
        await makeActive("2026-10-13");

        await rentJob.run(noon("2026-11-10"));

        expect(
          (await entries())
            .filter((e) => e.kind === "rent" && e.day > "2026-10-13")
            .map((e) => [e.day, e.amount_cents]),
        ).toEqual([
          ["2026-12-01", 50_000],
          ["2026-10-20", 40_900],
          ["2026-10-27", 40_900],
          ["2026-11-03", 40_900],
          ["2026-11-10", 40_900],
        ]);
      });
    });

    describe("a gap while the driver was not billable is never billed", () => {
      const startDate = "2026-08-04";
      const activeBody = { startDate };

      /** Posts rent up to 08-25, then returns the days posted so far. */
      const billedUntilAugust = async () => {
        await signed(activeBody);
        await makeActive(startDate);
        await rentJob.run(noon("2026-08-25"));
        expect(await rentDays()).toEqual([
          "2026-08-04",
          "2026-08-11",
          "2026-08-18",
          "2026-08-25",
        ]);
      };

      /** The rent days posted after 08-25: none of them may be earlier than `today`. */
      const afterAugust = async () =>
        (await rentDays()).filter((day) => day > "2026-08-25");

      it("a driver deactivated, then reactivated, is billed only from the day they came back", async () => {
        await billedUntilAugust();

        await drivers.deactivate(
          driverId,
          DriverLeftReason.contractEnded,
          admin,
        );
        expect(await rentJob.run(noon(addDays(today, 30)))).toMatchObject({
          checked: 0,
          posted: 0,
        });
        expect(await afterAugust()).toEqual([]);

        await drivers.reactivate(driverId, admin);
        expect((await driverRow()).rent_from).toBe(today);
        await rentJob.run(noon(addDays(today, 14)));

        const days = await afterAugust();
        expect(days.length).toBeGreaterThanOrEqual(2);
        expect(days.every((day) => day >= today)).toBe(true);
      });

      it("a driver archived, then unarchived, is billed only from the day they came back", async () => {
        await billedUntilAugust();

        await drivers.archive(driverId, admin);
        expect(await rentJob.run(noon(addDays(today, 30)))).toMatchObject({
          checked: 0,
          posted: 0,
        });
        expect(await afterAugust()).toEqual([]);

        await drivers.unarchive(driverId, admin);
        expect((await driverRow()).rent_from).toBe(today);
        await rentJob.run(noon(addDays(today, 14)));

        const days = await afterAugust();
        expect(days.length).toBeGreaterThanOrEqual(2);
        expect(days.every((day) => day >= today)).toBe(true);
      });
    });
  });

  describe("a contract charge is a charge", () => {
    it("shows in the charges filter with its CH reference, and can be credited against", async () => {
      await signed();

      const page = await ledger.listPage(driverId, {
        page: 1,
        limit: 50,
        type: LedgerTypeFilter.charges,
      });

      // Newest first: the deposit and the first rent are the same day, so check the set, not the order.
      expect(page.items.map((row) => row.kind).sort()).toEqual([
        "contract_charge",
        "rent",
      ]);
      const deposit = page.items.find((row) => row.kind === "contract_charge")!;
      expect(deposit.ref).toMatch(/^CH-\d+$/);
      expect(deposit.creditableCents).toBe(20_000);

      await credit(5_000, deposit.id);

      const details = await ledger.entryDetails(driverId, deposit.id);
      expect(details.creditableCents).toBe(15_000);
      expect(await ledger.balanceCents(driverId)).toBe(-55_900);
    });

    it("counts in the weekly summary's charges and in the aging buckets", async () => {
      await signed();

      const weeks = await ledger.summary(driverId, {
        period: LedgerPeriod.week,
        from: "2026-10-12",
        to: "2026-10-18",
      });
      expect(
        weeks.items.find((w) => w.start === "2026-10-12")?.chargesCents,
      ).toBe(60_900);

      const { aging, balanceCents } = await ledger.overview(driverId);
      expect(balanceCents).toBe(-60_900);
      expect(
        aging.currentCents +
          aging.days7to13Cents +
          aging.days14to29Cents +
          aging.days30PlusCents,
      ).toBe(60_900);
    });

    it("a deposit entry can be reversed with the existing reversal flow", async () => {
      await signed();
      const [{ id }] = (await db.query(
        `SELECT id FROM ledger_entries WHERE kind = 'contract_charge'`,
      )) as [{ id: string }];

      await ledger.reverse(driverId, id, "Entered in error", admin);

      expect(await ledger.balanceCents(driverId)).toBe(-40_900);
      expect(
        (await entries()).filter((e) => e.kind === "reversal"),
      ).toHaveLength(1);
    });
  });

  describe("the contract page", () => {
    it("lists the recurring lines that are not posted automatically, only the non-zero ones", async () => {
      const none = await contracts.createDraft(driverId, body(), admin);
      expect(none.notPostedAutomatically).toEqual([]);
      await contracts.deleteDraft(none.id);

      const some = await contracts.createDraft(
        driverId,
        body({ excessMileageCents: 25, otherRecurringCents: 1_000 }),
        admin,
      );

      expect(some.notPostedAutomatically).toEqual([
        "Excess mileage per mile",
        "Other recurring charge",
      ]);
    });
  });

  describe("the same start date twice", () => {
    it("posts the first rent once (the key is the due date)", async () => {
      await signed();
      await signed(
        { totalRateCents: 45_000 },
        new Date("2026-10-23T15:00:00Z"),
      );

      expect(await rentDays()).toEqual(["2026-10-13"]);
      expect(
        (await entries()).filter((e) => e.kind === "contract_charge"),
      ).toHaveLength(2);
    });
  });
});
