import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource, In } from "typeorm";
import { FILE_LINK_SECONDS } from "../../sms/storage/file-storage.js";
import { Driver } from "../../drivers/driver.entity.js";
import { Application } from "../application.entity.js";
import {
  DOCUMENT_COPIER_DEPS,
  type DocumentCopierDeps,
} from "./application-document-copier.js";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  OTHER_SLOT_COUNT,
  ApplicationDocumentOrigin,
  ApplicationDocumentStatus,
} from "./application-document.entity.js";
import type {
  ApplicationDocumentDto,
  ApplicationDocumentListDto,
} from "./dto/application-document.dto.js";
import {
  DOCUMENT_LABEL,
  DRIVER_DOCUMENT_KINDS,
  DRIVER_OWNED_KINDS,
  checkUpload,
  documentStorageKey,
  driverDocumentStorageKey,
} from "./upload-file.js";

/** Whose slots are meant: an application's, or a driver's own (a driver added directly, D85). */
type Owner = { applicationId: string } | { driverId: string };

/**
 * An application's documents: reading them (our own copies, D54) and admin uploads into the three slots (D68):
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
    return this.listRows({ applicationId });
  }

  /**
   * The documents of one driver (D85): those of the application it came from, or its own when it was added directly
   * (a driver has one or the other), plus the driver's signed contract, which is always the driver's own (D90). Same
   * shape as an application's list.
   * @throws NotFoundException unknown driver.
   */
  async listForDriver(driverId: string): Promise<ApplicationDocumentListDto> {
    const owner = await this.ownerOfDriver(driverId);
    return this.listRows(owner, driverId);
  }

  /**
   * @param contractOf the driver whose own contract row is added to an application's rows; not needed when `owner` is
   *   already that driver (its rows include the contract).
   */
  private async listRows(
    owner: Owner,
    contractOf?: string,
  ): Promise<ApplicationDocumentListDto> {
    const repository = this.dataSource.getRepository(ApplicationDocument);
    const rows = await repository.find({
      where: owner,
      relations: { uploadedBy: true },
    });
    if (contractOf !== undefined && "applicationId" in owner) {
      // The driver's own files (contract, licence back, "Other") are never kept on the application.
      rows.push(
        ...(await repository.find({
          where: { driverId: contractOf, kind: In([...DRIVER_OWNED_KINDS]) },
          relations: { uploadedBy: true },
        })),
      );
    }
    rows.sort(
      (a, b) =>
        DRIVER_DOCUMENT_KINDS.indexOf(a.kind) -
          DRIVER_DOCUMENT_KINDS.indexOf(b.kind) || a.slot - b.slot,
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
    if (DRIVER_OWNED_KINDS.includes(kind)) {
      // Application rows are deleted with the application (CASCADE); these files must outlive it (D90).
      throw new BadRequestException(
        `${DOCUMENT_LABEL[kind]} belongs to a driver, not an application. Upload it on the driver's page.`,
      );
    }
    await this.requireApplication(applicationId);
    return this.store({ applicationId }, kind, 0, null, file, adminId);
  }

  /**
   * Puts `file` in the `kind` slot of a driver (D85). A driver that came from an application uses that application's slot,
   * so the two pages always show the same file; one added directly has its own rows. The signed contract (D90) is the
   * exception: it is always the driver's own row, whether or not the driver has an application. So are the back of the
   * licence and the "Other" files (fleet revisions section 3); an "Other" file needs a `slot` (1 to 5) and a `label`.
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException / ServiceUnavailableException as `upload`.
   */
  async uploadForDriver(
    driverId: string,
    kind: ApplicationDocumentKind,
    file: Express.Multer.File,
    adminId: string,
    other?: { slot?: number; label?: string },
  ): Promise<ApplicationDocumentDto> {
    let slot = 0;
    let label: string | null = null;
    if (kind === ApplicationDocumentKind.other) {
      slot = other?.slot ?? 0;
      label = other?.label?.trim() || null;
      if (!Number.isInteger(slot) || slot < 1 || slot > OTHER_SLOT_COUNT) {
        throw new BadRequestException(
          `slot must be a number from 1 to ${OTHER_SLOT_COUNT} for an "Other" document.`,
        );
      }
      if (!label || label.length > 60) {
        throw new BadRequestException(
          'label is required for an "Other" document (1 to 60 characters).',
        );
      }
    }
    const owner: Owner = DRIVER_OWNED_KINDS.includes(kind)
      ? await this.driverOwnRows(driverId)
      : await this.ownerOfDriver(driverId);
    return this.store(owner, kind, slot, label, file, adminId);
  }

  /** The shared body of both uploads: the slot of `owner` gets the new file. */
  private async store(
    owner: Owner,
    kind: ApplicationDocumentKind,
    slot: number,
    label: string | null,
    file: Express.Multer.File,
    adminId: string,
  ): Promise<ApplicationDocumentDto> {
    const type = checkUpload(DOCUMENT_LABEL[kind], file);
    const { storage } = this.deps;
    if (!storage) {
      throw new ServiceUnavailableException(
        "File storage is not set up, so documents cannot be saved.",
      );
    }

    const key =
      "applicationId" in owner
        ? documentStorageKey(
            owner.applicationId,
            kind,
            randomUUID(),
            type.extension,
          )
        : driverDocumentStorageKey(
            owner.driverId,
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
            where: { ...owner, kind, slot },
            lock: { mode: "pessimistic_write" },
          });
          const values = {
            label,
            origin: ApplicationDocumentOrigin.admin,
            // An upload over a firma copy makes the slot the admin's (D90); the contract page keeps its own file.
            contractId: null,
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
            applicationId:
              "applicationId" in owner ? owner.applicationId : null,
            driverId: "driverId" in owner ? owner.driverId : null,
            kind,
            slot,
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

  /**
   * Who owns a driver's documents (D85): its application when it has one, otherwise the driver itself.
   * @throws NotFoundException unknown driver.
   */
  private async ownerOfDriver(driverId: string): Promise<Owner> {
    await this.requireDriver(driverId);
    const application = await this.dataSource
      .getRepository(Application)
      .findOne({ select: { id: true }, where: { driverId } });
    return application ? { applicationId: application.id } : { driverId };
  }

  /**
   * The driver itself as owner, even when it has an application (D90: a signed contract is never kept on the application).
   * @throws NotFoundException unknown driver.
   */
  private async driverOwnRows(driverId: string): Promise<Owner> {
    await this.requireDriver(driverId);
    return { driverId };
  }

  private async requireDriver(driverId: string): Promise<void> {
    if (
      !(await this.dataSource.getRepository(Driver).existsBy({ id: driverId }))
    ) {
      throw new NotFoundException("Driver not found.");
    }
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
      slot: row.slot,
      label: row.label,
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
