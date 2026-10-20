import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { FILE_LINK_SECONDS } from "../../sms/storage/file-storage.js";
import { Application } from "../application.entity.js";
import {
  DOCUMENT_COPIER_DEPS,
  type DocumentCopierDeps,
} from "./application-document-copier.js";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  ApplicationDocumentOrigin,
  ApplicationDocumentStatus,
} from "./application-document.entity.js";
import type {
  ApplicationDocumentDto,
  ApplicationDocumentListDto,
} from "./dto/application-document.dto.js";
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABEL,
  checkUpload,
  documentStorageKey,
} from "./upload-file.js";

/**
 * An application's documents: reading them (our own copies, D54) and admin uploads into the three slots (D64):
 * licence, rating screenshot, earnings. One file per slot. Uploading into a filled slot replaces the file, a website
 * copy included.
 */
@Injectable()
export class ApplicationDocumentsService {
  private readonly logger = new Logger(ApplicationDocumentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    /** The website source and our bucket; either may be null when not set up. */
    @Inject(DOCUMENT_COPIER_DEPS) private readonly deps: DocumentCopierDeps,
  ) {}

  /**
   * The documents of one application in the order licence, rating, earnings, each with a short-lived link to open
   * our copy (the bucket itself is private).
   * @throws NotFoundException unknown application.
   */
  async list(applicationId: string): Promise<ApplicationDocumentListDto> {
    await this.requireApplication(applicationId);
    const rows = await this.dataSource.getRepository(ApplicationDocument).find({
      where: { applicationId },
      relations: { uploadedBy: true },
    });
    rows.sort(
      (a, b) => DOCUMENT_KINDS.indexOf(a.kind) - DOCUMENT_KINDS.indexOf(b.kind),
    );
    return {
      items: await Promise.all(rows.map((row) => this.toDto(row))),
      sourceConnected: this.deps.source !== null,
      storageConnected: this.deps.storage !== null,
    };
  }

  /**
   * Puts `file` in the `kind` slot of the application and returns the slot as the Documents tab shows it.
   *
   * The new file gets a NEW key, so the old file stays readable until the row points at the new one. Only then is the
   * old file removed (a failed removal is logged as an error, not thrown: the new file is already live and the old
   * object is just left over). If the database part fails, the new file is removed again.
   *
   * @throws NotFoundException unknown application.
   * @throws BadRequestException the file is empty, over 10 MB, or not a JPG, PNG or PDF.
   * @throws ServiceUnavailableException no file bucket is set up.
   */
  async upload(
    applicationId: string,
    kind: ApplicationDocumentKind,
    file: Express.Multer.File,
    adminId: string,
  ): Promise<ApplicationDocumentDto> {
    await this.requireApplication(applicationId);
    const type = checkUpload(DOCUMENT_LABEL[kind], file);
    const { storage } = this.deps;
    if (!storage) {
      throw new ServiceUnavailableException(
        "File storage is not set up, so documents cannot be saved.",
      );
    }

    const key = documentStorageKey(
      applicationId,
      kind,
      randomUUID(),
      type.extension,
    );
    await storage.put(key, file.buffer, type.contentType);

    let oldKey: string | null;
    let documentId: string;
    try {
      ({ oldKey, documentId } = await this.dataSource.transaction(
        async (manager) => {
          // Lock the slot's row (if there is one), so a copy finishing at the same moment, or a second upload,
          // waits here and then sees this result.
          const existing = await manager.findOne(ApplicationDocument, {
            where: { applicationId, kind },
            lock: { mode: "pessimistic_write" },
          });
          const values = {
            origin: ApplicationDocumentOrigin.admin,
            sourcePath: null,
            status: ApplicationDocumentStatus.stored,
            storageKey: key,
            sizeBytes: file.size,
            contentType: type.contentType,
            uploadedById: adminId,
            attempts: 0,
            lastError: null,
          };
          if (existing) {
            await manager.update(ApplicationDocument, existing.id, values);
            return { oldKey: existing.storageKey, documentId: existing.id };
          }
          const inserted = await manager.insert(ApplicationDocument, {
            applicationId,
            kind,
            ...values,
          });
          return {
            oldKey: null,
            documentId: (inserted.identifiers[0] as { id: string }).id,
          };
        },
      ));
    } catch (error) {
      await this.removeQuietly(key, "the new file after a failed save");
      throw error;
    }

    if (oldKey) await this.removeQuietly(oldKey, "the replaced file");
    const document = await this.dataSource
      .getRepository(ApplicationDocument)
      .findOneOrFail({
        where: { id: documentId },
        relations: { uploadedBy: true },
      });
    return this.toDto(document);
  }

  private async requireApplication(applicationId: string): Promise<void> {
    const exists = await this.dataSource
      .getRepository(Application)
      .existsBy({ id: applicationId });
    if (!exists) throw new NotFoundException("Application not found.");
  }

  /** The row as the admin screens see it; the link only exists for a stored file in a connected bucket. */
  private async toDto(
    row: ApplicationDocument,
  ): Promise<ApplicationDocumentDto> {
    const { storage } = this.deps;
    const canOpen =
      row.status === ApplicationDocumentStatus.stored &&
      row.storageKey !== null &&
      storage !== null;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      origin: row.origin,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      url: canOpen
        ? await storage.presignGet(row.storageKey!, FILE_LINK_SECONDS)
        : null,
      error: row.lastError,
      uploadedByEmail: row.uploadedBy?.email ?? null,
    };
  }

  /** Removes one object; a failure is logged with its reason and never thrown (nothing depends on it any more). */
  private async removeQuietly(key: string, what: string): Promise<void> {
    try {
      await this.deps.storage?.delete(key);
    } catch (error) {
      this.logger.error(
        `Could not remove ${what} (${key}); it is left in the bucket.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
