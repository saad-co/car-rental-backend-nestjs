import { ApiProperty } from "@nestjs/swagger";
import {
  InboundEmailStatus,
  PROVIDER_VALUES,
  type InboundEmailProvider,
} from "../inbound-email.entity.js";

/**
 * One processed email as the admin email log sees it (spec section 10): what came in and what happened
 * to it. The body is left out: it is long and holds personal details.
 */
export class InboundEmailDto {
  id: string;
  /** When our mail server received it. */
  receivedAt: Date;
  fromAddress: string | null;
  subject: string;
  // A union of strings, not a TypeScript enum, so the OpenAPI document needs the values spelled out.
  @ApiProperty({ enum: PROVIDER_VALUES, enumName: "InboundEmailProvider" })
  provider: InboundEmailProvider;
  status: InboundEmailStatus;
  /** Why it was rejected or failed (always set for those statuses). */
  statusReason: string | null;
  /** True only when DKIM passed for the provider's own domain. */
  authDkimPass: boolean;
  /** The signing domain that passed, e.g. `venmo.com`. */
  authDkimDomain: string | null;
  /** The message's UID in the mailbox (for finding it in Gmail by hand if needed). */
  imapUid: number;
  /** The payment this email created, if any. */
  paymentId: string | null;
}

/** One page of the email log, newest email first. */
export class InboundEmailListDto {
  items: InboundEmailDto[];
  /** Number of emails matching the filters, across all pages. */
  total: number;
  page: number;
  limit: number;
}
