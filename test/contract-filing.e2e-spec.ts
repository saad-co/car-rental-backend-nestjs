import type { DataSource } from "typeorm";
import { ApplicationDocumentKind } from "../src/applications/documents/application-document.entity.js";
import { ApplicationDocumentsService } from "../src/applications/documents/application-documents.service.js";
import { ContractFilingJob } from "../src/contracts/contract-filing.job.js";
import { ContractFilingService } from "../src/contracts/contract-filing.service.js";
import { AddFirmaContractCopy1794086100000 } from "../src/database/migrations/1794086100000-AddFirmaContractCopy.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

/** A bucket in memory. `failGet`: keys whose download throws. */
class FakeStorage implements FileStorage {
  files = new Map<string, { body: Buffer; contentType: string | null }>();
  failGet = new Set<string>();
  puts = 0;
  put(key: string, body: Buffer, contentType: string | null) {
    this.puts++;
    this.files.set(key, { body, contentType });
    return Promise.resolve();
  }
  get(key: string) {
    if (this.failGet.has(key)) return Promise.reject(new Error("bucket down"));
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

const PDF = (text: string) => Buffer.from(`%PDF-1.7 ${text}`);
const upload = (buffer: Buffer): Express.Multer.File =>
  ({
    buffer,
    size: buffer.length,
    originalname: "paper.pdf",
  }) as Express.Multer.File;

describe("firma contracts are filed in the driver's contract slot (D90 step 2, test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;
  let filing: ContractFilingService;
  let documents: ApplicationDocumentsService;
  let adminId: string;
  let counter = 0;

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE application_documents, applications, contracts, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@filing.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    storage = new FakeStorage();
    filing = new ContractFilingService(db, storage);
    documents = new ApplicationDocumentsService(db, { source: null, storage });
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function driver(): Promise<string> {
    counter++;
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Dee', 'Driver', $1, $2) RETURNING id`,
      [`dee${counter}@test.dev`, `+1312555${String(1000 + counter)}`],
    )) as [{ id: string }];
    return id;
  }

  /** A contract that firma signed and whose files are saved (as `ContractTrackingService.saveDocuments` leaves it). */
  async function signedContract(
    driverId: string,
    signedAt: string,
    text = signedAt,
  ): Promise<{ id: string; signedKey: string }> {
    counter++;
    const signedKey = `contracts/test-${counter}/signed.pdf`;
    storage.files.set(signedKey, {
      body: PDF(text),
      contentType: "application/pdf",
    });
    const [{ id }] = (await db.query(
      `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, status, sent_at,
                              firma_signing_request_id, sent_values, signed_at, signed_pdf_key, certificate_key)
       VALUES ($1, 'weekly', 40900, '2026-10-13', 'signed', $3::timestamptz, $2, '{}'::jsonb, $3::timestamptz, $4, $5) RETURNING id`,
      [driverId, `firma-${counter}`, signedAt, signedKey, `${signedKey}.cert`],
    )) as [{ id: string }];
    return { id, signedKey };
  }

  const slot = (driverId: string) =>
    db.query(
      `SELECT origin, contract_id, storage_key, uploaded_by_id FROM application_documents
       WHERE driver_id = $1 AND kind = 'contract'`,
      [driverId],
    ) as Promise<
      {
        origin: string;
        contract_id: string | null;
        storage_key: string;
        uploaded_by_id: string | null;
      }[]
    >;

  it("files the signed PDF as its own copy and leaves the contract's file where it is", async () => {
    const driverId = await driver();
    const contract = await signedContract(
      driverId,
      "2026-10-22T15:00:00Z",
      "signed text",
    );

    expect(await filing.fileContract(contract.id)).toBe("filed");

    const rows = await slot(driverId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: "firma",
      contract_id: contract.id,
      uploaded_by_id: null,
    });
    expect(rows[0].storage_key).toMatch(
      /^drivers\/[0-9a-f-]+\/contract-[0-9a-f-]+\.pdf$/,
    );
    expect(rows[0].storage_key).not.toBe(contract.signedKey);
    expect(storage.files.get(rows[0].storage_key)?.body.toString()).toBe(
      "%PDF-1.7 signed text",
    );
    expect(storage.files.has(contract.signedKey)).toBe(true);
    const listed = (await documents.listForDriver(driverId)).items;
    expect(listed).toMatchObject([{ kind: "contract", origin: "firma" }]);
  });

  it("filing the same contract again changes nothing", async () => {
    const driverId = await driver();
    const contract = await signedContract(driverId, "2026-10-22T15:00:00Z");
    await filing.fileContract(contract.id);
    const puts = storage.puts;

    expect(await filing.fileContract(contract.id)).toBe("already");

    expect(storage.puts).toBe(puts);
    expect(await slot(driverId)).toHaveLength(1);
  });

  it("a newer signing replaces an older firma copy and removes its object, never the contract's own file", async () => {
    const driverId = await driver();
    const older = await signedContract(driverId, "2026-10-01T10:00:00Z");
    const newer = await signedContract(driverId, "2026-11-01T10:00:00Z");
    await filing.fileContract(older.id);
    const oldCopy = (await slot(driverId))[0].storage_key;

    expect(await filing.fileContract(newer.id)).toBe("filed");

    const rows = await slot(driverId);
    expect(rows).toHaveLength(1);
    expect(rows[0].contract_id).toBe(newer.id);
    expect(storage.files.has(oldCopy)).toBe(false);
    expect(storage.files.has(older.signedKey)).toBe(true);
  });

  it("an older signing never replaces a newer copy", async () => {
    const driverId = await driver();
    const older = await signedContract(driverId, "2026-10-01T10:00:00Z");
    const newer = await signedContract(driverId, "2026-11-01T10:00:00Z");
    await filing.fileContract(newer.id);
    const puts = storage.puts;

    expect(await filing.fileContract(older.id)).toBe("kept-newer");

    expect((await slot(driverId))[0].contract_id).toBe(newer.id);
    expect(storage.puts).toBe(puts);
  });

  it("never overwrites a file an admin uploaded, and does not even download the PDF", async () => {
    const driverId = await driver();
    await documents.uploadForDriver(
      driverId,
      ApplicationDocumentKind.contract,
      upload(PDF("the client's paper copy")),
      adminId,
    );
    const contract = await signedContract(driverId, "2026-11-02T10:00:00Z");
    storage.failGet.add(contract.signedKey); // proves nothing is read

    expect(await filing.fileContract(contract.id)).toBe("kept-upload");

    const rows = await slot(driverId);
    expect(rows).toMatchObject([{ origin: "admin", contract_id: null }]);
    expect(storage.files.get(rows[0].storage_key)?.body.toString()).toContain(
      "paper copy",
    );
  });

  it("an admin upload over a firma copy takes the slot, clears the link, and the sweep leaves it alone", async () => {
    const driverId = await driver();
    const contract = await signedContract(driverId, "2026-11-02T10:00:00Z");
    await filing.fileContract(contract.id);
    const copy = (await slot(driverId))[0].storage_key;

    await documents.uploadForDriver(
      driverId,
      ApplicationDocumentKind.contract,
      upload(PDF("paper")),
      adminId,
    );

    const rows = await slot(driverId);
    expect(rows).toMatchObject([
      { origin: "admin", contract_id: null, uploaded_by_id: adminId },
    ]);
    expect(storage.files.has(copy)).toBe(false);
    expect(storage.files.has(contract.signedKey)).toBe(true);
    expect(await filing.fileSignedContracts()).toEqual({ filed: 0, failed: 0 });
    expect((await slot(driverId))[0].origin).toBe("admin");
  });

  it("the sweep files every waiting contract; one failing download is counted, logged and retried next run", async () => {
    const [a, b, c] = [await driver(), await driver(), await driver()];
    const ca = await signedContract(a, "2026-10-01T10:00:00Z");
    const cb = await signedContract(b, "2026-10-02T10:00:00Z");
    const cc = await signedContract(c, "2026-10-03T10:00:00Z");
    storage.failGet.add(cb.signedKey);

    expect(await filing.fileSignedContracts()).toEqual({ filed: 2, failed: 1 });
    expect(await slot(a)).toHaveLength(1);
    expect(await slot(b)).toHaveLength(0);
    expect(await slot(c)).toHaveLength(1);
    // The failed one leaves no half-written object or row.
    expect(
      [...storage.files.keys()].filter((k) => k.startsWith(`drivers/${b}/`)),
    ).toEqual([]);

    storage.failGet.clear();
    expect(await filing.fileSignedContracts()).toEqual({ filed: 1, failed: 0 });
    expect(await slot(b)).toHaveLength(1);
    expect(await filing.fileSignedContracts()).toEqual({ filed: 0, failed: 0 });
    void ca;
    void cc;
  });

  it("the scheduled job runs the sweep behind an advisory lock", async () => {
    const driverId = await driver();
    await signedContract(driverId, "2026-10-22T15:00:00Z");

    const job = new ContractFilingJob(db, filing);
    expect(await job.run()).toEqual({ filed: 1, failed: 0 });
    expect(await slot(driverId)).toHaveLength(1);
  });

  it("files nothing without a bucket, or for a contract that is not signed", async () => {
    const driverId = await driver();
    const contract = await signedContract(driverId, "2026-10-22T15:00:00Z");
    expect(
      await new ContractFilingService(db, null).fileContract(contract.id),
    ).toBe("skipped");
    expect(
      await new ContractFilingService(db, null).fileSignedContracts(),
    ).toEqual({
      filed: 0,
      failed: 0,
    });

    await db.query(
      `UPDATE contracts SET status = 'viewed', signed_at = NULL, signed_pdf_key = NULL, certificate_key = NULL WHERE id = $1`,
      [contract.id],
    );
    expect(await filing.fileContract(contract.id)).toBe("skipped");
    expect(await slot(driverId)).toHaveLength(0);
  });

  it("the database allows a contract link only on a driver's row", async () => {
    const driverId = await driver();
    const contract = await signedContract(driverId, "2026-10-22T15:00:00Z");
    const [{ id: applicationId }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
       VALUES (gen_random_uuid(), 'A', 'B', 'ab@test.dev', '3125550103', '{}') RETURNING id`,
    )) as [{ id: string }];

    await expect(
      db.query(
        `INSERT INTO application_documents (application_id, kind, origin, status, storage_key, size_bytes, contract_id)
         VALUES ($1, 'license', 'firma', 'stored', 'k', 1, $2)`,
        [applicationId, contract.id],
      ),
    ).rejects.toThrow(/application_documents_contract_link/);
  });

  it("the migration refuses to be reverted while a firma copy is filed", async () => {
    const driverId = await driver();
    const contract = await signedContract(driverId, "2026-10-22T15:00:00Z");
    await filing.fileContract(contract.id);
    const runner = db.createQueryRunner();
    try {
      await expect(
        new AddFirmaContractCopy1794086100000().down(runner),
      ).rejects.toThrow(/1 contract copy file/);
    } finally {
      await runner.release();
    }
    expect(await slot(driverId)).toHaveLength(1);
  });
});
