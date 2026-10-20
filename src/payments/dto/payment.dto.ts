import { ApiProperty } from "@nestjs/swagger";
import {
  MatchMethod,
  PaymentManualMethod,
  PaymentSource,
  PaymentStatus,
} from "../payment.entity.js";

/** Just enough of a driver to show and link it. */
export class PaymentDriverDto {
  id: string;
  firstName: string;
  lastName: string;
}

/** A payment as the admin screens see it. */
export class PaymentDto {
  id: string;
  source: PaymentSource;
  status: PaymentStatus;
  /** For a payment an admin recorded by hand: how it was paid (cash, check, ...). Null for every other source. */
  @ApiProperty({
    enum: PaymentManualMethod,
    enumName: "PaymentManualMethod",
    nullable: true,
  })
  manualMethod: PaymentManualMethod | null;
  /** For a payment an admin recorded by hand: the text they gave for the driver's statement. */
  description: string | null;
  /** For a payment an admin recorded by hand: their staff-only note. */
  internalNote: string | null;
  /** Integer cents. The frontend formats it; never a float. */
  amountCents: number;
  /** The payer's name exactly as the provider wrote it. */
  senderName: string;
  senderHandle: string | null;
  /** The provider's transaction id, when the email showed one. */
  transactionId: string | null;
  /** When the payment happened (exact time from the email, or when the email arrived). */
  occurredAt: Date;
  /** How sure the AI was about what it read from the email, 0 to 1. Null for sources without AI. */
  extractionConfidence: number | null;
  /** The record it came from; for email sources, the id of the inbound email. */
  externalId: string;
  /** The driver it is assigned to. Null while unmatched. */
  driver: PaymentDriverDto | null;
  /** The AI's best guess when it was not sure enough: "Needs review". */
  suggestedDriver: PaymentDriverDto | null;
  /** How it was assigned: alias, exact name, AI or by an admin. */
  matchMethod: MatchMethod | null;
  /** 1 for alias and name, the AI's confidence for AI matches and suggestions, null for manual. */
  matchConfidence: number | null;
  /** One line on why (the alias, the AI's reason, or why matching failed). */
  matchExplanation: string | null;
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

/** What `POST /payments/:id/assign` did. */
export class AssignPaymentResultDto {
  payment: PaymentDto;
  /** True if the payer's name was saved as a new alias of the driver. */
  aliasSaved: boolean;
  /**
   * The driver who already owns the payer's name as an alias, if it is someone else: that alias is NOT
   * moved (one alias, one driver); the admin decides.
   */
  aliasOwnedBy: PaymentDriverDto | null;
}
