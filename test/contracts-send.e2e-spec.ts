import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { DataSource } from "typeorm";
import { ContractCompany } from "../src/contracts/contract-company.entity.js";
import {
  buildAnchors,
  templateFor,
} from "../src/contracts/contract-template.js";
import { buildContractValues } from "../src/contracts/contract-values.js";
import { ContractsService } from "../src/contracts/contracts.service.js";
import type { ContractInputDto } from "../src/contracts/dto/contract.dto.js";
import {
  Contract,
  ContractSchedule,
} from "../src/contracts/contract.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import {
  FirmaError,
  type FirmaClient,
  type FirmaDownload,
  type FirmaRequestState,
  type FirmaSendRequest,
  type FirmaSent,
} from "../src/firma/firma-client.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

/** A firma in memory: records every request, answers with a numbered id, and can be told to fail. */
class FakeFirma implements FirmaClient {
  requests: FirmaSendRequest[] = [];
  failWith: Error | null = null;
  /** Long enough for two clicks at once to overlap. */
  delayMs = 60;

  async createAndSend(request: FirmaSendRequest): Promise<FirmaSent> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.requests.push(request);
    if (this.failWith) throw this.failWith;
    return { signingRequestId: `firma-${this.requests.length}` };
  }

  // Tracking is step 4's business (contracts-track.e2e-spec); sending never asks.
  getSigningRequest(): Promise<FirmaRequestState> {
    return Promise.reject(new Error("not used while sending"));
  }

  download(): Promise<FirmaDownload> {
    return Promise.reject(new Error("not used while sending"));
  }
}

/** Our bucket in memory. */
class FakeStorage implements FileStorage {
  files = new Map<string, Buffer>();
  put(key: string, body: Buffer) {
    this.files.set(key, body);
    return Promise.resolve();
  }
  get(key: string) {
    const body = this.files.get(key);
    return body
      ? Promise.resolve(body)
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

/** A made-up licence picture: flat grey, nothing personal. */
const licencePicture = () =>
  sharp({
    create: { width: 900, height: 600, channels: 3, background: "#888888" },
  })
    .jpeg()
    .toBuffer();

describe("Send a contract for signing (Module 2 step 3, D74, test database)", () => {
  let db: DataSource;
  let firma: FakeFirma;
  let storage: FakeStorage;
  let contracts: ContractsService;
  let admin: string;
  let driverId: string;
  let ashwoodId: string;
  let ukiahId: string;

  const serviceWith = (
    client: FakeFirma | null,
    bucket: FakeStorage | null = storage,
  ): ContractsService =>
    new ContractsService(
      db.getRepository(Contract),
      db.getRepository(Driver),
      db.getRepository(ContractCompany),
      db,
      client,
      bucket,
    );

  /** A complete draft: the Ashwood sample's numbers, made-up personal data. */
  const completeBody = (
    over: Partial<ContractInputDto> = {},
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
    ...over,
  });

  /** The licence file on a driver's application, as the application flow leaves it (D54, D68). Returns the document's id. */
  const addLicence = async (
    forDriver: string,
    body: Buffer,
    over: { status?: string } = {},
  ): Promise<string> => {
    const [{ id: applicationId }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, driver_id)
       VALUES (gen_random_uuid(), 'Test', 'Driver', $1, '3125550101', '{}', 'approved', $2) RETURNING id`,
      [`application-${forDriver}@test.test`, forDriver],
    )) as [{ id: string }];
    const key = `application-documents/${applicationId}/license.bin`;
    storage.files.set(key, body);
    const pending = over.status === "pending";
    // A website copy that is not in our bucket yet has its website path and no stored file; an admin upload is always stored.
    const [{ id }] = (await db.query(
      `INSERT INTO application_documents (application_id, kind, origin, source_path, status, storage_key, size_bytes)
       VALUES ($1, 'license', $2, $3, $4, $5, $6) RETURNING id`,
      [
        applicationId,
        pending ? "website" : "admin",
        pending ? "site/licence.png" : null,
        pending ? "pending" : "stored",
        pending ? null : key,
        pending ? null : body.length,
      ],
    )) as [{ id: string }];
    return id;
  };

  const newDriver = async (n: number, withLicence = true): Promise<string> => {
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Test', 'Driver', $1, $2) RETURNING id`,
      [`driver${n}@test.test`, `+1312555010${n}`],
    )) as [{ id: string }];
    if (withLicence) await addLicence(id, await licencePicture());
    return id;
  };

  const newDraft = async (
    over: Partial<ContractInputDto> = {},
    forDriver = driverId,
  ): Promise<string> =>
    (await contracts.createDraft(forDriver, completeBody(over), admin)).id;

  const row = async (id: string) =>
    (
      (await db.query(
        `SELECT status, sent_at, sent_by_id, firma_signing_request_id, sent_values FROM contracts WHERE id = $1`,
        [id],
      )) as Record<string, any>[]
    )[0];

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE contracts, drivers, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    storage = new FakeStorage();
    driverId = await newDriver(1);
    [{ id: ashwoodId }] = (await db.query(
      `SELECT id FROM contract_companies WHERE name = 'Ashwood Holdings LLC'`,
    )) as [{ id: string }];
    [{ id: ukiahId }] = (await db.query(
      `SELECT id FROM contract_companies WHERE state = 'CA'`,
    )) as [{ id: string }];
    firma = new FakeFirma();
    contracts = serviceWith(firma);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("knows the state of every company: the four Illinois ones and Gonzo's Ukiah address", async () => {
    const rows = (await db.query(
      `SELECT name, state FROM contract_companies ORDER BY name, state`,
    )) as { name: string; state: string }[];
    expect(rows).toEqual([
      { name: "Ashwood Holdings LLC", state: "IL" },
      { name: "Evergreen Holdings LLC", state: "IL" },
      { name: "Gonzo Enterprises Inc", state: "CA" },
      { name: "Gonzo Enterprises Inc", state: "IL" },
      { name: "Silver Pine Holdings LLC", state: "IL" },
    ]);
  });

  describe("sending", () => {
    it("sends to the driver, freezes the values and marks the contract sent", async () => {
      const id = await newDraft();

      const sent = await contracts.sendForSigning(id, admin);

      expect(sent).toMatchObject({ id, status: "sent" });
      expect(sent.sentAt).toBeInstanceOf(Date);
      expect(sent.sentValues).toMatchObject({
        template: "illinois-lease.pdf",
        recipientName: "Test Driver",
        recipientEmail: "driver1@test.test",
        values: {
          COMPANY_NAME: "Ashwood Holdings LLC",
          LESSOR_SIGNATURE: "Ashwood Holdings LLC",
          TOTAL_RATE: "$409.00",
          BASE_RATE: "$171.78",
          AMOUNT_DUE_AT_PICKUP: "$609.00",
          START_DATE: "October 13, 2026",
          END_DATE: "April 13, 2028",
          LESSEE_PHONE: "(312) 555-0101",
          DATE_OF_BIRTH: "04/04/1983",
          PURCHASE_OPTION: "$9,750",
        },
      });

      expect(await row(id)).toMatchObject({
        status: "sent",
        sent_by_id: admin,
        firma_signing_request_id: "firma-1",
      });
    });

    it("gives firma the template PDF, the driver as the only signer and an anchor for every value", async () => {
      await contracts.sendForSigning(await newDraft(), admin);

      expect(firma.requests).toHaveLength(1);
      const [request] = firma.requests;
      expect(request.pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(request.recipient).toEqual({
        firstName: "Test",
        lastName: "Driver",
        email: "driver1@test.test",
      });
      expect(request.name).toBe(
        "Vehicle Lease Agreement - Ashwood Holdings LLC",
      );
      const anchors = request.anchors.map((a) => a.anchor);
      expect(anchors).toContain("{{LESSEE_SIGNATURE}}");
      expect(anchors).toContain("{{LESSEE_DATE}}");
      expect(
        request.anchors.find((a) => a.anchor === "{{LESSOR_SIGNATURE}}"),
      ).toMatchObject({ kind: "text", value: "Ashwood Holdings LLC" });
    });

    it("keeps the frozen values when the driver's details change afterwards", async () => {
      const id = await newDraft();
      await contracts.sendForSigning(id, admin);
      await db.query(
        `UPDATE drivers SET email = 'new@test.test' WHERE id = $1`,
        [driverId],
      );

      const current = await contracts.getCurrent(driverId);

      expect(current?.sentValues?.recipientEmail).toBe("driver1@test.test");
      expect(current?.sentValues?.values.LESSEE_EMAIL).toBe(
        "driver1@test.test",
      );
    });

    it("refuses a second send with 409 and never calls firma again", async () => {
      const id = await newDraft();
      await contracts.sendForSigning(id, admin);

      await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
        ConflictException,
      );
      expect(firma.requests).toHaveLength(1);
    });

    it("makes one envelope when two admins click at the same instant", async () => {
      const id = await newDraft();

      const results = await Promise.allSettled([
        contracts.sendForSigning(id, admin),
        contracts.sendForSigning(id, admin),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected");
      expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
      expect(firma.requests).toHaveLength(1);
    });

    it("answers 404 for an unknown contract", async () => {
      await expect(
        contracts.sendForSigning("00000000-0000-4000-8000-000000000000", admin),
      ).rejects.toThrow(NotFoundException);
      expect(firma.requests).toHaveLength(0);
    });

    it("answers 503 when no firma key is set, and changes nothing", async () => {
      const id = await newDraft();

      await expect(serviceWith(null).sendForSigning(id, admin)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(serviceWith(null).sendForSigning(id, admin)).rejects.toThrow(
        "Signing is not set up (FIRMA_API_KEY).",
      );
      expect((await row(id)).status).toBe("draft");
    });

    it("sends a Californian contract with the California template and its own anchors", async () => {
      const id = await newDraft({ companyId: ukiahId });

      const sent = await contracts.sendForSigning(id, admin);

      expect(sent.sentValues?.template).toBe("california-lease.pdf");
      expect(sent.sentValues?.values.COMPANY_NAME).toBe(
        "Gonzo Enterprises Inc",
      );
      const [request] = firma.requests;
      const contract = await db.getRepository(Contract).findOneByOrFail({ id });
      const values = buildContractValues(
        contract,
        {
          name: "Gonzo Enterprises Inc",
          address: sent.sentValues!.values.COMPANY_ADDRESS,
        },
        {
          firstName: "Test",
          lastName: "Driver",
          email: "driver1@test.test",
          phone: "+13125550101",
        },
      );
      expect(request.anchors).toEqual(buildAnchors(values, templateFor("CA")!));
      expect(request.anchors.map((a) => a.anchor)).toContain(
        "{{COMPANY_SIGN}}",
      );
    });

    it("refuses a company whose state has no contract yet with 409", async () => {
      const [{ id: tennesseeId }] = (await db.query(
        `INSERT INTO contract_companies (name, address, state)
         VALUES ('Volunteer LLC', '1 Test St, Nashville TN 37201', 'TN') RETURNING id`,
      )) as [{ id: string }];
      try {
        const id = await newDraft({ companyId: tennesseeId });

        await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
          "There is no contract for TN yet.",
        );
        expect(firma.requests).toHaveLength(0);
        expect((await row(id)).status).toBe("draft");
      } finally {
        // The company list is fixed by a migration: leave it as found (the next test reads it).
        await db.query("TRUNCATE contracts CASCADE");
        await db.query("DELETE FROM contract_companies WHERE id = $1", [
          tennesseeId,
        ]);
      }
    });

    describe("the driver's licence on the last page (D76)", () => {
      const imagesOnLastPage = async (pdf: Buffer): Promise<number> => {
        const doc = await PDFDocument.load(pdf);
        const page = doc.getPage(doc.getPageCount() - 1);
        const xobjects = page.node
          .Resources()
          ?.lookup(doc.context.obj("XObject"));
        return xobjects && "entries" in xobjects
          ? (xobjects as unknown as { entries(): unknown[] }).entries().length
          : 0;
      };

      it("draws the application's licence file into the PDF firma gets, and records which file it was", async () => {
        const id = await newDraft();
        const [{ id: documentId }] = (await db.query(
          `SELECT id FROM application_documents WHERE kind = 'license'`,
        )) as [{ id: string }];

        const sent = await contracts.sendForSigning(id, admin);

        expect(sent.sentValues?.licenseDocumentId).toBe(documentId);
        const [request] = firma.requests;
        expect(await imagesOnLastPage(request.pdf)).toBeGreaterThan(0);
      });

      it("blocks the send when the driver has no licence file, and changes nothing", async () => {
        const other = await newDriver(2, false);
        const id = await newDraft({}, other);

        await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
          "The driver's licence is not on file: add it to the application first.",
        );
        expect(firma.requests).toHaveLength(0);
        expect((await row(id)).status).toBe("draft");
      });

      it("blocks the send while the licence file is still pending (not in our bucket yet)", async () => {
        const other = await newDriver(2, false);
        await addLicence(other, await licencePicture(), { status: "pending" });
        const id = await newDraft({}, other);

        await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
          ConflictException,
        );
        expect(firma.requests).toHaveLength(0);
      });

      it("blocks the send when the file is not a picture or a PDF, without putting it in the message", async () => {
        const other = await newDriver(2, false);
        await addLicence(other, Buffer.from("secret words, not an image"));
        const id = await newDraft({}, other);

        const failure = await contracts.sendForSigning(id, admin).then(
          () => null,
          (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(ConflictException);
        expect((failure as Error).message).toMatch(/cannot be read/);
        expect((failure as Error).message).not.toMatch(/secret/);
        expect(firma.requests).toHaveLength(0);
        expect((await row(id)).status).toBe("draft");
      });

      it("answers 502 when the bucket cannot give the file", async () => {
        const id = await newDraft();
        storage.files.clear();

        await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
          BadGatewayException,
        );
        expect(firma.requests).toHaveLength(0);
      });

      it("answers 503 when no file storage is set up", async () => {
        const id = await newDraft();

        await expect(
          serviceWith(firma, null).sendForSigning(id, admin),
        ).rejects.toThrow(ServiceUnavailableException);
        expect((await row(id)).status).toBe("draft");
      });
    });

    it("sends for each of the four Illinois companies", async () => {
      const names = [
        "Evergreen Holdings LLC",
        "Silver Pine Holdings LLC",
        "Gonzo Enterprises Inc",
      ];
      let n = 1;
      for (const name of names) {
        const [{ id: companyId }] = (await db.query(
          `SELECT id FROM contract_companies WHERE name = $1 AND state = 'IL'`,
          [name],
        )) as [{ id: string }];
        n += 1;
        const other = await newDriver(n);
        const id = await newDraft({ companyId }, other);
        const sent = await contracts.sendForSigning(id, admin);
        expect(sent.sentValues?.values.COMPANY_NAME).toBe(name);
      }
      expect(firma.requests).toHaveLength(3);
    });
  });

  describe("values still empty", () => {
    const fields: [string, Partial<ContractInputDto>][] = [
      ["Company", { companyId: null }],
      ["Vehicle model", { vehicleModel: null }],
      ["Vehicle VIN", { vehicleVin: null }],
      ["Vehicle plate", { vehiclePlate: null }],
      ["Vehicle plate state", { vehiclePlateState: null }],
      ["Purchase option price", { purchaseOptionCents: null }],
      ["Driver address", { lesseeAddress: null }],
      ["License number", { licenseNumber: null }],
      ["License state", { licenseState: null }],
      ["Date of birth", { dateOfBirth: null }],
    ];

    it.each(fields)(
      "answers 400 naming %s when it is empty",
      async (label, over) => {
        const id = await newDraft(over);

        const error = await contracts
          .sendForSigning(id, admin)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          missing: [label],
        });
        expect(firma.requests).toHaveLength(0);
        expect((await row(id)).status).toBe("draft");
      },
    );

    it("lists everything that is missing at once", async () => {
      const id = await newDraft({
        companyId: null,
        vehicleVin: null,
        dateOfBirth: null,
      });

      const error = (await contracts
        .sendForSigning(id, admin)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(error.getResponse()).toMatchObject({
        missing: ["Company", "Vehicle VIN", "Date of birth"],
        message: "Fill in before sending: Company, Vehicle VIN, Date of birth.",
      });
    });

    it("counts a purchase option of $0 as filled", async () => {
      const sent = await contracts.sendForSigning(
        await newDraft({ purchaseOptionCents: 0 }),
        admin,
      );
      expect(sent.sentValues?.values.PURCHASE_OPTION).toBe("$0");
    });
  });

  describe("when firma fails", () => {
    it("answers 502 with firma's own message and leaves the contract a draft", async () => {
      const id = await newDraft();
      firma.failWith = new FirmaError(
        "firma refused the request (400): anchor not found",
        400,
      );

      const error = await contracts
        .sendForSigning(id, admin)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).message).toBe(
        "firma refused the request (400): anchor not found",
      );
      expect(await row(id)).toMatchObject({
        status: "draft",
        sent_at: null,
        sent_by_id: null,
        firma_signing_request_id: null,
        sent_values: null,
      });
    });

    it("can be sent again once firma works", async () => {
      const id = await newDraft();
      firma.failWith = new FirmaError(
        "firma refused the request (500): down",
        500,
      );
      await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
        BadGatewayException,
      );

      firma.failWith = null;
      const sent = await contracts.sendForSigning(id, admin);

      expect(sent.status).toBe("sent");
    });

    it("does not hide an unexpected error as a firma failure", async () => {
      const id = await newDraft();
      firma.failWith = new TypeError("something else broke");

      await expect(contracts.sendForSigning(id, admin)).rejects.toThrow(
        TypeError,
      );
      expect((await row(id)).status).toBe("draft");
    });
  });

  describe("a sent contract is frozen", () => {
    it("cannot be edited or deleted", async () => {
      const id = await newDraft();
      await contracts.sendForSigning(id, admin);

      await expect(
        contracts.updateDraft(id, completeBody({ totalRateCents: 1 }), admin),
      ).rejects.toThrow(NotFoundException);
      await expect(contracts.deleteDraft(id)).rejects.toThrow(
        NotFoundException,
      );
      expect((await row(id)).status).toBe("sent");
    });

    it("is what the driver's current contract shows once there is no draft", async () => {
      const id = await newDraft();
      await contracts.sendForSigning(id, admin);

      const current = await contracts.getCurrent(driverId);

      expect(current).toMatchObject({ id, status: "sent" });
      expect(current?.numbers.amountDueAtPickupCents).toBe(60_900);
    });

    it("gives way to a new draft: the draft is the current contract while it exists", async () => {
      const sentId = await newDraft();
      await contracts.sendForSigning(sentId, admin);

      const draft = await contracts.createDraft(
        driverId,
        completeBody(),
        admin,
      );

      expect((await contracts.getCurrent(driverId))?.id).toBe(draft.id);
    });

    it("shows a draft with no sent data", async () => {
      const id = await newDraft();
      const current = await contracts.getCurrent(driverId);
      expect(current).toMatchObject({ id, sentAt: null, sentValues: null });
    });
  });

  describe("the database keeps the sent data together", () => {
    it("refuses a sent contract without its send data", async () => {
      const id = await newDraft();
      await expect(
        db.query(`UPDATE contracts SET status = 'sent' WHERE id = $1`, [id]),
      ).rejects.toThrow(/contracts_sent_shape/);
    });

    it("refuses send data on a draft, and a firma id without the rest", async () => {
      const id = await newDraft();
      await expect(
        db.query(
          `UPDATE contracts SET firma_signing_request_id = 'x' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/contracts_sent_shape/);
      await expect(
        db.query(
          `UPDATE contracts SET sent_at = now(), firma_signing_request_id = 'x' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/contracts_sent_shape/);
    });

    it("lets one firma request belong to one contract only", async () => {
      const first = await newDraft();
      const other = await newDriver(2);
      const second = await newDraft({}, other);
      const send = (id: string) =>
        db.query(
          `UPDATE contracts SET status = 'sent', sent_at = now(),
             firma_signing_request_id = 'same', sent_values = '{}' WHERE id = $1`,
          [id],
        );
      await send(first);
      await expect(send(second)).rejects.toThrow(
        /contracts_firma_signing_request_id/,
      );
    });
  });
});
