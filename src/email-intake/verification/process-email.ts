import { PaymentSource, type Payment } from "../../payments/payment.entity.js";
import { verifyDkim, type EmailProvider } from "./dkim-verification.js";
import {
  InboundEmailStatus,
  type InboundEmail,
} from "../inbound-email.entity.js";
import { parseRawEmail, type ParsedEmail } from "./parse-raw-email.js";
import {
  validateExtraction,
  type PaymentExtractor,
} from "../extraction/payment-extraction.js";
import { providerFromSender } from "./sender-provider.js";

/** The `inbound_emails` row to save, minus what only the mailbox knows (mailbox, UIDs, Gmail id). */
export type EmailRecord = Pick<
  InboundEmail,
  | "messageId"
  | "fromAddress"
  | "subject"
  | "receivedAt"
  | "authDkimPass"
  | "authDkimDomain"
  | "provider"
  | "status"
  | "statusReason"
  | "bodyText"
>;

/** The `payments` row to save. Its `externalId` (the email row's id) and `status` are set when saving. */
export type PaymentRecord = Pick<
  Payment,
  | "source"
  | "transactionId"
  | "amountCents"
  | "senderName"
  | "senderHandle"
  | "occurredAt"
  | "extractionConfidence"
>;

/** What one email turned into: always an email row, and a payment only when status is `processed`. */
export interface ProcessedEmail {
  email: EmailRecord;
  payment: PaymentRecord | null;
}

export interface ProcessEmailDeps {
  /** Host name of the mail server whose `Authentication-Results` we trust (`mx.google.com`, D38). */
  trustedServerId: string;
  extractor: PaymentExtractor;
}

/** Which payment source an email provider's payments are (spec section 4). */
const SOURCE_BY_PROVIDER: Record<EmailProvider, PaymentSource> = {
  zelle_chase: PaymentSource.email_zelle,
  cashapp: PaymentSource.email_cashapp,
  venmo: PaymentSource.email_venmo,
  stripe: PaymentSource.email_stripe,
  chime: PaymentSource.email_chime,
};

/**
 * Turns one raw email into what to store (spec 5.1 and 5.2). A class because it needs two collaborators (which
 * mail server to trust, and the AI extractor) that are given once in the constructor, as `EmailIntakeService`
 * and the tests do, instead of being passed on every call.
 */
export class EmailProcessor {
  constructor(private readonly deps: ProcessEmailDeps) {}

  /**
   * Decides what one email is, from its raw bytes (spec 5.1 and 5.2). Saves nothing: the caller stores
   * the result, so tests can call it directly with a fake extractor.
   *
   * Order: parse → sender on the allow-list → DKIM from our own mail server → AI extraction → validation.
   * Every permanent problem comes back as a status with a reason. A TEMPORARY problem (the AI or the
   * network failing) is thrown, never turned into a result, so the caller can retry the same email later.
   *
   * @param receivedAt When our mail server received the email (IMAP internal date), not the sender's `Date`.
   * @param options.abandonReason Set by the caller after the AI failed on this email several runs in a row:
   *   the email is then recorded as `extraction_failed` with this reason instead of calling the AI again,
   *   so one stuck email cannot block every email after it.
   */
  async process(
    raw: Buffer,
    receivedAt: Date,
    options: { abandonReason?: string } = {},
  ): Promise<ProcessedEmail> {
    let parsed: ParsedEmail;
    try {
      parsed = await parseRawEmail(raw);
    } catch (error) {
      // Unreadable bytes stay unreadable: a permanent failure, recorded with the parser's message.
      return {
        email: {
          messageId: null,
          fromAddress: null,
          subject: "",
          receivedAt,
          authDkimPass: false,
          authDkimDomain: null,
          provider: "unknown",
          status: InboundEmailStatus.extraction_failed,
          statusReason: `Could not parse the email: ${errorMessage(error)}`,
          bodyText: null,
        },
        payment: null,
      };
    }

    const base = {
      messageId: parsed.messageId,
      fromAddress: parsed.fromAddress,
      subject: parsed.subject,
      receivedAt,
    };

    // The mailbox search matches senders by substring, so an address like `cash@square.com.evil.io`
    // can come back. Only exact allow-listed addresses go further; the body of anything else is not kept.
    const provider = providerFromSender(parsed.fromAddress);
    if (provider === null) {
      return rejected(
        { ...base, provider: "unknown", bodyText: null },
        `Sender ${parsed.fromAddress ?? "(none)"} is not on the allow-list`,
      );
    }

    const dkim = verifyDkim({
      authenticationResults: parsed.authenticationResults,
      trustedServerId: this.deps.trustedServerId,
      provider,
    });
    if (!dkim.verified) {
      return rejected(
        { ...base, provider, bodyText: parsed.bodyText },
        dkim.reason,
      );
    }

    const verified = {
      ...base,
      provider,
      authDkimPass: true,
      authDkimDomain: dkim.domain,
      bodyText: parsed.bodyText,
    };
    if (options.abandonReason !== undefined) {
      return {
        email: {
          ...verified,
          status: InboundEmailStatus.extraction_failed,
          statusReason: options.abandonReason,
        },
        payment: null,
      };
    }

    const input = {
      provider,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
    };
    // May throw (AI or network down): deliberately not caught here, see above.
    const output = await this.deps.extractor.extract(input);
    const result = validateExtraction(output, input);

    if (result.kind === "not_payment") {
      return {
        email: {
          ...verified,
          status: InboundEmailStatus.not_payment,
          statusReason: null,
        },
        payment: null,
      };
    }
    if (result.kind === "failed") {
      return {
        email: {
          ...verified,
          status: InboundEmailStatus.extraction_failed,
          statusReason: result.reason,
        },
        payment: null,
      };
    }

    const { payment } = result;
    return {
      email: {
        ...verified,
        status: InboundEmailStatus.processed,
        statusReason: null,
      },
      payment: {
        source: SOURCE_BY_PROVIDER[provider],
        transactionId: payment.transactionId,
        amountCents: payment.amountCents,
        senderName: payment.senderName,
        senderHandle: payment.senderHandle,
        occurredAt: payment.occurredAt ?? receivedAt,
        extractionConfidence: payment.confidence,
      },
    };
  }
}

/** An email that failed the sender or DKIM check. It never reaches the AI and never credits anyone. */
function rejected(
  email: Omit<
    EmailRecord,
    "authDkimPass" | "authDkimDomain" | "status" | "statusReason"
  >,
  reason: string,
): ProcessedEmail {
  return {
    email: {
      ...email,
      authDkimPass: false,
      authDkimDomain: null,
      status: InboundEmailStatus.rejected_unverified,
      statusReason: reason,
    },
    payment: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
