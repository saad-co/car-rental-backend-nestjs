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
import { DataSource, EntityManager, IsNull } from "typeorm";
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
  ShotAnswerDto,
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
  MAX_CLOSE_UPS_PER_SHOT,
} from "./inspection-photo.entity.js";
import { InspectionShotAnswer } from "./inspection-shot-answer.entity.js";
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
      order: { shotId: "ASC", parentShotId: "ASC", position: "ASC" },
    });
    const answers = await manager.find(InspectionShotAnswer, {
      where: { inspectionId: inspection.id },
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
      answers: answers.map((a): ShotAnswerDto => ({
        shotId: a.shotId,
        hasDamage: a.hasDamage,
      })),
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
   *
   * A damage close-up (D112) is `DAMAGE` with `parentShotId` (a required shot) and `position` 1 to 5. Storing one also records the
   * answer "yes, damage" for that shot, so the answer and the close-ups can never disagree, whatever order they arrive in.
   * @throws GoneException unknown, expired or revoked link. @throws ConflictException already submitted.
   * @throws BadRequestException unknown shot, not a JPEG, a reading on the wrong shot, a close-up without its shot, or no photo
   * yet for a note-only update.
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
    if (!isDamage && dto.parentShotId !== undefined) {
      throw new BadRequestException(
        "Only a damage close-up belongs to another shot.",
      );
    }
    if (isDamage && dto.parentShotId === undefined) {
      throw new BadRequestException(
        "A damage close-up needs the shot it belongs to (parentShotId).",
      );
    }
    // The shot the file is filed under: the shot itself, or the parent of a close-up.
    const shot = await this.dataSource
      .getRepository(InspectionShot)
      .findOneBy({ shotId: isDamage ? dto.parentShotId : shotId });
    if (!shot) throw new NotFoundException("Unknown shot.");
    const parentShotId = isDamage ? shot.shotId : null;
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
        parentShotId: parentShotId ?? IsNull(),
        position,
      });
      if (!file && !existing) {
        throw new BadRequestException("Send the photo first.");
      }
      const now = this.now();
      // `03_EXT_LEFT_MIRROR.jpg`, and its close-ups `03_EXT_LEFT_MIRROR_damage_1.jpg` to `_damage_5.jpg`.
      const base = `${String(shot.position).padStart(2, "0")}_${shot.shotId}`;
      const fileName = isDamage
        ? `${base}_damage_${position}.jpg`
        : `${base}.jpg`;
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
              parentShotId,
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
      if (parentShotId) {
        await this.saveAnswer(manager, inspection.id, parentShotId, true);
      }
      if (storesFile) {
        await this.logEvent(manager, inspection.id, "photo_uploaded", {
          shotId,
          ...(parentShotId ? { parentShotId } : {}),
          position,
          retake: existing !== null,
        });
      }
      return { photo, storesFile };
    });

    return {
      shotId,
      position,
      parentShotId,
      stored: result.storesFile,
      retakeCount: result.photo.retakeCount,
      sha256: result.photo.sha256,
      thumbUrl: await this.presign(result.photo.thumbKey),
    };
  }

  // ---------------------------------------------------------- damage answer

  /**
   * Records the driver's answer to "Is there any damage on the <shot>?" (D112). Safe to repeat. "No" is refused while that shot
   * has close-ups: the photos are evidence and the page has no way to delete them, so the answer must stay "yes".
   * @throws GoneException unknown, expired or revoked link. @throws ConflictException already submitted, or "no" with close-ups.
   * @throws NotFoundException not a required shot.
   */
  async answerDamage(
    token: string,
    shotId: string,
    hasDamage: boolean,
  ): Promise<ShotAnswerDto> {
    const shot = await this.dataSource
      .getRepository(InspectionShot)
      .findOneBy({ shotId });
    if (!shot) throw new NotFoundException("Unknown shot.");
    const found = await this.findByToken(this.dataSource.manager, token);
    if (!found) throw new GoneException(EXPIRED_MESSAGE);
    await this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockOpen(manager, found.id);
      if (!hasDamage) {
        const closeUps = await manager.countBy(InspectionPhoto, {
          inspectionId: inspection.id,
          shotId: DAMAGE_SHOT_ID,
          parentShotId: shotId,
        });
        if (closeUps > 0) {
          throw new ConflictException(
            "This shot already has damage photos, so the answer stays yes.",
          );
        }
      }
      await this.saveAnswer(manager, inspection.id, shotId, hasDamage);
    });
    return { shotId, hasDamage };
  }

  // ----------------------------------------------------------------- submit

  /**
   * Closes the inspection: needs, for every required shot, its photo and the damage answer, and for every "yes" at least one
   * close-up (D112); and the box checked. The mileage and fuel are read from their photos, so no typed reading is needed. Sets
   * `submitted`, which also ends the link. Submitting again an inspection that is already submitted returns the same answer (a
   * retry after a lost response is not an error).
   * @throws GoneException unknown, expired or revoked link.
   * @throws BadRequestException a photo, an answer or a close-up is missing (`missing` lists the shot ids).
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
      const required = (
        await manager.findBy(InspectionShot, { required: true })
      ).sort((a, b) => a.position - b.position);
      const photos = await manager.find(InspectionPhoto, {
        where: { inspectionId: inspection.id },
        select: { id: true, shotId: true, parentShotId: true },
      });
      const shotsWithPhoto = new Set(
        photos.filter((p) => p.parentShotId === null).map((p) => p.shotId),
      );
      const shotsWithCloseUp = new Set(
        photos.map((p) => p.parentShotId).filter((id) => id !== null),
      );
      const answers = new Map(
        (
          await manager.findBy(InspectionShotAnswer, {
            inspectionId: inspection.id,
          })
        ).map((a) => [a.shotId, a.hasDamage]),
      );
      const missingPhotos = required
        .filter((shot) => !shotsWithPhoto.has(shot.shotId))
        .map((shot) => shot.shotId);
      if (missingPhotos.length > 0) {
        throw new BadRequestException({
          message: `Some required photos are missing (${missingPhotos.length}).`,
          missing: missingPhotos,
        });
      }
      const unanswered = required
        .filter((shot) => !answers.has(shot.shotId))
        .map((shot) => shot.shotId);
      if (unanswered.length > 0) {
        throw new BadRequestException({
          message: `Some damage questions are not answered (${unanswered.length}).`,
          missing: unanswered,
        });
      }
      const yesWithoutPhoto = required
        .filter(
          (shot) =>
            answers.get(shot.shotId) === true &&
            !shotsWithCloseUp.has(shot.shotId),
        )
        .map((shot) => shot.shotId);
      if (yesWithoutPhoto.length > 0) {
        throw new BadRequestException({
          message: `Some shots with damage have no damage photo (${yesWithoutPhoto.length}).`,
          missing: yesWithoutPhoto,
        });
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
      // Every photo counts, close-ups included (B145: this used to count distinct shot ids, so all damage photos counted as one).
      await this.logEvent(manager, inspection.id, "submitted", {
        photos: photos.length,
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
      answers: [],
      odometerMiles: null,
      fuelLevel: null,
      priorDamage: [],
      maxCloseUpsPerShot: MAX_CLOSE_UPS_PER_SHOT,
      expiresAt: null,
      submittedAt: null,
      supportPhone: this.config.get<string>("INSPECTION_SUPPORT_PHONE") || null,
    };
  }

  /** The damage photos of the paired check-in (for a check-out), by shot and number; old free-standing ones have no shot. */
  private async priorDamage(inspection: Inspection): Promise<PriorDamageDto[]> {
    if (!inspection.pairedInspectionId) return [];
    const photos = await this.dataSource.getRepository(InspectionPhoto).find({
      where: {
        inspectionId: inspection.pairedInspectionId,
        shotId: DAMAGE_SHOT_ID,
      },
      order: { parentShotId: "ASC", position: "ASC" },
    });
    return Promise.all(
      photos.map(async (p) => ({
        parentShotId: p.parentShotId,
        note: p.driverNote,
        thumbUrl: await this.presign(p.thumbKey),
      })),
    );
  }

  /** Inserts or updates the answer for one shot (the primary key is the pair, so a repeat updates the same row). */
  private async saveAnswer(
    manager: EntityManager,
    inspectionId: string,
    shotId: string,
    hasDamage: boolean,
  ): Promise<void> {
    const before = await manager.findOneBy(InspectionShotAnswer, {
      inspectionId,
      shotId,
    });
    if (before?.hasDamage === hasDamage) return;
    await manager.upsert(
      InspectionShotAnswer,
      { inspectionId, shotId, hasDamage },
      { conflictPaths: ["inspectionId", "shotId"] },
    );
    await this.logEvent(manager, inspectionId, "damage_answered", {
      shotId,
      hasDamage,
    });
  }

  private async photoDto(photo: InspectionPhoto): Promise<CapturePhotoDto> {
    return {
      shotId: photo.shotId,
      position: photo.position,
      parentShotId: photo.parentShotId,
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
