import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Brackets, DataSource } from "typeorm";
import { normalizeAliasValue } from "../aliases/normalize-alias.js";
import { likePattern } from "../common/search.js";
import { AliasSource, PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { ALIAS_TYPE_BY_SOURCE } from "../matching/alias-index.js";
import { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import {
  AssignPaymentResultDto,
  PaymentDriverDto,
  PaymentDto,
  PaymentListDto,
} from "./dto/payment.dto.js";
import { MatchMethod, Payment, PaymentStatus } from "./payment.entity.js";

/** Statuses an admin may (re)assign from. Rejected and discrepancy payments need their own handling first. */
const ASSIGNABLE = [
  PaymentStatus.unmatched,
  PaymentStatus.reported,
  PaymentStatus.confirmed,
];

/** Reads payments for the admin screens, and lets an admin assign one to a driver. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * One page of payments, most recent first, filtered by status, source, driver and match state, and by a search
   * (B75): the payer's name and handle, and the assigned driver's first, last or full name (ILIKE, ignoring case).
   * Built like `ApplicationsService.list`; see there for the details.
   *
   * `leftJoinAndSelect` loads the driver and the suggested driver with the payment (a LEFT JOIN keeps payments
   * that have none). With joins, TypeORM pages by first picking the page's payment ids, so `take` counts payments,
   * not joined rows.
   */
  async list(query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    const builder = this.dataSource
      .getRepository(Payment)
      .createQueryBuilder("p")
      .leftJoinAndSelect("p.driver", "driver")
      .leftJoinAndSelect("p.suggestedDriver", "suggestedDriver")
      // `id` breaks ties, so two payments with the same time never swap places between pages.
      .orderBy("p.occurredAt", "DESC")
      .addOrderBy("p.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    if (query.status) {
      builder.andWhere("p.status = :status", { status: query.status });
    }
    if (query.source) {
      builder.andWhere("p.source = :source", { source: query.source });
    }
    if (query.driverId) {
      builder.andWhere("p.driverId = :driverId", { driverId: query.driverId });
    }
    if (query.match === "assigned") {
      builder.andWhere("p.driverId IS NOT NULL");
    }
    if (query.match === "review") {
      // Looked at by matching and not placed. Payments not looked at yet are left out: they are seconds old.
      builder.andWhere("p.driverId IS NULL AND p.matchAttemptedAt IS NOT NULL");
    }
    if (query.search) {
      builder.andWhere(
        new Brackets((match) => {
          match
            .where("p.sender_name ILIKE :pattern")
            .orWhere("p.sender_handle ILIKE :pattern")
            .orWhere(
              "(driver.first_name || ' ' || driver.last_name) ILIKE :pattern",
            );
        }),
        { pattern: likePattern(query.search) },
      );
    }
    const [rows, total] = await builder.getManyAndCount();
    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Assigns (or re-assigns) a payment to a driver by hand (spec 6.2): method `manual`, who did it, and the
   * status `confirmed` (one stage for every method, B56). The payer's name is saved as the driver's
   * alias so the next payment from them matches by itself, unless that alias already belongs to another
   * driver: it is then left alone and reported back (one alias, one driver; the admin decides).
   * The ledger credit follows the payment in the same transaction (D58).
   *
   * @throws NotFoundException unknown payment.
   * @throws BadRequestException unknown driver.
   * @throws ConflictException the payment is rejected or in discrepancy.
   */
  assign(
    paymentId: string,
    driverId: string,
    adminId: string,
  ): Promise<AssignPaymentResultDto> {
    return this.dataSource.transaction(async (manager) => {
      // Locked until the end of the transaction, so matching or a second admin cannot change it meanwhile.
      const payment = await manager.findOne(Payment, {
        where: { id: paymentId },
        lock: { mode: "pessimistic_write" },
      });
      if (!payment) throw new NotFoundException("Payment not found.");
      if (!ASSIGNABLE.includes(payment.status)) {
        throw new ConflictException(
          `A ${payment.status} payment cannot be assigned.`,
        );
      }
      const driver = await manager.findOneBy(Driver, { id: driverId });
      if (!driver) throw new BadRequestException("Driver not found.");

      await manager.update(Payment, payment.id, {
        driverId,
        suggestedDriverId: null,
        matchMethod: MatchMethod.manual,
        matchConfidence: null,
        matchExplanation: "Assigned by an admin",
        matchedById: adminId,
        matchAttemptedAt: new Date(),
        status: PaymentStatus.confirmed,
      });
      // Same transaction: the payment and its ledger credit change together or not at all. A reassignment
      // reverses the old driver's credit and credits the new one (D58).
      await this.ledger.syncPaymentCredit(manager, payment.id, adminId);

      let aliasSaved = false;
      let aliasOwnedBy: PaymentDriverDto | null = null;
      const type = ALIAS_TYPE_BY_SOURCE[payment.source];
      if (type) {
        const valueNormalized = normalizeAliasValue(type, payment.senderName);
        const existing = await manager.findOne(PaymentAlias, {
          where: { type, valueNormalized },
          relations: { driver: true },
        });
        if (!existing) {
          await manager.insert(PaymentAlias, {
            driverId,
            type,
            value: payment.senderName,
            valueNormalized,
            source: AliasSource.manual,
          });
          aliasSaved = true;
        } else if (existing.driverId !== driverId && existing.driver) {
          aliasOwnedBy = this.toDriverDto(existing.driver);
        }
      }

      const updated = await manager.findOneOrFail(Payment, {
        where: { id: payment.id },
        relations: { driver: true, suggestedDriver: true },
      });
      return { payment: this.toDto(updated), aliasSaved, aliasOwnedBy };
    });
  }

  /** Copies the response fields from the entity, field by field. */
  private toDto(payment: Payment): PaymentDto {
    return {
      id: payment.id,
      source: payment.source,
      status: payment.status,
      amountCents: payment.amountCents,
      senderName: payment.senderName,
      senderHandle: payment.senderHandle,
      transactionId: payment.transactionId,
      occurredAt: payment.occurredAt,
      extractionConfidence: payment.extractionConfidence,
      externalId: payment.externalId,
      driver: payment.driver ? this.toDriverDto(payment.driver) : null,
      suggestedDriver: payment.suggestedDriver
        ? this.toDriverDto(payment.suggestedDriver)
        : null,
      matchMethod: payment.matchMethod,
      matchConfidence: payment.matchConfidence,
      matchExplanation: payment.matchExplanation,
      createdAt: payment.createdAt,
    };
  }

  private toDriverDto(driver: Driver): PaymentDriverDto {
    return {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
    };
  }
}
