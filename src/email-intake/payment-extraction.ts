import type { EmailProvider } from "./dkim-verification.js";

/** What goes to the extractor: only the email text, no driver data (spec 5.2). */
export interface ExtractionInput {
  /** The provider our DKIM check verified. The extractor may not choose a different one. */
  provider: EmailProvider;
  subject: string;
  bodyText: string;
}

/**
 * Reads an email and returns what it claims, as untyped JSON. The real implementation will call an
 * LLM (provider not chosen yet, B8); tests use a fake. Its output is NEVER trusted: it must go
 * through `validateExtraction`.
 */
export interface PaymentExtractor {
  extract(input: ExtractionInput): Promise<unknown>;
}

/** A payment that passed every check. */
export interface ExtractedPayment {
  provider: EmailProvider;
  amountCents: number;
  senderName: string;
  senderHandle: string | null;
  /**
   * When the payment happened, only if the email gives an exact time with its time zone. Null otherwise
   * (no date, a date without a time, or a time without a zone): the caller then uses the time our mail
   * server received the email, which is exact (B50).
   */
  occurredAt: Date | null;
  /** 0 to 1. */
  confidence: number;
  /**
   * The provider's transaction id, only if it appears word for word in the email; otherwise null.
   * It deduplicates payments (B37), so an invented id must never get through.
   */
  transactionId: string | null;
}

/**
 * Outcome of validating the extractor's output. Maps to `InboundEmail.status`:
 * `payment` continues to matching, `not_payment` is `not_payment`, `failed` is `extraction_failed`
 * and `reason` goes in `statusReason`.
 */
export type ExtractionResult =
  | { kind: "payment"; payment: ExtractedPayment }
  | { kind: "not_payment" }
  | { kind: "failed"; reason: string };

/**
 * Checks the extractor's output before anything trusts it (spec 5.2):
 * the shape is right, the provider is the one we verified, and the amount literally appears in the
 * email text. Never throws; every problem comes back as `failed` with a reason.
 */
export function validateExtraction(
  output: unknown,
  email: ExtractionInput,
): ExtractionResult {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return fail("Output is not a JSON object");
  }
  const o = output as Record<string, unknown>;

  if (typeof o.is_payment !== "boolean")
    return fail("is_payment must be true or false");
  if (!o.is_payment) return { kind: "not_payment" };

  if (o.provider !== email.provider) {
    return fail(
      `Provider ${String(o.provider)} does not match the verified sender (${email.provider})`,
    );
  }
  if (
    !Number.isSafeInteger(o.amount_cents) ||
    (o.amount_cents as number) <= 0
  ) {
    return fail("amount_cents must be a positive integer");
  }
  const amountCents = o.amount_cents as number;

  if (typeof o.sender_name !== "string" || o.sender_name.trim() === "") {
    return fail("sender_name must be a non-empty string");
  }
  if (o.sender_handle !== null && typeof o.sender_handle !== "string") {
    return fail("sender_handle must be a string or null");
  }
  if (
    typeof o.confidence !== "number" ||
    !(o.confidence >= 0 && o.confidence <= 1)
  ) {
    return fail("confidence must be a number from 0 to 1");
  }

  if (o.transaction_id !== null && typeof o.transaction_id !== "string") {
    return fail("transaction_id must be a string or null");
  }

  let occurredAt: Date | null = null;
  if (o.occurred_at !== null) {
    if (typeof o.occurred_at !== "string") {
      return fail("occurred_at must be an ISO date string or null");
    }
    const parsed = exactTime(o.occurred_at);
    if (parsed === "invalid") {
      return fail("occurred_at must be an ISO date string or null");
    }
    occurredAt = parsed;
  }

  if (
    !amountAppearsInText(amountCents, `${email.subject}\n${email.bodyText}`)
  ) {
    return fail(
      `Amount ${formatDollars(amountCents)} does not appear in the email text`,
    );
  }

  return {
    kind: "payment",
    payment: {
      provider: email.provider,
      amountCents,
      senderName: o.sender_name.trim(),
      senderHandle:
        o.sender_handle === null ? null : (o.sender_handle as string).trim(),
      occurredAt,
      confidence: o.confidence,
      transactionId: transactionIdInText(
        o.transaction_id,
        `${email.subject}
${email.bodyText}`,
      ),
    },
  };
}

/**
 * The transaction id if it is written in the email exactly as given, else null. Not a failure: the
 * payment itself is still valid, it just cannot be deduplicated by id. Shorter than 4 characters is
 * ignored, because a "1" or "AB" appears in almost any text.
 */
function transactionIdInText(id: string | null, text: string): string | null {
  const trimmed = id?.trim() ?? "";
  if (trimmed.length < 4 || !text.includes(trimmed)) return null;
  return trimmed;
}

/** `2026-10-10`, `2026-10-10T00:00:00Z`, `2026-10-10T00:00+00:00`: a date shown as midnight UTC. */
const MIDNIGHT_UTC = /T00:00(:00(\.0+)?)?(Z|[+-]00:?00)$/i;
/** A time that ends with `Z` or an offset such as `-05:00`. */
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The payment time from the extractor, or null when it is not an exact moment (B50). Zelle and Venmo
 * emails show only a date; the AI then writes midnight UTC, which is 7 PM the DAY BEFORE in Chicago. A
 * time without a zone would be read in the server's own zone. In both cases the email's received time
 * (our server's clock) is better, so null is returned and the caller uses it.
 */
function exactTime(text: string): Date | null | "invalid" {
  const value = text.trim();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  if (
    !value.includes("T") ||
    MIDNIGHT_UTC.test(value) ||
    !HAS_ZONE.test(value)
  ) {
    return null;
  }
  return date;
}

function fail(reason: string): ExtractionResult {
  return { kind: "failed", reason };
}

/** 60000 -> "600.00" (integer maths, no floats). */
function formatDollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * True if the amount is written in the text as `$600.00`, `600.00`, `$1,200.00`, `1200.00`, or, for
 * whole dollars, `$600`. The number must stand alone: `60.00` does not match inside `160.00`
 * or `60.005`.
 */
function amountAppearsInText(cents: number, text: string): boolean {
  const dollars = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  const wholeDollarForms =
    cents % 100 === 0 ? [`${dollars}`, withCommas(dollars)] : [];
  const forms = [
    `${dollars}.${fraction}`,
    `${withCommas(dollars)}.${fraction}`,
    ...wholeDollarForms,
  ];
  return forms.some((form) => {
    const pattern = new RegExp(
      `(?<![\\d.,])${escapeRegExp(form)}(?!\\d|[.,]\\d)`,
    );
    return pattern.test(text);
  });
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
