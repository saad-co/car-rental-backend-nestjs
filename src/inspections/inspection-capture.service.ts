import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
import sharp from "sharp";
import { DataSource, EntityManager } from "typeorm";
import { MAX_UPLOAD_BYTES } from "../applications/documents/upload-file.js";
import { sniffFileType } from "../applications/documents/sniff-file-type.js";
import { Driver, DriverLanguage } from "../drivers/driver.entity.js";
import {
  FILE_LINK_SECONDS,
  type FileStorage,
} from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import {
  CapturePhotoDto,
  CaptureStateDto,
  PriorDamageDto,
  SetLanguageDto,
  SubmittedInspectionDto,
  SubmitInspectionDto,
  UploadedPhotoDto,
  UploadPhotoDto,
} from "./dto/capture.dto.js";
import {
  InspectionEvent,
  type InspectionEventType,
} from "./inspection-event.entity.js";
import {
  DAMAGE_SHOT_ID,
  InspectionPhoto,
  MAX_DAMAGE_PHOTOS,
} from "./inspection-photo.entity.js";
import { InspectionShot } from "./inspection-shot.entity.js";
import { linkWorks } from "./inspection-status.js";
import { hashToken, looksLikeToken } from "./inspection-token.js";
import {
  Inspection,
  InspectionStatus,
  SUBMITTED_INSPECTION_STATUSES,
} from "./inspection.entity.js";

const THUMB_WIDTH = 400;

/** The same plain sentence for a token we never issued, one that ran out of time and a revoked one: nothing to probe. */
const EXPIRED_MESSAGE = "This link has expired.";

/**
 * The driver's side of an inspection (Module 3, D102): what the capture page at `/i/:token` reads and writes. There is no login;
 * the link is the identity. Every method starts from the token, finds the inspection by the token's hash, and answers the same
 * way for a token that does not exist, one that ran out of time and one that was revoked.
 *
 * Express comparison: the handlers behind a router with no auth middleware. The check "is this link still good" is in the
 * service, in the same transaction as the write, so a link revoked a moment ago cannot still take a photo.
 */
@Injectable()
export class InspectionCaptureService {
  private readonly logger = new Logger(InspectionCaptureService.name);

  /** The clock; a property so a test can move time. */
  now = (): Date => new Date();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------- state

  /**
   * Everything the page needs. The first time an open link is read, the inspection becomes `opened`.
   * Never throws for a bad token: `state` says what to show (an unknown token reads `expired`).
   */
  async state(token: string): Promise<CaptureStateDto> {
    const inspection = await this.findByToken(this.dataSource.manager, token);
    if (!inspection) return this.emptyState("expired");
    if (inspection.status === InspectionStatus.revoked) {
      return this.emptyState("revoked");
    }
    if (
      (SUBMITTED_INSPECTION_STATUSES as readonly InspectionStatus[]).includes(
        inspection.status,
      )
    ) {
      return Object.assign(this.emptyState("submitted"), {
        reference: inspection.reference,
        type: inspection.type,
        submittedAt: inspection.submittedAt,
      });
    }
    const now = this.now();
    if (!linkWorks(inspection, now)) return this.emptyState("expired");

    await this.markOpened(inspection, now);
    const driver = await this.dataSource
      .getRepository(Driver)
      .findOneByOrFail({ id: inspection.driverId });
    const manager = this.dataSource.manager;
    const shots = await manager.find(InspectionShot, {
      order: { position: "ASC" },
    });
    const photos = await manager.find(InspectionPhoto, {
      where: { inspectionId: inspection.id },
      order: { shotId: "ASC", position: "ASC" },
    });
    return Object.assign(this.emptyState("open"), {
      reference: inspection.reference,
      type: inspection.type,
      language: driver.preferredLanguage,
      vehicle: {
        model: inspection.vehicleModel,
        plate: inspection.vehiclePlate,
        vinLast4: inspection.vehicleVin
          ? inspection.vehicleVin.trim().slice(-4)
          : null,
      },
      shots: shots.map((shot) => ({
        shotId: shot.shotId,
        position: shot.position,
        required: shot.required,
      })),
      photos: await Promise.all(photos.map((p) => this.photoDto(p))),
      odometerMiles: inspection.odometerMiles,
      fuelLevel: inspection.fuelLevel,
      priorDamage: await this.priorDamage(inspection),
      expiresAt: inspection.tokenExpiresAt,
    });
  }

  // ----------------------------------------------------------------- upload

  /**
   * Stores one photo (or only updates the note or a reading of one already stored). Safe to repeat: the same bytes for the same
   * slot change nothing, different bytes are a retake that replaces the file and counts in `retakeCount`. The server stamps its
   * own time and the SHA-256 of the file it received.
   * @throws GoneException unknown, expired or revoked link. @throws ConflictException already submitted.
   * @throws BadRequestException unknown shot, not a JPEG, a reading on the wrong shot, or no photo yet for a note-only update.
   */
  async uploadPhoto(
    token: string,
    shotId: string,
    dto: UploadPhotoDto,
    file: Express.Multer.File | undefined,
  ): Promise<UploadedPhotoDto> {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        "Photo storage is not set up on this server.",
      );
    }
    const storage = this.storage;
    const isDamage = shotId === DAMAGE_SHOT_ID;
    const shot = isDamage
      ? null
      : await this.dataSource
          .getRepository(InspectionShot)
          .findOneBy({ shotId });
    if (!isDamage && !shot) throw new NotFoundException("Unknown shot.");
    const position = isDamage ? (dto.position ?? 1) : 1;
    if (!isDamage && dto.position !== undefined && dto.position !== 1) {
      throw new BadRequestException("Only damage photos have a number.");
    }
    if (dto.odometerMiles !== undefined && shotId !== "INT_ODOMETER") {
      throw new BadRequestException(
        "The mileage belongs to the odometer photo.",
      );
    }
    if (dto.fuelLevel !== undefined && shotId !== "INT_FUEL") {
      throw new BadRequestException(
        "The fuel level belongs to the fuel photo.",
      );
    }
    let sha256: string | null = null;
    if (file) {
      if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        throw new BadRequestException("The photo is empty or too large.");
      }
      if (sniffFileType(file.buffer)?.contentType !== "image/jpeg") {
        throw new BadRequestException("The photo must be a JPEG picture.");
      }
      sha256 = createHash("sha256").update(file.buffer).digest("hex");
    }

    const found = await this.findByToken(this.dataSource.manager, token);
    if (!found) throw new GoneException(EXPIRED_MESSAGE);

    const result = await this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockOpen(manager, found.id);
      const existing = await manager.findOneBy(InspectionPhoto, {
        inspectionId: inspection.id,
        shotId,
        position,
      });
      if (!file && !existing) {
        throw new BadRequestException("Send the photo first.");
      }
      const now = this.now();
      const fileName = isDamage
        ? `D${String(position).padStart(2, "0")}_${DAMAGE_SHOT_ID}.jpg`
        : `${String(shot!.position).padStart(2, "0")}_${shotId}.jpg`;
      const storageKey = `inspections/${inspection.id}/${fileName}`;
      const thumbKey = `inspections/${inspection.id}/thumbs/${fileName}`;

      const storesFile = file !== undefined && existing?.sha256 !== sha256;
      let photo: InspectionPhoto;
      if (storesFile) {
        const thumb = await makeThumbnail(file!.buffer);
        try {
          await storage.put(storageKey, file!.buffer, "image/jpeg");
          await storage.put(thumbKey, thumb, "image/jpeg");
        } catch (error) {
          this.logger.error(
            `Saving photo ${shotId} of ${inspection.reference} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new ServiceUnavailableException(
            "The photo could not be saved. Please try again.",
          );
        }
        if (existing) {
          existing.storageKey = storageKey;
          existing.thumbKey = thumbKey;
          existing.sha256 = sha256!;
          existing.uploadedAt = now;
          existing.retakeCount += 1;
          // A retake is a new photo: its own device time, or none.
          existing.capturedAt = dto.capturedAt
            ? new Date(dto.capturedAt)
            : null;
          if (dto.note !== undefined) existing.driverNote = dto.note;
          photo = await manager.save(existing);
        } else {
          photo = await manager.save(
            manager.create(InspectionPhoto, {
              inspectionId: inspection.id,
              shotId,
              position,
              storageKey,
              thumbKey,
              capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : null,
              uploadedAt: now,
              driverNote: dto.note ?? null,
              sha256: sha256!,
              retakeCount: 0,
            }),
          );
        }
      } else {
        photo = existing!;
        let changed = false;
        if (dto.note !== undefined && dto.note !== photo.driverNote) {
          photo.driverNote = dto.note;
          changed = true;
        }
        if (dto.capturedAt && !photo.capturedAt) {
          photo.capturedAt = new Date(dto.capturedAt);
          changed = true;
        }
        if (changed) photo = await manager.save(photo);
      }

      if (dto.odometerMiles !== undefined) {
        inspection.odometerMiles = dto.odometerMiles;
      }
      if (dto.fuelLevel !== undefined) inspection.fuelLevel = dto.fuelLevel;
      if (storesFile && inspection.startedAt === null) {
        inspection.startedAt = now;
      }
      if (
        storesFile &&
        (inspection.status === InspectionStatus.linkSent ||
          inspection.status === InspectionStatus.opened)
      ) {
        inspection.status = InspectionStatus.inProgress;
      }
      await manager.save(inspection);
      if (storesFile) {
        await this.logEvent(manager, inspection.id, "photo_uploaded", {
          shotId,
          position,
          retake: existing !== null,
        });
      }
      return { photo, storesFile };
    });

    return {
      shotId,
      position,
      stored: result.storesFile,
      retakeCount: result.photo.retakeCount,
      sha256: result.photo.sha256,
      thumbUrl: await this.presign(result.photo.thumbKey),
    };
  }

  // ----------------------------------------------------------------- submit

  /**
   * Closes the inspection: needs all required photos, the mileage and the fuel level, and the box checked. Sets `submitted`, which
   * also ends the link. Submitting again an inspection that is already submitted returns the same answer (a retry after a lost
   * response is not an error).
   * @throws GoneException unknown, expired or revoked link.
   * @throws BadRequestException a required photo or a reading is missing.
   */
  async submit(
    token: string,
    dto: SubmitInspectionDto,
  ): Promise<SubmittedInspectionDto> {
    const found = await this.findByToken(this.dataSource.manager, token);
    if (!found) throw new GoneException(EXPIRED_MESSAGE);
    if (
      (SUBMITTED_INSPECTION_STATUSES as readonly InspectionStatus[]).includes(
        found.status,
      )
    ) {
      return { reference: found.reference, submittedAt: found.submittedAt! };
    }

    const submitted = await this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockOpen(manager, found.id);
      const required = await manager.findBy(InspectionShot, { required: true });
      const have = new Set(
        (
          await manager.find(InspectionPhoto, {
            where: { inspectionId: inspection.id },
            select: { shotId: true },
          })
        ).map((p) => p.shotId),
      );
      const missing = required
        .sort((a, b) => a.position - b.position)
        .filter((shot) => !have.has(shot.shotId))
        .map((shot) => shot.shotId);
      if (missing.length > 0) {
        throw new BadRequestException({
          message: `Some required photos are missing (${missing.length}).`,
          missing,
        });
      }
      if (inspection.odometerMiles === null) {
        throw new BadRequestException("The mileage has not been entered.");
      }
      if (inspection.fuelLevel === null) {
        throw new BadRequestException("The fuel level has not been chosen.");
      }
      const now = this.now();
      inspection.status = InspectionStatus.submitted;
      inspection.submittedAt = now;
      inspection.attestedAt = now;
      // Location counts only as a pair.
      if (dto.gpsLat !== undefined && dto.gpsLng !== undefined) {
        inspection.gpsLat = dto.gpsLat;
        inspection.gpsLng = dto.gpsLng;
      }
      inspection.deviceInfo = dto.deviceInfo ?? null;
      await manager.save(inspection);
      await this.logEvent(manager, inspection.id, "submitted", {
        photos: have.size,
      });
      return inspection;
    });
    this.logger.log(`${submitted.reference} was submitted by the driver.`);
    return {
      reference: submitted.reference,
      submittedAt: submitted.submittedAt!,
    };
  }

  // --------------------------------------------------------------- language

  /**
   * Saves the driver's language choice on the driver record (so texts go out in it too).
   * @throws GoneException unknown, expired or revoked link. @throws ConflictException already submitted.
   */
  async setLanguage(
    token: string,
    language: DriverLanguage,
  ): Promise<SetLanguageDto> {
    const found = await this.findByToken(this.dataSource.manager, token);
    if (!found) throw new GoneException(EXPIRED_MESSAGE);
    await this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockOpen(manager, found.id);
      await manager.update(
        Driver,
        { id: inspection.driverId },
        {
          preferredLanguage: language,
        },
      );
      await this.logEvent(manager, inspection.id, "language_changed", {
        language,
      });
    });
    return { language };
  }

  // ---------------------------------------------------------------- helpers

  /** The inspection a token opens, or null for a token that does not look like ours or matches nothing. */
  private async findByToken(
    manager: EntityManager,
    token: string,
  ): Promise<Inspection | null> {
    if (!looksLikeToken(token)) return null;
    return manager.findOneBy(Inspection, { tokenHash: hashToken(token) });
  }

  /**
   * Locks the inspection row and checks again, with the fresh row, that the link still works: an admin revoking it or the
   * driver submitting from a second tab a moment ago is seen here. The lock also runs two requests for one inspection one
   * after the other.
   */
  private async lockOpen(
    manager: EntityManager,
    id: string,
  ): Promise<Inspection> {
    const inspection = await manager.findOneOrFail(Inspection, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (
      (SUBMITTED_INSPECTION_STATUSES as readonly InspectionStatus[]).includes(
        inspection.status,
      )
    ) {
      throw new ConflictException("These photos were already submitted.");
    }
    if (!linkWorks(inspection, this.now())) {
      throw new GoneException(EXPIRED_MESSAGE);
    }
    return inspection;
  }

  /** The first read of an open link: `link_sent` becomes `opened`. A plain conditional update, so no lock and no double event. */
  private async markOpened(inspection: Inspection, now: Date): Promise<void> {
    if (inspection.status !== InspectionStatus.linkSent) return;
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.update(
        Inspection,
        { id: inspection.id, status: InspectionStatus.linkSent },
        { status: InspectionStatus.opened, openedAt: now },
      );
      if (result.affected)
        await this.logEvent(manager, inspection.id, "opened", null);
    });
  }

  private emptyState(state: CaptureStateDto["state"]): CaptureStateDto {
    return {
      state,
      reference: null,
      type: null,
      language: null,
      vehicle: null,
      shots: [],
      photos: [],
      odometerMiles: null,
      fuelLevel: null,
      priorDamage: [],
      maxDamagePhotos: MAX_DAMAGE_PHOTOS,
      expiresAt: null,
      submittedAt: null,
      supportPhone: this.config.get<string>("INSPECTION_SUPPORT_PHONE") || null,
    };
  }

  /** The damage close-ups of the paired check-in (for a check-out), in the order they were taken. */
  private async priorDamage(inspection: Inspection): Promise<PriorDamageDto[]> {
    if (!inspection.pairedInspectionId) return [];
    const photos = await this.dataSource.getRepository(InspectionPhoto).find({
      where: {
        inspectionId: inspection.pairedInspectionId,
        shotId: DAMAGE_SHOT_ID,
      },
      order: { position: "ASC" },
    });
    return Promise.all(
      photos.map(async (p) => ({
        note: p.driverNote,
        thumbUrl: await this.presign(p.thumbKey),
      })),
    );
  }

  private async photoDto(photo: InspectionPhoto): Promise<CapturePhotoDto> {
    return {
      shotId: photo.shotId,
      position: photo.position,
      note: photo.driverNote,
      thumbUrl: await this.presign(photo.thumbKey),
    };
  }

  private presign(key: string): Promise<string | null> {
    return this.storage
      ? this.storage.presignGet(key, FILE_LINK_SECONDS)
      : Promise.resolve(null);
  }

  private logEvent(
    manager: EntityManager,
    inspectionId: string,
    type: InspectionEventType,
    meta: Record<string, unknown> | null,
  ): Promise<unknown> {
    return manager.save(
      manager.create(InspectionEvent, {
        inspectionId,
        type,
        actorId: null,
        meta,
      }),
    );
  }
}

/**
 * A 400 px JPEG thumbnail of a photo, made on the server (D103). `rotate()` applies the phone's orientation note so the
 * thumbnail stands upright. A file `sharp` cannot decode is not a picture, however it started.
 */
async function makeThumbnail(body: Buffer): Promise<Buffer> {
  try {
    return await sharp(body)
      .rotate()
      .resize({ width: THUMB_WIDTH, height: THUMB_WIDTH, fit: "inside" })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (error) {
    // Kept as the cause: the driver gets one plain sentence, the log keeps what sharp said.
    throw new BadRequestException("The photo could not be read as a picture.", {
      cause: error,
    });
  }
}
