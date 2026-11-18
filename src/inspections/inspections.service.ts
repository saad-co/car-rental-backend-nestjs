import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Not } from "typeorm";
import { recordAudit } from "../audit/record-audit.js";
import { chicagoDate } from "../common/chicago-date.js";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import { Contract, ContractStatus } from "../contracts/contract.entity.js";
import {
  FILE_LINK_SECONDS,
  type FileStorage,
} from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Driver } from "../drivers/driver.entity.js";
import { SettingsService } from "../settings/settings.service.js";
import { SmsContactKind } from "../sms/sms-contact.js";
import { SmsService } from "../sms/sms.service.js";
import {
  CreateInspectionDto,
  InspectionDetailDto,
  InspectionDto,
  InspectionEventDto,
  InspectionLinkDto,
  InspectionListDto,
  InspectionPhotoDto,
  InspectionVehicleDto,
  LatestInspectionsDto,
  ReviewInspectionDto,
  AddInspectionNoteDto,
  SendInspectionLinkDto,
} from "./dto/inspection.dto.js";
import {
  InspectionEvent,
  type InspectionEventType,
} from "./inspection-event.entity.js";
import { inspectionLinkText } from "./inspection-sms.js";
import {
  effectiveStatus,
  isOpen,
  needsAttention,
} from "./inspection-status.js";
import { hashToken, newToken } from "./inspection-token.js";
import { DAMAGE_SHOT_ID, InspectionPhoto } from "./inspection-photo.entity.js";
import { photoFileStem, sortPhotos } from "./inspection-photo-order.js";
import { InspectionShotAnswer } from "./inspection-shot-answer.entity.js";
import { InspectionShot } from "./inspection-shot.entity.js";
import {
  Inspection,
  InspectionStatus,
  InspectionType,
  OPEN_INSPECTION_STATUSES,
  SUBMITTED_INSPECTION_STATUSES,
} from "./inspection.entity.js";

const HOUR_MS = 3_600_000;

/**
 * Vehicle check-in / check-out inspections, staff side (Module 3, D102): make one for a driver, send or copy its link, revoke it.
 * The driver's side (the public capture page) is `InspectionCaptureService`.
 *
 * Express comparison: this is the service behind a router mounted at `/drivers/:id/inspections` and `/inspections/:id`; the
 * controller only passes the request in. The database, not this code, is what stops two open inspections of the same type.
 */
@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  /** The clock; a property so a test can move time. */
  now = (): Date => new Date();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sms: SmsService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    // `null` when no bucket is set up (the photo links are then null); optional so a test can leave it out.
    @Optional()
    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage | null = null,
  ) {}

  // ----------------------------------------------------------------- reading

  /**
   * One page of a driver's inspections, newest first, with the vehicle the contract holds (so the page knows whether it must
   * ask for one). `id` breaks ties between inspections made in the same millisecond.
   * @throws NotFoundException unknown driver.
   */
  async list(
    driverId: string,
    query: PaginationQueryDto,
  ): Promise<InspectionListDto> {
    await this.assertDriverExists(this.dataSource.manager, driverId);
    const [rows, total] = await this.dataSource
      .getRepository(Inspection)
      .findAndCount({
        where: { driverId },
        order: { createdAt: "DESC", id: "DESC" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
    const counts = await this.photoCounts(rows.map((row) => row.id));
    const now = this.now();
    return {
      items: rows.map((row) => this.toDto(row, counts, now)),
      total,
      page: query.page,
      limit: query.limit,
      contractVehicle: await this.contractVehicle(
        this.dataSource.manager,
        driverId,
      ),
    };
  }

  /**
   * One inspection with its activity log, oldest line first.
   * @throws NotFoundException unknown inspection.
   */
  async findOne(id: string): Promise<InspectionDetailDto> {
    const inspection = await this.dataSource
      .getRepository(Inspection)
      .findOneBy({ id });
    if (!inspection) throw new NotFoundException("Inspection not found.");
    const counts = await this.photoCounts([id]);
    const answers = await this.dataSource
      .getRepository(InspectionShotAnswer)
      .findBy({ inspectionId: id });
    const events = (await this.dataSource.query(
      `SELECT e.id, e.type, u.email AS "actorEmail", e.meta, e.created_at AS "createdAt"
       FROM inspection_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.inspection_id = $1 ORDER BY e.created_at ASC, e.id ASC`,
      [id],
    )) as InspectionEventDto[];
    const reviewer = inspection.reviewedById
      ? ((await this.dataSource.query(`SELECT email FROM users WHERE id = $1`, [
          inspection.reviewedById,
        ])) as { email: string }[])
      : [];
    return Object.assign(this.toDto(inspection, counts, this.now()), {
      events,
      reviewedByEmail: reviewer[0]?.email ?? null,
      reviewNote: inspection.reviewNotes,
      gpsLat: inspection.gpsLat,
      gpsLng: inspection.gpsLng,
      deviceInfo: inspection.deviceInfo,
      attestedAt: inspection.attestedAt,
      photos: await this.photosOf(inspection),
      answers: answers.map((a) => ({
        shotId: a.shotId,
        hasDamage: a.hasDamage,
      })),
    });
  }

  /**
   * The photos of one inspection in viewing order, each with its signed links: the shots by their position, each followed by its
   * damage close-ups (D112), then any free-standing damage photos of an inspection made before D112. Storage keys never leave
   * the server.
   */
  async photosOf(inspection: Inspection): Promise<InspectionPhotoDto[]> {
    const [photos, shots] = await Promise.all([
      this.dataSource
        .getRepository(InspectionPhoto)
        .findBy({ inspectionId: inspection.id }),
      this.dataSource.getRepository(InspectionShot).find(),
    ]);
    const shotPosition = new Map(shots.map((s) => [s.shotId, s.position]));
    const ordered = sortPhotos(photos, shotPosition);
    return Promise.all(
      ordered.map(async (photo) => {
        const downloadName = `${inspection.reference}_${photoFileStem(photo, shotPosition)}.jpg`;
        return {
          id: photo.id,
          shotId: photo.shotId,
          parentShotId: photo.parentShotId,
          position: photo.position,
          driverNote: photo.driverNote,
          capturedAt: photo.capturedAt,
          uploadedAt: photo.uploadedAt,
          retakeCount: photo.retakeCount,
          sha256: photo.sha256,
          thumbUrl: await this.presign(photo.thumbKey),
          fullUrl: await this.presign(photo.storageKey),
          downloadUrl: await this.presign(photo.storageKey, { downloadName }),
        };
      }),
    );
  }

  /** A short-lived link to a file in the bucket, or null when there is no bucket. */
  private presign(
    key: string,
    options?: { downloadName?: string },
  ): Promise<string | null> {
    return this.storage
      ? this.storage.presignGet(key, FILE_LINK_SECONDS, options)
      : Promise.resolve(null);
  }

  // ---------------------------------------------------------------- creating

  /**
   * Makes an inspection for a driver, or returns the open one of the same type (one open inspection of each type per
   * driver; two admins pressing the button together get the same one, because the database refuses a second).
   * The vehicle is copied from the driver's latest signed contract; with none, the admin types it (`vehicle`). No link exists
   * yet: `send` or `reissue` makes it.
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException no vehicle to copy and none typed, or one typed although the contract has a vehicle.
   */
  async create(
    driverId: string,
    dto: CreateInspectionDto,
    adminId: string,
  ): Promise<InspectionDto> {
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        await this.assertDriverExists(manager, driverId);
        const open = await this.findOpen(manager, driverId, dto.type);
        if (open) return open;

        const vehicle = await this.chooseVehicle(manager, driverId, dto);
        const now = this.now();
        const [{ n }] = (await manager.query(
          `SELECT nextval('inspection_reference_seq') AS n`,
        )) as [{ n: string }];
        const reference = `INS-${chicagoDate(now).slice(0, 4)}-${n.padStart(6, "0")}`;
        // Nobody holds this link: its token is thrown away at once and its time is already up. `send` or `reissue` makes
        // the real one.
        const unusedToken = newToken();
        const inspection = await manager.save(
          manager.create(Inspection, {
            reference,
            type: dto.type,
            status: InspectionStatus.created,
            driverId,
            contractId: vehicle.contractId,
            vehicleModel: vehicle.model,
            vehicleVin: vehicle.vin,
            vehiclePlate: vehicle.plate,
            pairedInspectionId:
              dto.type === InspectionType.checkOut
                ? await this.latestSubmittedCheckIn(
                    manager,
                    driverId,
                    vehicle.contractId,
                  )
                : null,
            tokenHash: hashToken(unusedToken),
            tokenExpiresAt: now,
            createdById: adminId,
          }),
        );
        await this.logEvent(manager, inspection.id, "created", adminId, {
          type: dto.type,
        });
        await recordAudit(manager, [
          {
            actorId: adminId,
            action: "inspection.create",
            entityType: "inspection",
            entityId: inspection.id,
            after: {
              reference,
              type: dto.type,
              driverId,
              contractId: vehicle.contractId,
            },
          },
        ]);
        return inspection;
      });
      this.logger.log(
        `Admin ${adminId} made ${created.reference} (${created.type}) for driver ${driverId}.`,
      );
      return await this.dtoOfWithCounts(created);
    } catch (error) {
      // Two admins at once: the other one's inspection won the race, so return it.
      if (isUniqueViolation(error, "inspections_one_open_per_type")) {
        const open = await this.findOpen(
          this.dataSource.manager,
          driverId,
          dto.type,
        );
        if (open) return this.dtoOfWithCounts(open);
      }
      throw error;
    }
  }

  // ----------------------------------------------------------------- the link

  /**
   * Texts the driver a link to the inspection, in the driver's language, through the Quo chat (so `dry_run` only saves the text
   * and `off` refuses). Every send makes a **fresh token** (the old link stops working; the photos already taken stay and the new
   * link resumes): only the token's hash is stored, so an earlier link cannot be sent again (D102, D103).
   *
   * The new token is saved first and the text goes out second, so a text never carries a link that does not work. If the text
   * fails, the admin gets the reason and can press send again; the failed text stays in the chat.
   * @throws NotFoundException unknown inspection.
   * @throws ConflictException already submitted or revoked, or the driver texted STOP.
   */
  async send(id: string, adminId: string): Promise<SendInspectionLinkDto> {
    const { inspection, driver, link } = await this.issueLink(
      id,
      adminId,
      "send",
      true,
    );
    const text = inspectionLinkText({
      type: inspection.type,
      language: driver.preferredLanguage,
      firstName: driver.firstName,
      vehicle: inspection.vehicleModel,
      plate: inspection.vehiclePlate,
      link,
    });
    const message = await this.sms.send(
      SmsContactKind.drivers,
      driver.id,
      text,
      adminId,
    );
    const sent = await this.dataSource.transaction(async (manager) => {
      const now = this.now();
      const row = await this.lockInspection(manager, id);
      if (row.status === InspectionStatus.created) {
        row.status = InspectionStatus.linkSent;
      }
      row.linkSentAt = now;
      await manager.save(row);
      await this.logEvent(manager, id, "link_sent", adminId, {
        textMode: message.mode,
        textStatus: message.status,
        smsMessageId: message.id,
      });
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "inspection.send",
          entityType: "inspection",
          entityId: id,
          after: { textMode: message.mode, textStatus: message.status },
        },
      ]);
      return row;
    });
    this.logger.log(
      `Admin ${adminId} sent the link of ${sent.reference} (text ${message.mode}/${message.status}).`,
    );
    return {
      inspection: await this.dtoOfWithCounts(sent),
      link,
      textMode: message.mode!,
      textStatus: message.status,
    };
  }

  /**
   * Makes a fresh link without texting it, for the admin to copy (the old link stops working). The answer holds the only
   * copy of the link.
   * @throws NotFoundException unknown inspection.
   * @throws ConflictException already submitted or revoked.
   */
  async reissue(id: string, adminId: string): Promise<InspectionLinkDto> {
    const { inspection, link } = await this.issueLink(
      id,
      adminId,
      "copy",
      false,
    );
    this.logger.log(
      `Admin ${adminId} made a new link for ${inspection.reference}.`,
    );
    return { inspection: await this.dtoOfWithCounts(inspection), link };
  }

  /**
   * Cancels an inspection: its link stops working for good and the driver's page says it is no longer active. Photos already
   * taken are kept. A new inspection of the same type can then be made.
   * @throws NotFoundException unknown inspection.
   * @throws ConflictException already submitted or already revoked.
   */
  async revoke(id: string, adminId: string): Promise<InspectionDto> {
    const revoked = await this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockInspection(manager, id);
      this.assertOpen(inspection);
      inspection.status = InspectionStatus.revoked;
      await manager.save(inspection);
      await this.logEvent(manager, id, "revoked", adminId, null);
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "inspection.revoke",
          entityType: "inspection",
          entityId: id,
          before: { status: "open" },
          after: { status: InspectionStatus.revoked },
        },
      ]);
      return inspection;
    });
    this.logger.log(`Admin ${adminId} revoked ${revoked.reference}.`);
    return this.dtoOfWithCounts(revoked);
  }

  // ------------------------------------------------------------ staff review

  /**
   * Marks a submitted (or flagged) inspection reviewed: who and when, with an optional note. The log and the audit trail get a
   * line in the same transaction. Nothing else changes: the photos and readings are evidence and stay as they were.
   * @throws NotFoundException unknown inspection.
   * @throws ConflictException not submitted yet, revoked, or already reviewed.
   */
  async review(
    id: string,
    body: ReviewInspectionDto,
    adminId: string,
  ): Promise<InspectionDto> {
    const note = body.note ?? null;
    const reviewed = await this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockInspection(manager, id);
      if (inspection.status === InspectionStatus.reviewed) {
        throw new ConflictException("This inspection was already reviewed.");
      }
      if (
        inspection.status !== InspectionStatus.submitted &&
        inspection.status !== InspectionStatus.flagged
      ) {
        throw new ConflictException(
          "Only a submitted inspection can be reviewed.",
        );
      }
      const before = inspection.status;
      inspection.status = InspectionStatus.reviewed;
      inspection.reviewedById = adminId;
      inspection.reviewedAt = this.now();
      inspection.reviewNotes = note;
      await manager.save(inspection);
      await this.logEvent(manager, id, "reviewed", adminId, { note });
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "inspection.review",
          entityType: "inspection",
          entityId: id,
          before: { status: before },
          after: { status: InspectionStatus.reviewed, note },
        },
      ]);
      return inspection;
    });
    this.logger.log(`Admin ${adminId} reviewed ${reviewed.reference}.`);
    return this.dtoOfWithCounts(reviewed);
  }

  /**
   * Adds a staff note to an inspection's activity log (a line of type `staff_note`). Allowed in any state: a note about a
   * revoked or unfinished inspection is still worth keeping.
   * @throws NotFoundException unknown inspection.
   */
  async addNote(
    id: string,
    body: AddInspectionNoteDto,
    adminId: string,
  ): Promise<InspectionEventDto> {
    const event = await this.dataSource.transaction(async (manager) => {
      await this.lockInspection(manager, id);
      const saved = await this.logEvent(manager, id, "staff_note", adminId, {
        text: body.text,
      });
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "inspection.note",
          entityType: "inspection",
          entityId: id,
          after: { text: body.text },
        },
      ]);
      return saved;
    });
    const [actor] = (await this.dataSource.query(
      `SELECT email FROM users WHERE id = $1`,
      [adminId],
    )) as { email: string }[];
    return {
      id: event.id,
      type: event.type,
      actorEmail: actor?.email ?? null,
      meta: event.meta,
      createdAt: event.createdAt,
    };
  }

  /**
   * The driver's latest check-in and latest check-out (revoked ones left out; the newest by the time they were made). The
   * summary card on the ledger page shows exactly these two.
   * @throws NotFoundException unknown driver.
   */
  async latest(driverId: string): Promise<LatestInspectionsDto> {
    await this.assertDriverExists(this.dataSource.manager, driverId);
    const latestOf = async (type: InspectionType) => {
      const row = await this.dataSource.getRepository(Inspection).findOne({
        where: { driverId, type, status: Not(InspectionStatus.revoked) },
        order: { createdAt: "DESC", id: "DESC" },
      });
      return row ? this.dtoOfWithCounts(row) : null;
    };
    return {
      checkIn: await latestOf(InspectionType.checkIn),
      checkOut: await latestOf(InspectionType.checkOut),
    };
  }

  // ----------------------------------------------------------------- helpers

  /**
   * Gives an open inspection a new token and a new expiry, in one transaction, and returns the plain link (the only time it
   * exists). A `created` inspection becomes `link_sent` once a link has been handed out, by text or by copy.
   */
  private async issueLink(
    id: string,
    adminId: string,
    reason: "send" | "copy",
    checkTexting: boolean,
  ): Promise<{ inspection: Inspection; driver: Driver; link: string }> {
    const hours = await this.settings.inspectionLinkHours();
    return this.dataSource.transaction(async (manager) => {
      const inspection = await this.lockInspection(manager, id);
      this.assertOpen(inspection);
      const driver = await manager.findOneByOrFail(Driver, {
        id: inspection.driverId,
      });
      if (checkTexting && driver.smsOptedOut) {
        throw new ConflictException(
          "This driver texted STOP, so no text can be sent to them. Copy the link instead.",
        );
      }
      const token = newToken();
      const now = this.now();
      inspection.tokenHash = hashToken(token);
      inspection.tokenExpiresAt = new Date(now.getTime() + hours * HOUR_MS);
      if (inspection.status === InspectionStatus.created) {
        inspection.status = InspectionStatus.linkSent;
      }
      await manager.save(inspection);
      await this.logEvent(manager, id, "link_issued", adminId, { reason });
      if (reason === "copy") {
        await recordAudit(manager, [
          {
            actorId: adminId,
            action: "inspection.reissue",
            entityType: "inspection",
            entityId: id,
            // Never the token or the link.
            after: { expiresAt: inspection.tokenExpiresAt.toISOString() },
          },
        ]);
      }
      return { inspection, driver, link: this.linkFor(token) };
    });
  }

  private linkFor(token: string): string {
    const base = this.config
      .getOrThrow<string>("WEB_APP_URL")
      .replace(/\/+$/, "");
    return `${base}/i/${token}`;
  }

  /** Refuses to change an inspection the driver can no longer use. */
  private assertOpen(inspection: Inspection): void {
    if (isOpen(inspection.status)) return;
    if (inspection.status === InspectionStatus.revoked) {
      throw new ConflictException(
        "This inspection was revoked. Make a new one to send a link.",
      );
    }
    throw new ConflictException("This inspection was already submitted.");
  }

  /** The inspection with a row lock, so two admin clicks on the same inspection run one after the other. */
  private async lockInspection(
    manager: EntityManager,
    id: string,
  ): Promise<Inspection> {
    const inspection = await manager.findOne(Inspection, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (!inspection) throw new NotFoundException("Inspection not found.");
    return inspection;
  }

  private findOpen(
    manager: EntityManager,
    driverId: string,
    type: InspectionType,
  ): Promise<Inspection | null> {
    return manager.findOneBy(Inspection, {
      driverId,
      type,
      status: In([...OPEN_INSPECTION_STATUSES]),
    });
  }

  /** The id of the driver's latest submitted check-in on the same contract (or none), for a check-out to be compared with. */
  private async latestSubmittedCheckIn(
    manager: EntityManager,
    driverId: string,
    contractId: string | null,
  ): Promise<string | null> {
    const query = manager
      .createQueryBuilder(Inspection, "i")
      .select("i.id", "id")
      .where("i.driver_id = :driverId", { driverId })
      .andWhere("i.type = :type", { type: InspectionType.checkIn })
      .andWhere("i.status IN (:...statuses)", {
        statuses: [...SUBMITTED_INSPECTION_STATUSES],
      })
      .orderBy("i.submitted_at", "DESC")
      .limit(1);
    query.andWhere(
      contractId ? "i.contract_id = :contractId" : "i.contract_id IS NULL",
      { contractId },
    );
    const row = await query.getRawOne<{ id: string }>();
    return row?.id ?? null;
  }

  /** The vehicle of the driver's latest signed contract, or null when there is none or it holds no vehicle. */
  private async contractVehicle(
    manager: EntityManager,
    driverId: string,
  ): Promise<InspectionVehicleDto | null> {
    const contract = await this.latestSignedContract(manager, driverId);
    return contract?.vehicleModel
      ? {
          model: contract.vehicleModel,
          vin: contract.vehicleVin,
          plate: contract.vehiclePlate,
        }
      : null;
  }

  private latestSignedContract(
    manager: EntityManager,
    driverId: string,
  ): Promise<Contract | null> {
    return manager.findOne(Contract, {
      where: { driverId, status: ContractStatus.signed },
      order: { signedAt: { direction: "DESC", nulls: "LAST" } },
    });
  }

  /** The vehicle for a new inspection: the contract's, or the typed one when there is none. */
  private async chooseVehicle(
    manager: EntityManager,
    driverId: string,
    dto: CreateInspectionDto,
  ): Promise<{
    contractId: string | null;
    model: string;
    vin: string | null;
    plate: string | null;
  }> {
    const contract = await this.latestSignedContract(manager, driverId);
    if (contract?.vehicleModel) {
      if (dto.vehicle) {
        throw new BadRequestException(
          "The vehicle comes from the driver's signed contract: leave it out.",
        );
      }
      return {
        contractId: contract.id,
        model: contract.vehicleModel,
        vin: contract.vehicleVin,
        plate: contract.vehiclePlate,
      };
    }
    if (!dto.vehicle) {
      throw new BadRequestException(
        "This driver has no signed contract with a vehicle. Type the vehicle (model, plate and VIN).",
      );
    }
    return {
      contractId: null,
      model: dto.vehicle.model,
      vin: dto.vehicle.vin ?? null,
      plate: dto.vehicle.plate ?? null,
    };
  }

  private async assertDriverExists(
    manager: EntityManager,
    driverId: string,
  ): Promise<void> {
    if (!(await manager.existsBy(Driver, { id: driverId }))) {
      throw new NotFoundException("Driver not found.");
    }
  }

  private logEvent(
    manager: EntityManager,
    inspectionId: string,
    type: InspectionEventType,
    actorId: string | null,
    meta: Record<string, unknown> | null,
  ): Promise<InspectionEvent> {
    return manager.save(
      manager.create(InspectionEvent, { inspectionId, type, actorId, meta }),
    );
  }

  /**
   * Photos received per inspection (required shots and damage close-ups, in one query for any number of inspections), and how
   * many shots are required (21 since D112).
   */
  private async photoCounts(inspectionIds: string[]): Promise<PhotoCounts> {
    const required = await this.dataSource
      .getRepository(InspectionShot)
      .countBy({ required: true });
    const counts: PhotoCounts = { byInspection: new Map(), required };
    if (inspectionIds.length === 0) return counts;
    const rows = (await this.dataSource.query(
      `SELECT inspection_id AS "inspectionId",
              COUNT(*) FILTER (WHERE shot_id <> $2)::int AS shots,
              COUNT(*) FILTER (WHERE shot_id = $2)::int AS damage
       FROM inspection_photos WHERE inspection_id = ANY($1::uuid[]) GROUP BY inspection_id`,
      [inspectionIds, DAMAGE_SHOT_ID],
    )) as { inspectionId: string; shots: number; damage: number }[];
    for (const row of rows) counts.byInspection.set(row.inspectionId, row);
    return counts;
  }

  async dtoOfWithCounts(inspection: Inspection): Promise<InspectionDto> {
    return this.toDto(
      inspection,
      await this.photoCounts([inspection.id]),
      this.now(),
    );
  }

  private toDto(
    inspection: Inspection,
    counts: PhotoCounts,
    now: Date,
  ): InspectionDto {
    const count = counts.byInspection.get(inspection.id);
    return {
      id: inspection.id,
      reference: inspection.reference,
      type: inspection.type,
      status: effectiveStatus(inspection, now),
      driverId: inspection.driverId,
      contractId: inspection.contractId,
      vehicle: {
        model: inspection.vehicleModel,
        vin: inspection.vehicleVin,
        plate: inspection.vehiclePlate,
      },
      pairedInspectionId: inspection.pairedInspectionId,
      tokenExpiresAt: inspection.tokenExpiresAt,
      linkSentAt: inspection.linkSentAt,
      openedAt: inspection.openedAt,
      startedAt: inspection.startedAt,
      submittedAt: inspection.submittedAt,
      odometerMiles: inspection.odometerMiles,
      fuelLevel: inspection.fuelLevel,
      photoCount: count?.shots ?? 0,
      requiredPhotoCount: counts.required,
      damagePhotoCount: count?.damage ?? 0,
      reviewedAt: inspection.reviewedAt,
      needsAttention: needsAttention(inspection, now),
      createdAt: inspection.createdAt,
    };
  }
}

/** What `photoCounts` answers. */
interface PhotoCounts {
  byInspection: Map<string, { shots: number; damage: number }>;
  required: number;
}
