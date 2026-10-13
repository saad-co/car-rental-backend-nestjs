import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, IsNull, Not, type FindOptionsWhere } from "typeorm";
import { normalizeAliasValue } from "../aliases/normalize-alias.js";
import { AliasSource, PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Driver } from "../drivers/driver.entity.js";
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
  constructor(private readonly dataSource: DataSource) {}

  /** One page of payments, most recent first, filtered by status, source and match state. */
  async list(query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    const where: FindOptionsWhere<Payment> = {
      ...(query.status && { status: query.status }),
      ...(query.source && { source: query.source }),
      ...(query.match === "assigned" && { driverId: Not(IsNull()) }),
      // Looked at by matching and not placed. Payments not looked at yet are left out: they are seconds old.
      ...(query.match === "review" && {
        driverId: IsNull(),
        matchAttemptedAt: Not(IsNull()),
      }),
    };
    const [rows, total] = await this.dataSource
      .getRepository(Payment)
      .findAndCount({
        where,
        relations: { driver: true, suggestedDriver: true },
        // `id` breaks ties, so two payments with the same time never swap places between pages.
        order: { occurredAt: "DESC", id: "DESC" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
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
