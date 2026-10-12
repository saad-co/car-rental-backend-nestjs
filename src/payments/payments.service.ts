import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import { PaymentDto, PaymentListDto } from "./dto/payment.dto.js";
import { Payment } from "./payment.entity.js";

/** Reads payments for the admin screens. Payments are created by the email intake, not here. */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
  ) {}

  /** One page of payments, most recent payment first, optionally filtered by status and source. */
  async list(query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    const [rows, total] = await this.payments.findAndCount({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.source && { source: query.source }),
      },
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
      createdAt: payment.createdAt,
    };
  }
}
