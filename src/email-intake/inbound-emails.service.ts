import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Payment } from "../payments/payment.entity.js";
import {
  InboundEmailDto,
  InboundEmailListDto,
} from "./dto/inbound-email.dto.js";
import { ListInboundEmailsQueryDto } from "./dto/list-inbound-emails-query.dto.js";
import { InboundEmail } from "./inbound-email.entity.js";

/** Reads the email log for the admin screens. Rows are written only by `EmailIntakeService`. */
@Injectable()
export class InboundEmailsService {
  constructor(
    @InjectRepository(InboundEmail)
    private readonly emails: Repository<InboundEmail>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
  ) {}

  /** One page of processed emails, newest first, optionally filtered by status and provider. */
  async list(query: ListInboundEmailsQueryDto): Promise<InboundEmailListDto> {
    const [rows, total] = await this.emails.findAndCount({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.provider && { provider: query.provider }),
      },
      order: { receivedAt: "DESC", id: "DESC" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    // The link lives on the payment (`external_id` = the email's id, D47): one query for the whole page.
    const linked =
      rows.length === 0
        ? []
        : await this.payments.find({
            select: { id: true, externalId: true },
            where: { externalId: In(rows.map((row) => row.id)) },
          });
    const paymentByEmail = new Map(linked.map((p) => [p.externalId, p.id]));

    return {
      items: rows.map((row) => this.toDto(row, paymentByEmail.get(row.id))),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Copies the response fields from the entity, field by field (never the body). */
  private toDto(email: InboundEmail, paymentId?: string): InboundEmailDto {
    return {
      id: email.id,
      receivedAt: email.receivedAt,
      fromAddress: email.fromAddress,
      subject: email.subject,
      provider: email.provider,
      status: email.status,
      statusReason: email.statusReason,
      authDkimPass: email.authDkimPass,
      authDkimDomain: email.authDkimDomain,
      imapUid: email.imapUid,
      paymentId: paymentId ?? null,
    };
  }
}
