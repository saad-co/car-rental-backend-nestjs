import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { recordAudit } from "../audit/record-audit.js";
import { Driver } from "../drivers/driver.entity.js";
import {
  LedgerDirection,
  LedgerEntryKind,
} from "../ledger/ledger-entry.entity.js";
import { ledgerRef } from "../ledger/ledger-ref.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { DAMAGE_SHOT_ID, InspectionPhoto } from "./inspection-photo.entity.js";
import {
  buildInspectionReport,
  type ReportDamage,
  type ReportPhoto,
} from "./inspection-report.js";
import { photoFileStem, sortPhotos } from "./inspection-photo-order.js";
import { InspectionShotAnswer } from "./inspection-shot-answer.entity.js";
import { InspectionShot } from "./inspection-shot.entity.js";
import {
  FuelLevel,
  Inspection,
  InspectionStatus,
  InspectionType,
} from "./inspection.entity.js";
import { buildZip, type ZipEntry } from "./zip-writer.js";

/** A finished export, ready to send: the file name to save it under and its bytes. */
export interface ExportedFile {
  fileName: string;
  data: Buffer;
}

const FUEL_WORDS: Record<FuelLevel, string> = {
  [FuelLevel.empty]: "Empty",
  [FuelLevel.oneEighth]: "1/8",
  [FuelLevel.oneQuarter]: "1/4",
  [FuelLevel.threeEighths]: "3/8",
  [FuelLevel.half]: "1/2",
  [FuelLevel.fiveEighths]: "5/8",
  [FuelLevel.threeQuarters]: "3/4",
  [FuelLevel.sevenEighths]: "7/8",
  [FuelLevel.full]: "Full",
};

const STATUS_WORDS: Record<InspectionStatus, string> = {
  [InspectionStatus.created]: "Not sent yet",
  [InspectionStatus.linkSent]: "Link sent",
  [InspectionStatus.opened]: "Link opened",
  [InspectionStatus.inProgress]: "In progress",
  [InspectionStatus.submitted]: "Submitted",
  [InspectionStatus.reviewed]: "Reviewed",
  [InspectionStatus.flagged]: "Damage flagged",
  [InspectionStatus.revoked]: "Revoked",
};

/** One photo row with its file name (no extension) and title (the order and words the driver saw). */
interface PhotoRow {
  photo: InspectionPhoto;
  stem: string;
  title: string;
}

/**
 * "Download all": a ZIP of the original photos and a one-file PDF report of an inspection (Module 3 chat 2, step 4). Staff only.
 * Every export writes a line to the audit trail (who took a copy of the evidence). The ZIP is made with a small writer of our
 * own (no library): photos are JPEGs, so they are stored as they are.
 *
 * Express comparison: a route handler that reads files and builds a response body; here it returns the bytes and the controller
 * sets the headers.
 */
@Injectable()
export class InspectionExportService {
  private readonly logger = new Logger(InspectionExportService.name);

  /** The clock; a property so a test can fix the "generated" time. */
  now = (): Date => new Date();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    // `null` when no bucket is set up: there is then nothing to export.
    @Optional()
    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage | null = null,
  ) {}

  // --------------------------------------------------------------------- zip

  /**
   * The ZIP of the inspection's original photos: `<reference>/NN_<SHOT_ID>.jpg` for each shot, `NN_<SHOT_ID>_damage_K.jpg` for
   * its close-ups (D112), and `damage_N.jpg` for an old free-standing damage photo. A file the bucket cannot give is left out and named in `MISSING.txt` inside the ZIP (never silently).
   * @throws NotFoundException unknown inspection.
   * @throws ConflictException no photos yet.
   * @throws ServiceUnavailableException no file storage is set up.
   */
  async zip(id: string, adminId: string): Promise<ExportedFile> {
    const storage = this.requireStorage();
    const { inspection, rows } = await this.load(id);
    if (rows.length === 0) {
      throw new ConflictException("This inspection has no photos to download.");
    }
    const entries: ZipEntry[] = [];
    const missing: string[] = [];
    for (const { photo, stem } of rows) {
      const name = `${stem}.jpg`;
      try {
        entries.push({
          name: `${inspection.reference}/${name}`,
          data: await storage.get(photo.storageKey),
        });
      } catch (error) {
        this.logger.error(
          `Export of ${inspection.reference}: ${name} cannot be read: ${errorText(error)}`,
        );
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      entries.push({
        name: `${inspection.reference}/MISSING.txt`,
        data: Buffer.from(
          `These photos could not be read from storage and are not in this ZIP:\n${missing.join("\n")}\n`,
        ),
      });
    }
    await this.audit(adminId, "inspection.export_zip", inspection, {
      photos: entries.length - (missing.length > 0 ? 1 : 0),
      missing: missing.length,
    });
    return { fileName: `${inspection.reference}.zip`, data: buildZip(entries) };
  }

  // --------------------------------------------------------------------- pdf

  /**
   * The one-file PDF report: facts, review, damage marked by staff, and every photo as a thumbnail with its fingerprint.
   * @throws NotFoundException unknown inspection.
   * @throws ServiceUnavailableException no file storage is set up.
   */
  async report(id: string, adminId: string): Promise<ExportedFile> {
    const storage = this.requireStorage();
    const { inspection, rows, requiredShots } = await this.load(id);
    const answers = new Map(
      (
        await this.dataSource
          .getRepository(InspectionShotAnswer)
          .findBy({ inspectionId: id })
      ).map((a) => [a.shotId, a.hasDamage]),
    );
    const [driver, reviewer, paired, items, admin] = await Promise.all([
      this.dataSource
        .getRepository(Driver)
        .findOneBy({ id: inspection.driverId }),
      inspection.reviewedById
        ? this.emailOf(inspection.reviewedById)
        : Promise.resolve(null),
      inspection.pairedInspectionId
        ? this.dataSource
            .getRepository(Inspection)
            .findOneBy({ id: inspection.pairedInspectionId })
        : Promise.resolve(null),
      this.damageLines(inspection.id, rows),
      this.emailOf(adminId),
    ]);

    let unreadable = 0;
    const reportPhoto = async ({
      photo,
      title,
    }: PhotoRow): Promise<ReportPhoto> => {
      let thumb: Buffer | null = null;
      try {
        thumb = await storage.get(photo.thumbKey);
      } catch (error) {
        unreadable++;
        this.logger.error(
          `Report of ${inspection.reference}: ${title} thumbnail cannot be read: ${errorText(error)}`,
        );
      }
      return {
        title,
        thumb,
        capturedAt: photo.capturedAt,
        uploadedAt: photo.uploadedAt,
        sha256: photo.sha256,
        driverNote: photo.driverNote,
      };
    };
    // The shots with their close-ups right after them (D112); old free-standing damage photos in their own section.
    const shots: ReportPhoto[] = [];
    const damagePhotos: ReportPhoto[] = [];
    for (const row of rows) {
      const photo = row.photo;
      if (photo.shotId === DAMAGE_SHOT_ID && !photo.parentShotId) {
        damagePhotos.push(await reportPhoto(row));
        continue;
      }
      const answer =
        photo.shotId === DAMAGE_SHOT_ID ? undefined : answers.get(photo.shotId);
      shots.push(
        await reportPhoto({
          ...row,
          title:
            answer === undefined
              ? row.title
              : `${row.title} - ${answer ? "damage: yes" : "no damage"}`,
        }),
      );
    }
    const shotCount = rows.filter(
      (r) => r.photo.shotId !== DAMAGE_SHOT_ID,
    ).length;
    const closeUpCount = rows.filter((r) => r.photo.parentShotId).length;
    const damagedShots = [...answers.values()].filter(Boolean).length;

    const data = await buildInspectionReport(
      {
        reference: inspection.reference,
        typeLabel:
          inspection.type === InspectionType.checkIn ? "Check-in" : "Check-out",
        statusLabel: STATUS_WORDS[inspection.status],
        driverName: driver
          ? `${driver.firstName} ${driver.lastName}`
          : "Unknown driver",
        vehicle: [
          inspection.vehicleModel,
          inspection.vehiclePlate,
          inspection.vehicleVin ? `VIN ${inspection.vehicleVin}` : null,
        ]
          .filter(Boolean)
          .join(" - "),
        pairedReference: paired?.reference ?? null,
        submittedAt: inspection.submittedAt,
        // Typed before D112; since then read from the photo.
        odometer:
          inspection.odometerMiles === null
            ? "See the odometer photo"
            : `${inspection.odometerMiles.toLocaleString("en-US")} mi`,
        fuel: inspection.fuelLevel
          ? FUEL_WORDS[inspection.fuelLevel]
          : "See the fuel photo",
        place:
          inspection.gpsLat !== null && inspection.gpsLng !== null
            ? `${inspection.gpsLat.toFixed(5)}, ${inspection.gpsLng.toFixed(5)}`
            : null,
        device: inspection.deviceInfo,
        attestedAt: inspection.attestedAt,
        review: inspection.reviewedAt
          ? `Reviewed by ${reviewer ?? "an admin"}${inspection.reviewNotes ? `: ${inspection.reviewNotes}` : ""}`
          : "Not reviewed",
        photosHeading: `Photos: ${shotCount} of ${requiredShots} shots, ${closeUpCount} damage close-up${closeUpCount === 1 ? "" : "s"}`,
        damageSummary:
          answers.size === 0
            ? null
            : damagedShots === 0
              ? "The driver reported no damage on any shot."
              : `The driver reported damage on ${damagedShots} shot${damagedShots === 1 ? "" : "s"}; the close-ups follow each shot.`,
        shots,
        damagePhotos,
        damageItems: items,
        generatedAt: this.now(),
        generatedBy: admin ?? "an admin",
      },
      (photo, error) => {
        // The bucket gave bytes but they could not be drawn: say why, and count it with the unreadable ones.
        unreadable++;
        this.logger.error(
          `Report of ${inspection.reference}: ${photo.title} thumbnail cannot be drawn (${photo.thumb?.length ?? 0} bytes, starts ${photo.thumb?.subarray(0, 4).toString("hex") ?? "-"}): ${errorText(error)}`,
        );
      },
    );
    await this.audit(adminId, "inspection.export_pdf", inspection, {
      photos: rows.length,
      unreadable,
    });
    return { fileName: `${inspection.reference}.pdf`, data };
  }

  // ----------------------------------------------------------------- helpers

  private requireStorage(): FileStorage {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        "File storage is not set up, so the photos cannot be exported.",
      );
    }
    return this.storage;
  }

  /** The inspection, its photos in viewing order (`sortPhotos`), and how many shots are required. */
  private async load(
    id: string,
  ): Promise<{
    inspection: Inspection;
    rows: PhotoRow[];
    requiredShots: number;
  }> {
    const inspection = await this.dataSource
      .getRepository(Inspection)
      .findOneBy({ id });
    if (!inspection) throw new NotFoundException("Inspection not found.");
    const [photos, shots] = await Promise.all([
      this.dataSource
        .getRepository(InspectionPhoto)
        .findBy({ inspectionId: id }),
      this.dataSource.getRepository(InspectionShot).find(),
    ]);
    const titleOf = new Map(shots.map((s) => [s.shotId, s.title]));
    const shotPosition = new Map(shots.map((s) => [s.shotId, s.position]));
    const rows = sortPhotos(photos, shotPosition).map((photo): PhotoRow => ({
      photo,
      stem: photoFileStem(photo, shotPosition),
      title:
        photo.shotId !== DAMAGE_SHOT_ID
          ? (titleOf.get(photo.shotId) ?? photo.shotId)
          : photo.parentShotId
            ? `${titleOf.get(photo.parentShotId) ?? photo.parentShotId} - damage close-up ${photo.position}`
            : `Damage photo ${photo.position}`,
    }));
    return {
      inspection,
      rows,
      requiredShots: shots.filter((s) => s.required).length,
    };
  }

  /** The damage staff marked on a check-out, in words, with the ledger line when it was charged. */
  private async damageLines(
    inspectionId: string,
    rows: PhotoRow[],
  ): Promise<ReportDamage[]> {
    const titleOf = new Map(rows.map((r) => [r.photo.id, r.title]));
    const found = (await this.dataSource.query(
      `SELECT d.photo_id AS "photoId", d.description, le.kind, le.direction, le.entry_no AS "entryNo"
       FROM damage_items d LEFT JOIN ledger_entries le ON le.id = d.ledger_entry_id
       WHERE d.inspection_id = $1 ORDER BY d.created_at, d.id`,
      [inspectionId],
    )) as {
      photoId: string;
      description: string;
      kind: LedgerEntryKind | null;
      direction: LedgerDirection | null;
      entryNo: string | null;
    }[];
    return found.map((item) => ({
      title: titleOf.get(item.photoId) ?? "Photo",
      description: item.description,
      charged:
        item.entryNo === null
          ? null
          : ledgerRef(item.kind!, item.direction!, Number(item.entryNo)),
    }));
  }

  private async emailOf(userId: string): Promise<string | null> {
    const [row] = (await this.dataSource.query(
      `SELECT email FROM users WHERE id = $1`,
      [userId],
    )) as { email: string }[];
    return row?.email ?? null;
  }

  private async audit(
    adminId: string,
    action: string,
    inspection: Inspection,
    after: Record<string, unknown>,
  ): Promise<void> {
    await recordAudit(this.dataSource.manager, [
      {
        actorId: adminId,
        action,
        entityType: "inspection",
        entityId: inspection.id,
        after: { reference: inspection.reference, ...after },
      },
    ]);
    this.logger.log(
      `Admin ${adminId} exported ${inspection.reference} (${action}).`,
    );
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
