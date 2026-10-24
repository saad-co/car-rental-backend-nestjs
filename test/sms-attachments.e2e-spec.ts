import type { DataSource } from "typeorm";
import {
  AttachmentDownloader,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTEMPTS,
} from "../src/sms/attachments/attachment-downloader.js";
import {
  SmsAttachment,
  SmsAttachmentStatus,
} from "../src/sms/sms-attachment.entity.js";
import type { SmsDeps } from "../src/sms/sms.service.js";
import type { FileStorage } from "../src/sms/storage/file-storage.js";
import { openTestDatabase } from "./test-database.js";

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

/** A network in memory: answers by URL, and records the headers each request carried. */
function fakeFetch(
  answers: Record<string, () => Response | Promise<Response>>,
) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = ((url: URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const answer = answers[String(url)];
    return Promise.resolve(
      answer ? answer() : new Response("not found", { status: 404 }),
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("AttachmentDownloader (test database)", () => {
  let db: DataSource;
  let storage: FakeStorage;
  let messageId: string;

  const downloader = (
    fetchImpl: typeof fetch,
    overrides: Partial<SmsDeps> = {},
  ) =>
    new AttachmentDownloader(db, {
      mode: "dry_run",
      quo: null,
      phoneNumberId: null,
      storage,
      quoApiKey: "quo-key",
      fetchImpl,
      ...overrides,
    });

  async function addAttachment(url: string, contentType: string | null) {
    const saved = await db.getRepository(SmsAttachment).save({
      messageId,
      position: (await db.getRepository(SmsAttachment).count()) + 1,
      sourceUrl: url,
      contentType,
    });
    return saved.id;
  }
  const row = (id: string) =>
    db.getRepository(SmsAttachment).findOneByOrFail({ id });

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE sms_attachments, sms_messages CASCADE");
    storage = new FakeStorage();
    const [{ id }] = (await db.query(
      `INSERT INTO sms_messages (direction, contact_phone, body, status, occurred_at)
       VALUES ('inbound', '+13125550111', 'photo', 'received', now()) RETURNING id`,
    )) as [{ id: string }];
    messageId = id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("copies a file into the bucket and records where", async () => {
    const id = await addAttachment("https://media.test/a.jpg", "image/jpeg");
    const { fetchImpl } = fakeFetch({
      "https://media.test/a.jpg": () =>
        new Response(Buffer.from("JPEGDATA"), { status: 200 }),
    });

    const result = await downloader(fetchImpl).run();

    expect(result).toEqual({ stored: 1, retryLater: 0, failed: 0 });
    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "stored",
      sizeBytes: 8,
      contentType: "image/jpeg",
      storageKey: `sms/${messageId}/${id}`,
    });
    expect(storage.files.get(stored.storageKey!)?.body.toString()).toBe(
      "JPEGDATA",
    );
  });

  it("takes the type from the download when Quo gave none", async () => {
    const id = await addAttachment("https://media.test/b", null);
    const { fetchImpl } = fakeFetch({
      "https://media.test/b": () =>
        new Response("%PDF", {
          status: 200,
          headers: { "content-type": "application/pdf; charset=binary" },
        }),
    });

    await downloader(fetchImpl).run();

    expect((await row(id)).contentType).toBe("application/pdf");
  });

  it("retries once with the Quo key when the link answers 401", async () => {
    const id = await addAttachment("https://media.test/c.jpg", "image/jpeg");
    let first = true;
    const { calls, fetchImpl } = fakeFetch({
      "https://media.test/c.jpg": () => {
        const refuse = first;
        first = false;
        return refuse
          ? new Response("no", { status: 401 })
          : new Response("DATA", { status: 200 });
      },
    });

    await downloader(fetchImpl).run();

    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBe("quo-key");
    expect((await row(id)).status).toBe("stored");
  });

  it("gives up at once on a dead link and keeps the reason", async () => {
    const id = await addAttachment("https://media.test/gone.jpg", null);
    const { fetchImpl } = fakeFetch({}); // everything is 404

    const result = await downloader(fetchImpl).run();

    expect(result?.failed).toBe(1);
    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toContain("no longer works");
    expect(storage.files.size).toBe(0);
  });

  it("refuses non-https links and files over the size limit", async () => {
    const plain = await addAttachment("http://media.test/p.jpg", null);
    const huge = await addAttachment("https://media.test/huge.bin", null);
    const { calls, fetchImpl } = fakeFetch({
      "https://media.test/huge.bin": () =>
        new Response("x", {
          status: 200,
          headers: { "content-length": String(MAX_ATTACHMENT_BYTES + 1) },
        }),
    });

    await downloader(fetchImpl).run();

    expect((await row(plain)).lastError).toContain("non-https");
    expect(calls.some((c) => c.url.startsWith("http://"))).toBe(false);
    expect((await row(huge)).status).toBe("failed");
    expect((await row(huge)).lastError).toContain("too large");
  });

  it("a temporary failure stays pending, and becomes failed after the last attempt", async () => {
    const id = await addAttachment("https://media.test/slow.jpg", null);
    const { fetchImpl } = fakeFetch({
      "https://media.test/slow.jpg": () =>
        new Response("busy", { status: 503 }),
    });

    await downloader(fetchImpl).run();
    expect(await row(id)).toMatchObject({ status: "pending", attempts: 1 });

    for (let i = 1; i < MAX_ATTEMPTS; i++) await downloader(fetchImpl).run();
    const last = await row(id);
    expect(last).toMatchObject({
      status: SmsAttachmentStatus.failed,
      attempts: MAX_ATTEMPTS,
    });
    expect(last.lastError).toContain("503");
  });

  it("does nothing without a bucket", async () => {
    const id = await addAttachment("https://media.test/a.jpg", null);
    const { calls, fetchImpl } = fakeFetch({});

    expect(await downloader(fetchImpl, { storage: null }).run()).toBeNull();
    expect(calls).toEqual([]);
    expect((await row(id)).status).toBe("pending");
  });
});
