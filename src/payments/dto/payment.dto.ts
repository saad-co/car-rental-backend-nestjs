import { PaymentSource, PaymentStatus } from "../payment.entity.js";

/** A payment as the admin screens see it. */
export class PaymentDto {
  id: string;
  source: PaymentSource;
  status: PaymentStatus;
  /** Integer cents. The frontend formats it; never a float. */
  amountCents: number;
  /** The payer's name exactly as the provider wrote it. */
  senderName: string;
  senderHandle: string | null;
  /** The provider's transaction id, when the email showed one. */
  transactionId: string | null;
  /** When the payment happened (exact time from the email, or when the email arrived). */
  occurredAt: Date;
  /** How sure the AI was, 0 to 1. Null for sources without AI. */
  extractionConfidence: number | null;
  /** The record it came from; for email sources, the id of the inbound email. */
  externalId: string;
  createdAt: Date;
}

/** One page of payments, most recent payment first. */
export class PaymentListDto {
  items: PaymentDto[];
  /** Number of payments matching the filters, across all pages. */
  total: number;
  page: number;
  limit: number;
}
