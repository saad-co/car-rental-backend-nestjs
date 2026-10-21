import "reflect-metadata";
import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import type { Request } from "express";
import type { DataSource } from "typeorm";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { ContractCompany } from "../src/contracts/contract-company.entity.js";
import { ContractTrackingJob } from "../src/contracts/contract-tracking.job.js";
import { ContractTrackingService } from "../src/contracts/contract-tracking.service.js";
import {
  Contract,
  ContractSchedule,
  ContractStatus,
} from "../src/contracts/contract.entity.js";
import { ContractsController } from "../src/contracts/contracts.controller.js";
import { ContractsService } from "../src/contracts/contracts.service.js";
import type { ContractInputDto } from "../src/contracts/dto/contract.dto.js";
import { FirmaWebhookController } from "../src/contracts/firma-webhook.controller.js";
import { Driver, DriverStatus } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { OnboardingStep } from "../src/drivers/dto/set-onboarding-step.dto.js";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Payment } from "../src/payments/payment.entity.js";
import {
  FirmaError,
  type FirmaClient,
  type FirmaDownload,
  type FirmaLookupOptions,
  type FirmaRequestState,
  type FirmaSent,
} from "../src/firma/firma-client.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

const SECRET = "a-made-up-webhook-secret";
const PDF = Buffer.from("%PDF-1.7 made-up signed contract");
const CERT = Buffer.from("%PDF-1.7 made-up certificate");

/** A firma in memory: its answers are set per request, calls are counted, and it can be told to fail or be slow. */
class FakeFirma implements FirmaClient {
  private sentCount = 0;
  states = new Map<string, FirmaRequestState>();
  files = new Map<string, FirmaDownload | Error>();
  lookups: { id: string; options?: FirmaLookupOptions }[] = [];
  downloads: string[] = [];
  failLookups: Error | null = null;
  lookupDelayMs = 0;

  createAndSend(): Promise<FirmaSent> {
    this.sentCount++;
    return Promise.resolve({ signingRequestId: `firma-${this.sentCount}` });
  }

  async getSigningRequest(
    id: string,
    options?: FirmaLookupOptions,
  ): Promise<FirmaRequestState> {
    this.lookups.push({ id, options });
    if (this.lookupDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.lookupDelayMs));
    }
    if (this.failLookups) throw this.failLookups;
    const state = this.states.get(id);
    if (!state) throw new FirmaError("Signing request not found", 404);
    return state;
  }

  download(url: string): Promise<FirmaDownload> {
    this.downloads.push(url);
    const file = this.files.get(url);
    if (!file) return Promise.reject(new FirmaError("link gone", 403));
    return file instanceof Error ? Promise.reject(file) : Promise.resolve(file);
  }

  /** Sets what firma says about a request. */
  set(id: string, state: Partial<FirmaRequestState>) {
    this.states.set(id, {
      id,
      status: "sent",
      viewedAt: null,
      endedAt: null,
      signedPdfUrl: null,
      certificateUrl: null,
      ...state,
    });
  }

  /** A signed request with its files ready to download. */
  setSigned(id: string, endedAt = new Date("2026-10-22T15:00:00Z")) {
    this.set(id, {
      status: "finished",
      endedAt,
      signedPdfUrl: `https://files.test/${id}/final.pdf`,
      certificateUrl: `https://files.test/${id}/cert.pdf`,
    });
    this.files.set(`https://files.test/${id}/final.pdf`, {
      body: PDF,
      contentType: "application/pdf",
    });
    this.files.set(`https://files.test/${id}/cert.pdf`, {
      body: CERT,
      contentType: "application/pdf",
    });
  }
}

/** A bucket in memory. */
class FakeStorage implements FileStorage {
  files = new Map<string, { body: Buffer; contentType: string | null }>();
  puts = 0;
  put(key: string, body: Buffer, contentType: string | null) {
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

/** The request a controller sees: the raw bytes and the parsed body. */
function webhookRequest(
  body: unknown,
  rawBody = Buffer.from(JSON.stringify(body)),
) {
  return { rawBody, body } as unknown as RawBodyRequest<Request>;
}

/** The header firma sends: `t=<unix>,v1=<hex>` over `<t>.<raw body>`. */
function sign(rawBody: Buffer, secret = SECRET, t = "1790000000") {
  const digest = createHmac("sha256", secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest("hex");
  return `t=${t},v1=${digest}`;
}

const event = (type: string, firmaId: string) => ({
  id: "evt_1",
  type,
  data: { signing_request: { id: firmaId } },
});

describe("Track and file a signed contract (Module 2 step 4, D75, test database)", () => {
  let db: DataSource;
  let firma: FakeFirma;
  let storage: FakeStorage;
  let driversService: DriversService;
  let tracking: ContractTrackingService;
  let job: ContractTrackingJob;
  let webhook: FirmaWebhookController;
  let contractsService: ContractsService;
  let admin: string;
  let driverId: string;
  let ashwoodId: string;

  const config = (secret: string | undefined) =>
    ({
      get: (key: string) =>
        key === "FIRMA_WEBHOOK_SECRET" ? secret : undefined,
    }) as unknown as ConfigService;

  const build = (opts: { storage?: FakeStorage | null } = {}) => {
    const bucket = opts.storage === undefined ? storage : opts.storage;
    driversService = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
    tracking = new ContractTrackingService(db, firma, bucket, driversService);
    job = new ContractTrackingJob(db, tracking);
    webhook = new FirmaWebhookController(tracking, config(SECRET));
  };

  const completeBody = (): ContractInputDto => ({
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
  });

  const newDriver = async (n: number): Promise<string> => {
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Test', 'Driver', $1, $2) RETURNING id`,
      [`driver${n}@test.test`, `+1312555010${n}`],
    )) as [{ id: string }];
    return id;
  };

  /** A contract sent through the real service (fake firma): its firma id is `firma-N`. Returns both ids. */
  const sentContract = async (
    forDriver = driverId,
  ): Promise<{ id: string; firmaId: string }> => {
    const draft = await contractsService.createDraft(
      forDriver,
      completeBody(),
      admin,
    );
    const sent = await contractsService.sendForSigning(draft.id, admin);
    const [{ firma_signing_request_id }] = (await db.query(
      `SELECT firma_signing_request_id FROM contracts WHERE id = $1`,
      [sent.id],
    )) as [{ firma_signing_request_id: string }];
    return { id: sent.id, firmaId: firma_signing_request_id };
  };

  const contractRow = async (id: string) =>
    (
      (await db.query(
        `SELECT status, status_updated_at, signed_at, signed_pdf_key, certificate_key, documents_error, updated_at
         FROM contracts WHERE id = $1`,
        [id],
      )) as Record<string, any>[]
    )[0];

  const driverRow = async (id = driverId) =>
    (
      (await db.query(
        `SELECT status, contract_signed_at, contract_signed_by_id, deposit_paid_at, vehicle_assigned_at
         FROM drivers WHERE id = $1`,
        [id],
      )) as Record<string, any>[]
    )[0];

  /** Ticks deposit and vehicle (by an admin), so that signing is the last step. */
  const tickDepositAndVehicle = async () => {
    await driversService.setOnboardingStep(
      driverId,
      OnboardingStep.deposit,
      true,
      admin,
    );
    await driversService.setOnboardingStep(
      driverId,
      OnboardingStep.vehicle,
      true,
      admin,
    );
  };

  const deliver = (body: unknown, header?: string) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    return webhook.receive(
      webhookRequest(body, rawBody),
      header ?? sign(rawBody),
      undefined,
    );
  };

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE contracts, drivers, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    driverId = await newDriver(1);
    [{ id: ashwoodId }] = (await db.query(
      `SELECT id FROM contract_companies WHERE name = 'Ashwood Holdings LLC'`,
    )) as [{ id: string }];
    firma = new FakeFirma();
    storage = new FakeStorage();
    build();
    contractsService = new ContractsService(
      db.getRepository(Contract),
      db.getRepository(Driver),
      db.getRepository(ContractCompany),
      db,
      firma,
    );
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("the webhook", () => {
    it("marks a finished request signed, sets signed_at and ticks Contract signed by the system", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);

      const answer = await deliver(event("signing_request.completed", firmaId));

      expect(answer).toEqual({ result: "refreshed: signed" });
      const row = await contractRow(id);
      expect(row.status).toBe("signed");
      expect(row.signed_at).toEqual(new Date("2026-10-22T15:00:00Z"));
      expect(row.status_updated_at).toEqual(new Date("2026-10-22T15:00:00Z"));
      const driver = await driverRow();
      expect(driver.contract_signed_at).toEqual(
        new Date("2026-10-22T15:00:00Z"),
      );
      expect(driver.contract_signed_by_id).toBeNull();
      expect(driver.status).toBe("onboarding"); // deposit and vehicle are not done
    });

    it("makes the driver active when deposit and vehicle are already done", async () => {
      await tickDepositAndVehicle();
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);

      await deliver(event("signing_request.completed", firmaId));

      expect((await driverRow()).status).toBe("active");
    });

    it("changes nothing when the same event arrives twice", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      await deliver(event("signing_request.completed", firmaId));
      const before = await contractRow(id);
      const driverBefore = await driverRow();

      await deliver(event("signing_request.completed", firmaId));

      expect(await contractRow(id)).toEqual(before); // updated_at too: nothing was written
      expect(await driverRow()).toEqual(driverBefore);
    });

    it("never believes the body: an event saying 'completed' for a request firma still shows as sent changes nothing", async () => {
      const { id, firmaId } = await sentContract();
      firma.set(firmaId, { status: "sent" });

      const answer = await deliver(event("signing_request.completed", firmaId));

      expect(answer).toEqual({ result: "refreshed: sent" });
      expect((await contractRow(id)).status).toBe("sent");
      expect((await driverRow()).contract_signed_at).toBeNull();
    });

    it("refuses a bad signature (401) before reading the body, and does not ask firma", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      const body = event("signing_request.completed", firmaId);
      const rawBody = Buffer.from(JSON.stringify(body));

      await expect(
        webhook.receive(
          webhookRequest(body, rawBody),
          sign(rawBody, "wrong-secret"),
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        webhook.receive(webhookRequest(body, rawBody), undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const tampered = Buffer.from(
        JSON.stringify(body).replace(firmaId, "firma-9"),
      );
      await expect(
        webhook.receive(
          webhookRequest(body, tampered),
          sign(rawBody),
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(firma.lookups).toHaveLength(0);
      expect((await contractRow(id)).status).toBe("sent");
    });

    it("accepts the old secret's header during a rotation", async () => {
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);
      const body = event("signing_request.completed", firmaId);
      const rawBody = Buffer.from(JSON.stringify(body));

      const answer = await webhook.receive(
        webhookRequest(body, rawBody),
        "t=1,v1=00",
        sign(rawBody),
      );

      expect(answer).toEqual({ result: "refreshed: signed" });
    });

    it("answers 503 when no webhook secret is set", async () => {
      const unconfigured = new FirmaWebhookController(
        tracking,
        config(undefined),
      );
      const body = event("signing_request.completed", "firma-1");
      await expect(
        unconfigured.receive(
          webhookRequest(body),
          sign(Buffer.from(JSON.stringify(body))),
          undefined,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("answers 500 when the raw body is missing", async () => {
      const request = { body: {} } as unknown as RawBodyRequest<Request>;
      await expect(
        webhook.receive(request, "t=1,v1=00", undefined),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it("ignores a request that is not ours, and events that are not about signing requests", async () => {
      const { id } = await sentContract();

      expect(
        await deliver(event("signing_request.completed", "someone-elses")),
      ).toEqual({
        result: "ignored: unknown signing request",
      });
      expect(await deliver(event("template.updated", "firma-1"))).toEqual({
        result: "ignored: not a signing request event",
      });
      expect(await deliver({ type: "signing_request.sent", data: {} })).toEqual(
        {
          result: "ignored: no signing request id",
        },
      );
      expect(await deliver([1, 2])).toEqual({
        result: "ignored: not a signing request event",
      });

      expect(firma.lookups).toHaveLength(0);
      expect((await contractRow(id)).status).toBe("sent");
    });

    it("gives firma 3 seconds per call, so it can answer within firma's 5", async () => {
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);
      await deliver(event("signing_request.completed", firmaId));
      expect(firma.lookups[0].options).toEqual({ timeoutMs: 3000 });
    });

    it("lets a failed lookup through as an error (so firma retries) and leaves the contract alone", async () => {
      const { id, firmaId } = await sentContract();
      firma.failLookups = new FirmaError("firma is down", 503);

      await expect(
        deliver(event("signing_request.completed", firmaId)),
      ).rejects.toThrow("firma is down");

      expect((await contractRow(id)).status).toBe("sent");
    });

    it("follows 'viewed', declined, cancelled and expired", async () => {
      const cases = [
        [
          "viewed",
          { status: "sent", viewedAt: new Date("2026-10-22T10:00:00Z") },
          "signing_request.viewed",
        ],
        [
          "declined",
          { status: "declined", endedAt: new Date("2026-10-22T11:00:00Z") },
          "signing_request.recipient.declined",
        ],
        [
          "cancelled",
          { status: "cancelled", endedAt: new Date("2026-10-22T12:00:00Z") },
          "signing_request.cancelled",
        ],
        [
          "expired",
          { status: "expired", endedAt: new Date("2026-10-22T13:00:00Z") },
          "signing_request.expired",
        ],
      ] as const;
      for (const [expected, state, type] of cases) {
        await db.query("TRUNCATE contracts CASCADE");
        const { id, firmaId } = await sentContract();
        firma.set(firmaId, state);
        await deliver(event(type, firmaId));
        const row = await contractRow(id);
        expect(row.status).toBe(expected);
        expect(row.status_updated_at).toEqual(
          "viewedAt" in state ? state.viewedAt : state.endedAt,
        );
        expect(row.signed_at).toBeNull();
        expect((await driverRow()).contract_signed_at).toBeNull();
      }
    });
  });

  describe("the scheduled job", () => {
    it("catches a missed 'finished', 'declined' and 'expired' in one run", async () => {
      const driver2 = await newDriver(2);
      const driver3 = await newDriver(3);
      const a = await sentContract();
      const b = await sentContract(driver2);
      const c = await sentContract(driver3);
      firma.setSigned(a.firmaId);
      firma.set(b.firmaId, {
        status: "declined",
        endedAt: new Date("2026-10-22T11:00:00Z"),
      });
      firma.set(c.firmaId, {
        status: "expired",
        endedAt: new Date("2026-10-22T12:00:00Z"),
      });

      const summary = await job.run();

      expect(summary).toMatchObject({ checked: 3, changed: 3, failed: 0 });
      expect((await contractRow(a.id)).status).toBe("signed");
      expect((await contractRow(b.id)).status).toBe("declined");
      expect((await contractRow(c.id)).status).toBe("expired");
      expect((await driverRow(driverId)).contract_signed_at).not.toBeNull();
      expect((await driverRow(driver2)).contract_signed_at).toBeNull();
    });

    it("moves a contract from sent to viewed and on to signed", async () => {
      const { id, firmaId } = await sentContract();
      firma.set(firmaId, {
        status: "sent",
        viewedAt: new Date("2026-10-22T10:00:00Z"),
      });
      await job.run();
      expect((await contractRow(id)).status).toBe("viewed");

      firma.setSigned(firmaId);
      await job.run();
      expect((await contractRow(id)).status).toBe("signed");
    });

    it("does not ask firma about a contract that has reached an end state: a signed one never turns expired", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      await job.run(); // signs it and saves its files
      firma.lookups.length = 0;
      firma.set(firmaId, {
        status: "expired",
        endedAt: new Date("2026-10-30T00:00:00Z"),
      });

      await job.run();
      await expect(tracking.refreshFromFirma(id)).resolves.toBe(
        ContractStatus.signed,
      );
      await expect(
        deliver(event("signing_request.expired", firmaId)),
      ).resolves.toEqual({ result: "refreshed: signed" });

      expect(firma.lookups).toHaveLength(0);
      expect((await contractRow(id)).status).toBe("signed");
    });

    it("logs and counts a firma failure on one contract and still handles the others", async () => {
      const driver2 = await newDriver(2);
      const a = await sentContract();
      const b = await sentContract(driver2);
      firma.setSigned(b.firmaId);
      // `a` is unknown to firma (404); `b` is signed.
      firma.states.delete(a.firmaId);

      const summary = await job.run();

      expect(summary).toMatchObject({ checked: 2, changed: 1, failed: 1 });
      expect((await contractRow(a.id)).status).toBe("sent");
      expect((await contractRow(b.id)).status).toBe("signed");
    });

    it("does not run twice at once (advisory lock)", async () => {
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);
      firma.lookupDelayMs = 80;

      const [first, second] = await Promise.all([job.run(), job.run()]);

      expect([first, second].filter((r) => r === null)).toHaveLength(1);
    });

    it("never throws from the scheduled tick", async () => {
      await sentContract();
      firma.failLookups = new FirmaError("down", 500);
      await expect(job.tick()).resolves.toBeUndefined();
    });
  });

  describe("the signed files", () => {
    it("saves both files once: the job downloads on the first run and leaves them alone after", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);

      const first = await job.run();
      const second = await job.run();

      expect(first?.filesSaved).toBe(1);
      expect(second?.filesSaved).toBe(0);
      const row = await contractRow(id);
      expect(row.signed_pdf_key).toBe(`contracts/${id}/signed.pdf`);
      expect(row.certificate_key).toBe(`contracts/${id}/certificate.pdf`);
      expect(row.documents_error).toBeNull();
      expect(storage.files.get(`contracts/${id}/signed.pdf`)).toEqual({
        body: PDF,
        contentType: "application/pdf",
      });
      expect(
        storage.files.get(`contracts/${id}/certificate.pdf`)?.body,
      ).toEqual(CERT);
      expect(firma.downloads).toHaveLength(2);
      expect(storage.puts).toBe(2);
    });

    it("waits when firma has no links yet (not an error), then saves on a later run", async () => {
      const { id, firmaId } = await sentContract();
      firma.set(firmaId, {
        status: "finished",
        endedAt: new Date("2026-10-22T15:00:00Z"),
      }); // links still empty

      const early = await job.run();
      expect(early?.filesSaved).toBe(0);
      expect(early?.failed).toBe(0);
      let row = await contractRow(id);
      expect(row.status).toBe("signed");
      expect(row.signed_pdf_key).toBeNull();
      expect(row.documents_error).toBeNull();
      expect(firma.downloads).toHaveLength(0);

      firma.setSigned(firmaId);
      await job.run();
      row = await contractRow(id);
      expect(row.signed_pdf_key).not.toBeNull();
    });

    it("records a failed download on the contract, retries it, and clears the record on success", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      firma.files.set(
        `https://files.test/${firmaId}/final.pdf`,
        new FirmaError(
          "The download from firma broke off (socket hang up).",
          null,
        ),
      );

      const failed = await job.run();
      expect(failed?.failed).toBe(1);
      let row = await contractRow(id);
      expect(row.signed_pdf_key).toBeNull();
      expect(row.documents_error).toContain("broke off");
      expect(storage.puts).toBe(0); // neither file is half-saved

      firma.setSigned(firmaId);
      await job.run();
      row = await contractRow(id);
      expect(row.signed_pdf_key).not.toBeNull();
      expect(row.documents_error).toBeNull();
    });

    it("refuses a file that is not a PDF and says so on the contract", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      firma.files.set(`https://files.test/${firmaId}/cert.pdf`, {
        body: Buffer.from("<html>error page</html>"),
        contentType: "text/html",
      });

      await job.run();

      const row = await contractRow(id);
      expect(row.signed_pdf_key).toBeNull();
      expect(row.documents_error).toContain("not a PDF");
      expect(storage.puts).toBe(0);
    });

    it("does nothing, and does not crash, when there is no bucket", async () => {
      build({ storage: null });
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);

      const summary = await job.run();

      expect(summary).toMatchObject({ changed: 1, filesSaved: 0, failed: 0 });
      const row = await contractRow(id);
      expect(row.status).toBe("signed");
      expect(row.signed_pdf_key).toBeNull();
      expect(row.documents_error).toBeNull();
      expect(firma.downloads).toHaveLength(0);
      await expect(tracking.saveDocuments(id)).resolves.toBe("skipped");
    });

    it("skips a contract that is not signed", async () => {
      const { id } = await sentContract();
      await expect(tracking.saveDocuments(id)).resolves.toBe("skipped");
    });

    it("the database refuses one file without the other, and files without a signing time", async () => {
      const { id } = await sentContract();
      await expect(
        db.query(
          `UPDATE contracts SET signed_pdf_key = 'a', signed_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/contracts_documents_shape/);
      await expect(
        db.query(
          `UPDATE contracts SET signed_pdf_key = 'a', certificate_key = 'b' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/contracts_documents_shape/);
    });
  });

  describe("Contract signed on the driver", () => {
    it("keeps an admin's earlier tick: its date and admin stay", async () => {
      await driversService.setOnboardingStep(
        driverId,
        OnboardingStep.contract,
        true,
        admin,
      );
      const before = await driverRow();
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);

      await job.run();

      const after = await driverRow();
      expect(after.contract_signed_at).toEqual(before.contract_signed_at);
      expect(after.contract_signed_by_id).toBe(admin);
    });

    it("gives an inactive driver the date but leaves them inactive", async () => {
      await tickDepositAndVehicle();
      await driversService.deactivate(driverId, admin);
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);

      await job.run();

      const driver = await driverRow();
      expect(driver.contract_signed_at).not.toBeNull();
      expect(driver.contract_signed_by_id).toBeNull();
      expect(driver.status).toBe("inactive");
      // Reactivating works the status out from the steps: now all three are done.
      await driversService.reactivate(driverId, admin);
      expect((await driverRow()).status).toBe("active");
    });

    it("lets an admin un-tick the step later without touching the contract", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      await job.run();

      await driversService.setOnboardingStep(
        driverId,
        OnboardingStep.contract,
        false,
        admin,
      );

      expect((await driverRow()).contract_signed_at).toBeNull();
      expect((await contractRow(id)).status).toBe("signed");
      await job.run();
      expect((await driverRow()).contract_signed_at).toBeNull(); // an end state is never re-applied
    });

    it("ticks once when the webhook and the job act at the same moment", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      firma.lookupDelayMs = 60; // both read "finished" before either has written
      const tick = vi.spyOn(driversService, "recordContractSigned");

      await Promise.all([
        deliver(event("signing_request.completed", firmaId)),
        tracking.refreshFromFirma(id),
      ]);

      expect(tick).toHaveBeenCalledTimes(1);
      await expect(tick.mock.results[0].value).resolves.toBe(true);
      expect((await contractRow(id)).status).toBe("signed");
    });

    it("rolls the whole change back when the tick fails: the contract stays sent", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      vi.spyOn(driversService, "recordContractSigned").mockRejectedValueOnce(
        new Error("database hiccup"),
      );

      await expect(tracking.refreshFromFirma(id)).rejects.toThrow(
        "database hiccup",
      );

      expect((await contractRow(id)).status).toBe("sent");
      expect((await driverRow()).contract_signed_at).toBeNull();
      // The next call finds it unchanged and does the whole thing.
      await tracking.refreshFromFirma(id);
      expect((await contractRow(id)).status).toBe("signed");
      expect((await driverRow()).contract_signed_at).not.toBeNull();
    });
  });

  describe("GET /contracts/:id/documents", () => {
    it("gives null links before the files are saved, and short-lived links after", async () => {
      const { id, firmaId } = await sentContract();
      expect(await tracking.getDocuments(id)).toEqual({
        signedPdfUrl: null,
        certificateUrl: null,
      });

      firma.setSigned(firmaId);
      await job.run();

      expect(await tracking.getDocuments(id)).toEqual({
        signedPdfUrl: `https://bucket.test/contracts/${id}/signed.pdf?signed`,
        certificateUrl: `https://bucket.test/contracts/${id}/certificate.pdf?signed`,
      });
    });

    it("answers 404 for an unknown contract", async () => {
      await expect(
        tracking.getDocuments("00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("is open to admins only: neither public nor opened to another role", () => {
      const handler = Object.getOwnPropertyDescriptor(
        ContractsController.prototype,
        "getDocuments",
      )?.value as object;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, ContractsController),
      ).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(
        Reflect.getMetadata(ROLES_KEY, ContractsController),
      ).toBeUndefined();
    });

    it("does not put keys, links or files in the contract itself, only whether they are saved", async () => {
      const { id, firmaId } = await sentContract();
      firma.setSigned(firmaId);
      await job.run();

      const dto = await contractsService.getCurrent(driverId);

      expect(dto).toMatchObject({
        id,
        status: "signed",
        documentsSaved: true,
        documentsError: null,
        signedAt: new Date("2026-10-22T15:00:00Z"),
      });
      expect(JSON.stringify(dto)).not.toContain("contracts/");
      expect(dto).not.toHaveProperty("signedPdfKey");
    });

    it("shows a failed save on the contract", async () => {
      const { firmaId } = await sentContract();
      firma.setSigned(firmaId);
      firma.files.set(
        `https://files.test/${firmaId}/final.pdf`,
        new FirmaError("firma's file link answered 500.", 500),
      );
      await job.run();

      const dto = await contractsService.getCurrent(driverId);

      expect(dto).toMatchObject({
        documentsSaved: false,
        documentsError: "firma's file link answered 500.",
      });
    });
  });

  describe("the driver stays a driver", () => {
    it("drivers keep their status when a different driver's contract is signed", async () => {
      const driver2 = await newDriver(2);
      const mine = await sentContract(driverId);
      await sentContract(driver2);
      firma.setSigned(mine.firmaId);

      await job.run();

      expect((await driverRow(driver2)).contract_signed_at).toBeNull();
      expect((await driverRow(driver2)).status).toBe(DriverStatus.onboarding);
    });
  });
});
