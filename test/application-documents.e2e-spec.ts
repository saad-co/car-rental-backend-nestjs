import { NotFoundException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { Application } from "../src/applications/application.entity.js";
import {
  ApplicationDocumentCopier,
  MAX_DOCUMENT_ATTEMPTS,
  type DocumentCopierDeps,
} from "../src/applications/documents/application-document-copier.js";
import { ApplicationDocument } from "../src/applications/documents/application-document.entity.js";
import { ApplicationDocumentsController } from "../src/applications/documents/application-documents.controller.js";
import {
  DocumentSourceError,
  type DocumentSource,
  type FetchedDocument,
} from "../src/applications/documents/document-source.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

/** The website's storage in memory: serves known paths, fails the others as told. */
class FakeSource implements DocumentSource {
  files = new Map<string, FetchedDocument>();
  failures = new Map<string, DocumentSourceError>();
  fetched: string[] = [];

  fetch(path: string): Promise<FetchedDocument> {
    this.fetched.push(path);
    const failure = this.failures.get(path);
    if (failure) return Promise.reject(failure);
    const file = this.files.get(path);
    return file
      ? Promise.resolve(file)
      : Promise.reject(
          new DocumentSourceError(
            "The website's storage no longer has this file.",
            true,
          ),
        );
  }
}

/** Our bucket in memory. */
class FakeStorage implements FileStorage {
  files = new Map<string, { body: Buffer; contentType: string | null }>();
  put(key: string, body: Buffer, contentType: string | null) {
    this.files.set(key, { body, contentType });
    return Promise.resolve();
  }
  presignGet(key: string) {
    return Promise.resolve(`https://bucket.test/${key}?signed`);
  }
}

describe("application documents are copied into our storage (test database)", () => {
  let db: DataSource;
  let source: FakeSource;
  let storage: FakeStorage;
  let applicationId: string;

  const deps = (
    overrides: Partial<DocumentCopierDeps> = {},
  ): DocumentCopierDeps => ({
    source,
    storage,
    ...overrides,
  });
  const copier = (overrides: Partial<DocumentCopierDeps> = {}) =>
    new ApplicationDocumentCopier(db, deps(overrides));
  const rows = () =>
    db.getRepository(ApplicationDocument).find({ order: { kind: "ASC" } });

  async function addApplication(
    requestId: string,
    paths: { license?: string; rating?: string; earnings?: string },
  ) {
    const [{ id }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload,
                                 license_storage_path, rating_storage_path, earnings_storage_path)
       VALUES ($1, 'Pat', 'Applicant', $2, '3057210909', '{}', $3, $4, $5) RETURNING id`,
      [
        requestId,
        `${requestId}@test.dev`,
        paths.license ?? null,
        paths.rating ?? null,
        paths.earnings ?? null,
      ],
    )) as [{ id: string }];
    return id;
  }

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE application_documents, applications CASCADE");
    source = new FakeSource();
    storage = new FakeStorage();
    source.files.set("2026-10-07/licence.png", {
      body: Buffer.from("LICENCE"),
      contentType: "image/png",
    });
    source.files.set("2026-10-07/rating-x.jpg", {
      body: Buffer.from("RATING"),
      contentType: null,
    });
    applicationId = await addApplication("r1", {
      license: "2026-10-07/licence.png",
      rating: "2026-10-07/rating-x.jpg",
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("records a row for each path and copies the files into our bucket", async () => {
    const result = await copier().run();

    expect(result).toEqual({ stored: 2, retryLater: 0, failed: 0 });
    const stored = await rows();
    expect(stored.map((d) => [d.kind, d.status])).toEqual([
      ["license", "stored"],
      ["rating", "stored"],
    ]);
    for (const document of stored) {
      expect(document.storageKey).toMatch(
        new RegExp(`^applications/${applicationId}/${document.kind}-`),
      );
      expect(storage.files.get(document.storageKey!)).toBeDefined();
    }
    // The type comes from the source, or from the file extension when the source does not say.
    expect(stored.find((d) => d.kind === "license")).toMatchObject({
      contentType: "image/png",
      sizeBytes: 7,
    });
    expect(stored.find((d) => d.kind === "rating")?.contentType).toBe(
      "image/jpeg",
    );
  });

  it("backfills applications that existed before, and never records a document twice", async () => {
    const earlier = await addApplication("r0", {
      earnings: "2026-09-01/earn.png",
    });
    source.files.set("2026-09-01/earn.png", {
      body: Buffer.from("EARN"),
      contentType: "image/png",
    });

    await copier().run();
    await copier().run();

    const all = await rows();
    expect(all).toHaveLength(3);
    expect(all.filter((d) => d.applicationId === earlier)).toHaveLength(1);
    expect(
      source.fetched.filter((p) => p === "2026-10-07/licence.png"),
    ).toHaveLength(1);
  });

  it("without a source it records the documents as pending and copies nothing", async () => {
    expect(await copier({ source: null }).run()).toBeNull();

    expect((await rows()).map((d) => d.status)).toEqual(["pending", "pending"]);
    expect(storage.files.size).toBe(0);
  });

  it("a file the website no longer has is given up at once, with the reason, and the others still copy", async () => {
    source.files.delete("2026-10-07/rating-x.jpg"); // gone from the website

    const result = await copier().run();

    expect(result).toEqual({ stored: 1, retryLater: 0, failed: 1 });
    const gone = (await rows()).find((d) => d.kind === "rating")!;
    expect(gone.status).toBe("failed");
    expect(gone.lastError).toContain("no longer has this file");
  });

  it("a refused token stops the run and does not use up any attempts", async () => {
    const refused = new DocumentSourceError("token refused", false, true);
    source.failures.set("2026-10-07/licence.png", refused);
    source.failures.set("2026-10-07/rating-x.jpg", refused);

    const result = await copier().run();

    expect(result).toEqual({ stored: 0, retryLater: 0, failed: 0 });
    expect((await rows()).map((d) => [d.status, d.attempts])).toEqual([
      ["pending", 0],
      ["pending", 0],
    ]);

    // Once the token is fixed, the next run copies them.
    source.failures.clear();
    expect(await copier().run()).toEqual({
      stored: 2,
      retryLater: 0,
      failed: 0,
    });
  });

  it("a temporary failure is retried and only given up after the last attempt", async () => {
    source.failures.set(
      "2026-10-07/licence.png",
      new DocumentSourceError(
        "The website's storage answered 503. It will be tried again.",
      ),
    );

    await copier().run();
    const first = (await rows()).find((d) => d.kind === "license")!;
    expect(first).toMatchObject({ status: "pending", attempts: 1 });

    for (let i = 1; i < MAX_DOCUMENT_ATTEMPTS; i++) await copier().run();
    const last = (await rows()).find((d) => d.kind === "license")!;
    expect(last).toMatchObject({
      status: "failed",
      attempts: MAX_DOCUMENT_ATTEMPTS,
    });
    expect(last.lastError).toContain("503");
  });

  describe("GET /applications/:id/documents", () => {
    const controller = (overrides: Partial<DocumentCopierDeps> = {}) =>
      new ApplicationDocumentsController(
        db.getRepository(Application),
        db.getRepository(ApplicationDocument),
        deps(overrides),
      );

    it("lists the documents in order, with a signed link only for copied ones", async () => {
      await copier().run();
      await db.query(
        `UPDATE application_documents SET status = 'pending', storage_key = NULL, size_bytes = NULL
         WHERE kind = 'rating'`,
      );

      const list = await controller().list(applicationId);

      expect(list.items.map((d) => [d.kind, d.status])).toEqual([
        ["license", "stored"],
        ["rating", "pending"],
      ]);
      expect(list.items[0].url).toMatch(
        /^https:\/\/bucket\.test\/applications\//,
      );
      expect(list.items[1].url).toBeNull();
      expect(list).toMatchObject({
        sourceConnected: true,
        storageConnected: true,
      });
    });

    it("says when the connections are missing, and 404s for an unknown application", async () => {
      await copier({ source: null }).run();

      const list = await controller({ source: null, storage: null }).list(
        applicationId,
      );

      expect(list).toMatchObject({
        sourceConnected: false,
        storageConnected: false,
      });
      expect(list.items.every((d) => d.url === null)).toBe(true);
      await expect(
        controller().list("00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
