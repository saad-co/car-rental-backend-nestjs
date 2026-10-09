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
  /** When the payment happened, if the extractor found it. The caller falls back to the email's own date. */
  occurredAt: Date | null;
  /** 0 to 1. */
  confidence: number;
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

  if (typeof o.is_payment !== "boolean") return fail("is_payment must be true or false");
  if (!o.is_payment) return { kind: "not_payment" };

  if (o.provider !== email.provider) {
    return fail(`Provider ${String(o.provider)} does not match the verified sender (${email.provider})`);
  }
  if (!Number.isSafeInteger(o.amount_cents) || (o.amount_cents as number) <= 0) {
    return fail("amount_cents must be a positive integer");
  }
  const amountCents = o.amount_cents as number;

  if (typeof o.sender_name !== "string" || o.sender_name.trim() === "") {
    return fail("sender_name must be a non-empty string");
  }
  if (o.sender_handle !== null && typeof o.sender_handle !== "string") {
    return fail("sender_handle must be a string or null");
  }
  if (typeof o.confidence !== "number" || !(o.confidence >= 0 && o.confidence <= 1)) {
    return fail("confidence must be a number from 0 to 1");
  }

  let occurredAt: Date | null = null;
  if (o.occurred_at !== null) {
    occurredAt = typeof o.occurred_at === "string" ? new Date(o.occurred_at) : null;
    if (occurredAt === null || Number.isNaN(occurredAt.getTime())) {
      return fail("occurred_at must be an ISO date string or null");
    }
  }

  if (!amountAppearsInText(amountCents, `${email.subject}\n${email.bodyText}`)) {
    return fail(`Amount ${formatDollars(amountCents)} does not appear in the email text`);
  }

  return {
    kind: "payment",
    payment: {
      provider: email.provider,
      amountCents,
      senderName: o.sender_name.trim(),
      senderHandle: o.sender_handle === null ? null : (o.sender_handle as string).trim(),
      occurredAt,
      confidence: o.confidence,
    },
  };
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
  const wholeDollarForms = cents % 100 === 0 ? [`${dollars}`, withCommas(dollars)] : [];
  const forms = [
    `${dollars}.${fraction}`,
    `${withCommas(dollars)}.${fraction}`,
    ...wholeDollarForms,
  ];
  return forms.some((form) => {
    const pattern = new RegExp(`(?<![\\d.,])${escapeRegExp(form)}(?!\\d|[.,]\\d)`);
    return pattern.test(text);
  });
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
