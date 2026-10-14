import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  SmsAttachment,
  SmsAttachmentStatus,
} from "../sms-attachment.entity.js";
import { SMS_DEPS, type SmsDeps } from "../sms.service.js";

/** Largest file we copy. Bigger ones are refused while downloading, so one huge file cannot fill memory. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** After this many failed downloads a file is marked `failed` and no longer retried. */
export const MAX_ATTEMPTS = 5;
/** Give up on one download after this long. */
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Key of the Postgres advisory lock that lets only one run copy files at a time. Any fixed number works. */
const LOCK_KEY = 7_302_001;

/** A failure that retrying cannot fix (wrong kind of link, file too big, link gone). */
class PermanentDownloadError extends Error {}

export interface DownloadSummary {
  stored: number;
  retryLater: number;
  failed: number;
}

/**
 * Copies files that came with texts from Quo's links into our own bucket (D50). Quo only gives a link, and we
 * do not know whether it expires (B57), so a file is copied as soon as it is seen.
 *
 * A file is `pending` until copied. A failed download adds one attempt and records the reason; after
 * `MAX_ATTEMPTS`, or at once for a failure that cannot improve, it becomes `failed` (visible in the chat).
 * Runs every minute, and right after a webhook or sync brings new files.
 */
@Injectable()
export class AttachmentDownloader {
  private readonly logger = new Logger(AttachmentDownloader.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SMS_DEPS) private readonly deps: SmsDeps,
  ) {}

  /** Every minute. `waitForCompletion`: a tick never starts while the previous one still runs. */
  @Cron("0 * * * * *", { name: "sms-attachments", waitForCompletion: true })
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (result && result.stored + result.failed > 0) {
        this.logger.log(
          `Files: ${result.stored} saved, ${result.failed} given up, ${result.retryLater} to retry`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Copying files failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Starts a run without waiting for it (used after a webhook, which must answer Quo quickly). Never throws. */
  runInBackground(): void {
    this.run().catch((error: unknown) =>
      this.logger.error(
        `Copying files failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /**
   * Copies every pending file once. Returns null when there is no bucket (nothing to do) or another run holds
   * the lock.
   */
  async run(): Promise<DownloadSummary | null> {
    if (!this.deps.storage) return null;

    // An advisory lock belongs to one database connection, so take, use and release it on the same one.
    const lockConnection = this.dataSource.createQueryRunner();
    await lockConnection.connect();
    try {
      const [{ locked }] = (await lockConnection.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [LOCK_KEY],
      )) as [{ locked: boolean }];
      if (!locked) return null;
      try {
        return await this.copyPending();
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      await lockConnection.release();
    }
  }

  private async copyPending(): Promise<DownloadSummary> {
    const attachments = this.dataSource.getRepository(SmsAttachment);
    const pending = await attachments.find({
      where: { status: SmsAttachmentStatus.pending },
      order: { createdAt: "ASC" },
      take: 50,
    });

    const summary: DownloadSummary = { stored: 0, retryLater: 0, failed: 0 };
    for (const attachment of pending) {
      try {
        const copy = await this.download(attachment);
        const key = `sms/${attachment.messageId}/${attachment.id}`;
        await this.deps.storage!.put(key, copy.body, copy.contentType);
        await attachments.update(attachment.id, {
          status: SmsAttachmentStatus.stored,
          storageKey: key,
          sizeBytes: copy.body.length,
          contentType: copy.contentType,
          lastError: null,
        });
        summary.stored++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const attempts = attachment.attempts + 1;
        const giveUp =
          error instanceof PermanentDownloadError || attempts >= MAX_ATTEMPTS;
        await attachments.update(attachment.id, {
          attempts,
          lastError: reason,
          status: giveUp
            ? SmsAttachmentStatus.failed
            : SmsAttachmentStatus.pending,
        });
        this.logger.warn(
          `File ${attachment.id} (attempt ${attempts}${giveUp ? ", given up" : ""}): ${reason}`,
        );
        if (giveUp) summary.failed++;
        else summary.retryLater++;
      }
    }
    return summary;
  }

  /**
   * Downloads one file. Only `https` links are fetched. If the link answers 401/403 it is tried once more with
   * our Quo API key (we do not know whether Quo's media links need it, B57).
   */
  private async download(
    attachment: SmsAttachment,
  ): Promise<{ body: Buffer; contentType: string | null }> {
    const url = new URL(attachment.sourceUrl);
    if (url.protocol !== "https:")
      throw new PermanentDownloadError(
        `Refusing a non-https file link (${url.protocol}).`,
      );

    const doFetch = this.deps.fetchImpl ?? fetch;
    const get = (headers: Record<string, string>) =>
      doFetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

    let response = await get({});
    if (
      (response.status === 401 || response.status === 403) &&
      this.deps.quoApiKey
    ) {
      await response.body?.cancel();
      response = await get({ Authorization: this.deps.quoApiKey });
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      throw new PermanentDownloadError(
        `The file link no longer works (${response.status}); it may have expired.`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`The file link answered ${response.status}.`);
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
      await response.body?.cancel();
      throw new PermanentDownloadError(
        `The file is too large (${declared} bytes; the limit is ${MAX_ATTACHMENT_BYTES}).`,
      );
    }

    // Read in pieces and stop as soon as the limit is passed, whatever the headers claimed.
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES) {
          throw new PermanentDownloadError(
            `The file is too large (the limit is ${MAX_ATTACHMENT_BYTES} bytes).`,
          );
        }
        chunks.push(chunk);
      }
    }
    if (size === 0) throw new Error("The file link returned an empty file.");

    const headerType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    return {
      body: Buffer.concat(chunks),
      contentType: attachment.contentType ?? (headerType || null),
    };
  }
}
