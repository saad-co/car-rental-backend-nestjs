import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import type { FileStorage } from "../../sms/storage/file-storage.js";
import {
  ApplicationDocument,
  ApplicationDocumentStatus,
} from "./application-document.entity.js";
import { DocumentSourceError, type DocumentSource } from "./document-source.js";

/** Injection token for `DocumentCopierDeps`. */
export const DOCUMENT_COPIER_DEPS = Symbol("DOCUMENT_COPIER_DEPS");

/** What the copier needs from outside, built once by the module from the settings (tests hand it fakes). */
export interface DocumentCopierDeps {
  /** Null when `DOCUMENTS_SOURCE_URL` is not set: documents are listed but cannot be copied. */
  source: DocumentSource | null;
  /** Null when no bucket is set: nothing can be stored. */
  storage: FileStorage | null;
}

/** After this many failed copies a document is marked `failed` and no longer retried. */
export const MAX_DOCUMENT_ATTEMPTS = 5;
/** Documents copied per run, so one run stays short; the next minute continues. */
const BATCH_SIZE = 20;
/** Key of the Postgres advisory lock that lets only one run copy documents at a time. Any fixed number works. */
const LOCK_KEY = 7_302_002;

export interface CopySummary {
  stored: number;
  retryLater: number;
  failed: number;
}

/** File types we know by extension, for when the source does not say. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
};

/**
 * Copies the documents applicants uploaded on the website into our own private bucket (D54).
 *
 * Each run first records a row for every application path that has none yet. That is also the backfill: the
 * applications that arrived before this existed are picked up the same way, with no separate script. Then it
 * copies the pending ones: ask the website's read-only function for the file, store it under
 * `applications/<applicationId>/<kind>-<id>.<ext>`, mark it `stored`. A failed copy adds one attempt and keeps
 * the reason; after `MAX_DOCUMENT_ATTEMPTS`, or at once when it cannot work (the file is gone), it is `failed`.
 *
 * Runs every minute and right after a new application arrives. We only ever READ from the website.
 */
@Injectable()
export class ApplicationDocumentCopier {
  private readonly logger = new Logger(ApplicationDocumentCopier.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(DOCUMENT_COPIER_DEPS) private readonly deps: DocumentCopierDeps,
  ) {}

  /** Every minute. `waitForCompletion`: a tick never starts while the previous one still runs. */
  @Cron("30 * * * * *", {
    name: "application-documents",
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (result && result.stored + result.failed > 0) {
        this.logger.log(
          `Documents: ${result.stored} copied, ${result.failed} given up, ${result.retryLater} to retry`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Copying documents failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Starts a run without waiting for it (used right after an application arrives). Never throws. */
  runInBackground(): void {
    this.run().catch((error: unknown) =>
      this.logger.error(
        `Copying documents failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /**
   * Records the missing rows, then copies pending documents once. Returns null when another run holds the lock,
   * or when there is nothing to copy with (no source or no bucket: the rows are still recorded, so the admin
   * pages can say the connection is missing).
   */
  async run(): Promise<CopySummary | null> {
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
        await this.recordMissing();
        if (!this.deps.source || !this.deps.storage) return null;
        return await this.copyPending(this.deps.source, this.deps.storage);
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      await lockConnection.release();
    }
  }

  /** One row per application path that has none yet. Idempotent: the unique key (application, kind) decides. */
  private async recordMissing(): Promise<void> {
    await this.dataSource.query(`
      INSERT INTO application_documents (application_id, kind, source_path)
      SELECT id, kind::application_document_kind, path FROM (
        SELECT id, 'license' AS kind, license_storage_path AS path FROM applications
        UNION ALL
        SELECT id, 'rating', rating_storage_path FROM applications
        UNION ALL
        SELECT id, 'earnings', earnings_storage_path FROM applications
      ) found
      WHERE path IS NOT NULL AND btrim(path) <> ''
      ON CONFLICT (application_id, kind) DO NOTHING
    `);
  }

  private async copyPending(
    source: DocumentSource,
    storage: FileStorage,
  ): Promise<CopySummary> {
    const documents = this.dataSource.getRepository(ApplicationDocument);
    const pending = await documents.find({
      where: { status: ApplicationDocumentStatus.pending },
      order: { createdAt: "DESC" }, // newest applications first: they are the ones staff are opening
      take: BATCH_SIZE,
    });

    const summary: CopySummary = { stored: 0, retryLater: 0, failed: 0 };
    for (const document of pending) {
      try {
        const file = await source.fetch(document.sourcePath);
        const extension = /\.([A-Za-z0-9]{1,5})$/.exec(
          document.sourcePath,
        )?.[1];
        const key = `applications/${document.applicationId}/${document.kind}-${document.id}${extension ? `.${extension.toLowerCase()}` : ""}`;
        const contentType =
          file.contentType ??
          (extension
            ? (TYPE_BY_EXTENSION[extension.toLowerCase()] ?? null)
            : null);
        await storage.put(key, file.body, contentType);
        await documents.update(document.id, {
          status: ApplicationDocumentStatus.stored,
          storageKey: key,
          sizeBytes: file.body.length,
          contentType,
          lastError: null,
        });
        summary.stored++;
      } catch (error) {
        if (error instanceof DocumentSourceError && error.blocksAll) {
          // The connection itself is refused: every document would fail the same way, so stop, and do not
          // use up anyone's attempts. It continues on its own once the token is fixed.
          this.logger.error(error.message);
          return summary;
        }
        const reason =
          error instanceof DocumentSourceError
            ? error.message
            : "The copy could not be saved. It will be tried again.";
        const attempts = document.attempts + 1;
        const giveUp =
          (error instanceof DocumentSourceError && error.permanent) ||
          attempts >= MAX_DOCUMENT_ATTEMPTS;
        await documents.update(document.id, {
          attempts,
          lastError: reason,
          status: giveUp
            ? ApplicationDocumentStatus.failed
            : ApplicationDocumentStatus.pending,
        });
        this.logger.warn(
          `Document ${document.id} (attempt ${attempts}${giveUp ? ", given up" : ""}): ${error instanceof Error ? error.message : String(error)}`,
        );
        if (giveUp) summary.failed++;
        else summary.retryLater++;
      }
    }
    return summary;
  }
}
