import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { recordAudit } from "../audit/record-audit.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import {
  CreateLedgerEntryDto,
  LedgerEntryDto,
} from "../ledger/dto/ledger-entry.dto.js";
import {
  LedgerDirection,
  LedgerEntryKind,
} from "../ledger/ledger-entry.entity.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { ledgerRef } from "../ledger/ledger-ref.js";
import {
  ComparePairDto,
  CreateDamageItemDto,
  DamageItemDto,
  InspectionCompareDto,
  InspectionPhotoDto,
} from "./dto/inspection.dto.js";
import { DamageItem, DamageItemStatus } from "./damage-item.entity.js";
import { fuelChangeEighths, milesDriven } from "./inspection-compare.js";
import { InspectionEvent } from "./inspection-event.entity.js";
import type { InspectionEventType } from "./inspection-event.entity.js";
import { DAMAGE_SHOT_ID, InspectionPhoto } from "./inspection-photo.entity.js";
import { InspectionShotAnswer } from "./inspection-shot-answer.entity.js";
import { InspectionShot } from "./inspection-shot.entity.js";
import {
  Inspection,
  InspectionStatus,
  InspectionType,
  SUBMITTED_INSPECTION_STATUSES,
} from "./inspection.entity.js";
import { InspectionsService } from "./inspections.service.js";

/** True once the driver has submitted (submitted, reviewed or flagged). */
function isSubmitted(inspection: Inspection): boolean {
  return (
    SUBMITTED_INSPECTION_STATUSES as readonly InspectionStatus[]
  ).includes(inspection.status);
}

/** A row of the damage query, before it becomes a `DamageItemDto`. */
interface DamageRow {
  id: string;
  inspectionId: string;
  photoId: string;
  shotId: string;
  parentShotId: string | null;
  description: string;
  status: DamageItemStatus;
  ledgerEntryId: string | null;
  entryKind: LedgerEntryKind | null;
  entryDirection: LedgerDirection | null;
  entryNo: string | null;
  amountCents: number | null;
  createdByEmail: string | null;
  createdAt: Date;
}

/**
 * Comparing a check-out with its check-in, marking new damage, and charging it (Module 3 chat 2, step 3, D110).
 *
 * Express comparison: another service behind the same kind of router. The money part does not re-implement the ledger: it calls
 * `LedgerService.addManualEntry`, the same code the "New charge" button on the ledger page uses, so the amount limit, the date
 * window, the audit line and the repeat-safe `requestKey` all stay in one place.
 */
@Injectable()
export class InspectionDamageService {
  private readonly logger = new Logger(InspectionDamageService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly inspections: InspectionsService,
    private readonly ledger: LedgerService,
  ) {}

  // ----------------------------------------------------------------- compare

  /**
   * The check-out beside its check-in: the shots in pairs, each with both sides' damage answers and close-ups (D112), miles
   * driven and fuel change (only when both were typed, before D112), old free-standing damage photos, and the damage items marked
   * so far. When nothing can be compared, `available` is false and `reason` says why (so the page can show
   * the words instead of an error).
   * @throws NotFoundException unknown inspection.
   */
  async compare(id: string): Promise<InspectionCompareDto> {
    const checkOut = await this.dataSource
      .getRepository(Inspection)
      .findOneBy({ id });
    if (!checkOut) throw new NotFoundException("Inspection not found.");
    const checkOutDto = await this.inspections.dtoOfWithCounts(checkOut);
    const unavailable = (reason: string): InspectionCompareDto => ({
      available: false,
      reason,
      checkOut: checkOutDto,
      checkIn: null,
      milesDriven: null,
      fuelChangeEighths: null,
      pairs: [],
      checkInDamage: [],
      checkOutDamage: [],
    });

    if (checkOut.type !== InspectionType.checkOut) {
      return unavailable("Only a check-out can be compared with a check-in.");
    }
    if (!isSubmitted(checkOut)) {
      return unavailable("The driver has not submitted this check-out yet.");
    }
    if (!checkOut.pairedInspectionId) {
      return unavailable(
        "No submitted check-in was found for this vehicle, so there is nothing to compare with.",
      );
    }
    const checkIn = await this.dataSource
      .getRepository(Inspection)
      .findOneBy({ id: checkOut.pairedInspectionId });
    if (!checkIn || !isSubmitted(checkIn)) {
      return unavailable("The paired check-in is not submitted.");
    }

    const answerRepo = this.dataSource.getRepository(InspectionShotAnswer);
    const [outPhotos, inPhotos, shots, items, outAnswers, inAnswers] =
      await Promise.all([
        this.inspections.photosOf(checkOut),
        this.inspections.photosOf(checkIn),
        this.dataSource
          .getRepository(InspectionShot)
          .find({ order: { position: "ASC" } }),
        this.itemsOf(this.dataSource.manager, { inspectionId: id }),
        answerRepo.findBy({ inspectionId: checkOut.id }),
        answerRepo.findBy({ inspectionId: checkIn.id }),
      ]);
    const itemByPhoto = new Map(items.map((item) => [item.photoId, item]));
    const answerOf = (answers: InspectionShotAnswer[], shotId: string) =>
      answers.find((a) => a.shotId === shotId)?.hasDamage ?? null;
    const isShot = (p: InspectionPhotoDto, shotId: string) =>
      p.shotId === shotId && p.parentShotId === null;
    const pairs: ComparePairDto[] = shots.map((shot) => {
      const out = outPhotos.find((p) => isShot(p, shot.shotId)) ?? null;
      return {
        shotId: shot.shotId,
        checkIn: inPhotos.find((p) => isShot(p, shot.shotId)) ?? null,
        checkOut: out,
        damageItem: out ? (itemByPhoto.get(out.id) ?? null) : null,
        checkInAnswer: answerOf(inAnswers, shot.shotId),
        checkOutAnswer: answerOf(outAnswers, shot.shotId),
        checkInCloseUps: inPhotos.filter((p) => p.parentShotId === shot.shotId),
        checkOutCloseUps: outPhotos
          .filter((p) => p.parentShotId === shot.shotId)
          .map((photo) => ({
            photo,
            damageItem: itemByPhoto.get(photo.id) ?? null,
          })),
      };
    });
    // A free-standing damage photo: an inspection made before D112.
    const isOldDamage = (p: InspectionPhotoDto) =>
      p.shotId === DAMAGE_SHOT_ID && p.parentShotId === null;
    return {
      available: true,
      reason: null,
      checkOut: checkOutDto,
      checkIn: await this.inspections.dtoOfWithCounts(checkIn),
      milesDriven: milesDriven(checkIn.odometerMiles, checkOut.odometerMiles),
      fuelChangeEighths: fuelChangeEighths(
        checkIn.fuelLevel,
        checkOut.fuelLevel,
      ),
      pairs,
      checkInDamage: inPhotos.filter(isOldDamage),
      checkOutDamage: outPhotos.filter(isOldDamage).map((photo) => ({
        photo,
        damageItem: itemByPhoto.get(photo.id) ?? null,
      })),
    };
  }

  // ---------------------------------------------------------- mark and unmark

  /**
   * "New damage" on one photo of a check-out: records the item and flags the inspection. Marking the same photo twice is refused
   * (the database allows one item per photo).
   * @throws NotFoundException unknown inspection, or the photo is not one of its photos.
   * @throws ConflictException not a submitted check-out with a paired check-in, or the photo is already marked.
   */
  async mark(
    inspectionId: string,
    body: CreateDamageItemDto,
    adminId: string,
  ): Promise<DamageItemDto> {
    try {
      const itemId = await this.dataSource.transaction(async (manager) => {
        const inspection = await this.lockInspection(manager, inspectionId);
        if (inspection.type !== InspectionType.checkOut) {
          throw new ConflictException(
            "Damage is marked on a check-out, compared with its check-in.",
          );
        }
        if (!isSubmitted(inspection) || !inspection.pairedInspectionId) {
          throw new ConflictException(
            "Only a submitted check-out with a check-in to compare with can be marked.",
          );
        }
        const photo = await manager.findOneBy(InspectionPhoto, {
          id: body.photoId,
          inspectionId,
        });
        if (!photo) {
          throw new NotFoundException("That photo is not on this inspection.");
        }
        const item = await manager.save(
          manager.create(DamageItem, {
            inspectionId,
            photoId: photo.id,
            description: body.description,
            status: DamageItemStatus.newDuringRental,
            ledgerEntryId: null,
            createdById: adminId,
          }),
        );
        const before = inspection.status;
        // The inspection now needs a second look; `reviewedAt` stays, so un-marking can go back to "reviewed".
        inspection.status = InspectionStatus.flagged;
        await manager.save(inspection);
        await this.logEvent(manager, inspectionId, "damage_marked", adminId, {
          shotId: photo.shotId,
          description: body.description,
        });
        await recordAudit(manager, [
          {
            actorId: adminId,
            action: "damage_item.mark",
            entityType: "damage_item",
            entityId: item.id,
            after: {
              inspectionId,
              photoId: photo.id,
              shotId: photo.shotId,
              description: body.description,
              inspectionStatusBefore: before,
            },
          },
        ]);
        return item.id;
      });
      this.logger.log(
        `Admin ${adminId} marked new damage on inspection ${inspectionId}.`,
      );
      return await this.itemDto(itemId);
    } catch (error) {
      if (isUniqueViolation(error, "damage_items_photo_unique")) {
        throw new ConflictException("This photo is already marked as damage.");
      }
      throw error;
    }
  }

  /**
   * Back to "No change": removes a damage item that has not been charged. When it was the last one on a flagged check-out, the
   * inspection goes back to reviewed (if it had been) or submitted.
   * @throws NotFoundException unknown item.
   * @throws ConflictException the item was already charged (the charge stays on the ledger).
   */
  async unmark(itemId: string, adminId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const found = await manager.findOneBy(DamageItem, { id: itemId });
      if (!found) throw new NotFoundException("Damage item not found.");
      // Lock order everywhere: the inspection first, then its item.
      const inspection = await this.lockInspection(manager, found.inspectionId);
      const item = await manager.findOne(DamageItem, {
        where: { id: itemId },
        lock: { mode: "pessimistic_write" },
      });
      if (!item) throw new NotFoundException("Damage item not found.");
      if (item.status === DamageItemStatus.charged) {
        throw new ConflictException(
          "This damage was already charged to the driver, so it cannot be removed.",
        );
      }
      await manager.delete(DamageItem, { id: itemId });
      const left = await manager.countBy(DamageItem, {
        inspectionId: inspection.id,
      });
      if (left === 0 && inspection.status === InspectionStatus.flagged) {
        inspection.status = inspection.reviewedAt
          ? InspectionStatus.reviewed
          : InspectionStatus.submitted;
        await manager.save(inspection);
      }
      await this.logEvent(manager, inspection.id, "damage_cleared", adminId, {
        description: item.description,
      });
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "damage_item.unmark",
          entityType: "damage_item",
          entityId: itemId,
          before: {
            inspectionId: inspection.id,
            photoId: item.photoId,
            description: item.description,
          },
        },
      ]);
    });
    this.logger.log(`Admin ${adminId} cleared damage item ${itemId}.`);
  }

  // ------------------------------------------------------------------ charge

  /**
   * Charges the driver for a damage item: ONE debit on the ledger, made by the existing manual-entry code, then the item is
   * linked to it and becomes `charged`. The item row is locked for the whole call, so two admins pressing "Create charge"
   * together make one charge (the second waits, then finds it charged). A repeat with the same `requestKey` returns the same
   * ledger entry; a different key on an already charged item is refused.
   * @throws NotFoundException unknown item.
   * @throws BadRequestException not a charge (`direction` must be `debit`), or the ledger refused the amount or date.
   * @throws ConflictException the item was already charged.
   */
  async charge(
    itemId: string,
    body: CreateLedgerEntryDto,
    adminId: string,
  ): Promise<{ item: DamageItemDto; entry: LedgerEntryDto }> {
    if (body.direction !== LedgerDirection.debit) {
      throw new BadRequestException("Damage is charged as a debit.");
    }
    const entry = await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(DamageItem, {
        where: { id: itemId },
        lock: { mode: "pessimistic_write" },
      });
      if (!item) throw new NotFoundException("Damage item not found.");
      const inspection = await manager.findOneByOrFail(Inspection, {
        id: item.inspectionId,
      });

      if (item.status === DamageItemStatus.charged) {
        const [existing] = (await manager.query(
          `SELECT idempotency_key AS "key", kind, direction, entry_no AS "entryNo"
           FROM ledger_entries WHERE id = $1`,
          [item.ledgerEntryId],
        )) as {
          key: string;
          kind: LedgerEntryKind;
          direction: LedgerDirection;
          entryNo: string;
        }[];
        if (existing?.key === `manual:${body.requestKey}`) {
          // The same request again (a double click or a retry): the same entry, nothing new.
          return this.ledger.addManualEntry(inspection.driverId, body, adminId);
        }
        throw new ConflictException(
          `This damage was already charged (${ledgerRef(existing.kind, existing.direction, Number(existing.entryNo))}).`,
        );
      }

      // The ledger runs in its own transaction; our row lock only makes sure no second charge starts for this item. If a later
      // step fails, the entry exists but is not linked: pressing the button again (same key) links it, never charging twice.
      const created = await this.ledger.addManualEntry(
        inspection.driverId,
        body,
        adminId,
      );
      item.status = DamageItemStatus.charged;
      item.ledgerEntryId = created.id;
      await manager.save(item);
      await this.logEvent(manager, inspection.id, "damage_charged", adminId, {
        ledgerRef: created.ref,
        amountCents: created.amountCents,
        description: item.description,
      });
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "damage_item.charge",
          entityType: "damage_item",
          entityId: item.id,
          after: {
            ledgerEntryId: created.id,
            ledgerRef: created.ref,
            amountCents: created.amountCents,
          },
        },
      ]);
      return created;
    });
    this.logger.log(
      `Admin ${adminId} charged damage item ${itemId} (${entry.ref}).`,
    );
    return { item: await this.itemDto(itemId), entry };
  }

  // ----------------------------------------------------------------- helpers

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

  private async itemDto(itemId: string): Promise<DamageItemDto> {
    const [item] = await this.itemsOf(this.dataSource.manager, { itemId });
    if (!item) throw new NotFoundException("Damage item not found.");
    return item;
  }

  /** Damage items with the photo's shot, the charge they led to and who marked them, oldest first. */
  private async itemsOf(
    manager: EntityManager,
    filter: { inspectionId?: string; itemId?: string },
  ): Promise<DamageItemDto[]> {
    const rows = (await manager.query(
      `SELECT d.id, d.inspection_id AS "inspectionId", d.photo_id AS "photoId", p.shot_id AS "shotId",
              p.parent_shot_id AS "parentShotId",
              d.description, d.status, d.ledger_entry_id AS "ledgerEntryId",
              le.kind AS "entryKind", le.direction AS "entryDirection", le.entry_no AS "entryNo",
              le.amount_cents AS "amountCents", u.email AS "createdByEmail", d.created_at AS "createdAt"
       FROM damage_items d
       JOIN inspection_photos p ON p.id = d.photo_id
       LEFT JOIN ledger_entries le ON le.id = d.ledger_entry_id
       LEFT JOIN users u ON u.id = d.created_by_id
       WHERE ($1::uuid IS NULL OR d.inspection_id = $1) AND ($2::uuid IS NULL OR d.id = $2)
       ORDER BY d.created_at ASC, d.id ASC`,
      [filter.inspectionId ?? null, filter.itemId ?? null],
    )) as DamageRow[];
    return rows.map((row) => ({
      id: row.id,
      inspectionId: row.inspectionId,
      photoId: row.photoId,
      shotId: row.shotId,
      parentShotId: row.parentShotId,
      source:
        row.shotId === DAMAGE_SHOT_ID ? "driver_reported" : "staff_flagged",
      description: row.description,
      status: row.status,
      ledgerEntryId: row.ledgerEntryId,
      ledgerRef:
        row.entryNo === null
          ? null
          : ledgerRef(row.entryKind!, row.entryDirection!, Number(row.entryNo)),
      amountCents: row.amountCents,
      createdByEmail: row.createdByEmail,
      createdAt: row.createdAt,
    }));
  }
}
