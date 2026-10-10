import {
  EXPECTED_DKIM_DOMAINS,
  type EmailProvider,
} from "./dkim-verification.js";
import type { LlmJsonClient, LlmJsonRequest } from "./llm-client.js";
import type {
  ExtractionInput,
  PaymentExtractor,
} from "./payment-extraction.js";

/**
 * The rules for every email. Written from the real emails in the inbox (2026-10-10): each rule
 * exists because a real email would otherwise be misread.
 */
export const EXTRACTION_RULES = `You read one notification email received by GonzoCar, a car rental business whose drivers pay rent through Zelle, Cash App, Venmo, Stripe and Chime.
Decide whether the email confirms money RECEIVED by the business (an incoming payment), and if so extract it.

Rules:
1. is_payment is true only when the email confirms that money was received by the business. Requests for money, expired requests, payouts or transfers to a bank account, money sent BY the business ("You paid ...", "Payment sent"), refunds, statements, sign-in or security alerts, legal or policy notices and marketing are all is_payment false.
2. amount_cents is the received amount in whole cents ("$317.85" is 31785, "$59" is 5900). Use the amount the email presents as the payment amount. Never take a figure from a memo or note, even if it looks like rent or a fee.
3. sender_name is the payer's name exactly as the email writes it, keeping its capitalisation and punctuation.
4. sender_handle is the payer's email address, phone number or @username only if the email shows one for the payer, otherwise null. Never use the business's own handle or account.
5. occurred_at is when the payment was sent, as an ISO 8601 date or date-time, if the email shows it; otherwise null.
6. transaction_id is the provider's transaction or payment id if the email shows one; otherwise null.
7. provider is always the provider given with the email.
8. confidence is how sure you are of the whole answer, from 0 to 1.
9. When is_payment is false, set amount_cents, sender_name, sender_handle, occurred_at and transaction_id to null.
Answer with JSON only, following the schema.`;

/**
 * What each provider's emails look like, and which of its emails are NOT payments. One extractor
 * plus this small table, instead of five separate modules (Saad's idea, to revisit after the
 * evaluation shows whether per-provider differences need more than this).
 */
export const PROVIDER_HINTS: Record<EmailProvider, string> = {
  zelle_chase:
    'Chase alert for Zelle. A payment reads "<NAME> SENT YOU MONEY" ("You received money with Zelle") with "Amount $X"; the payer is the name before "SENT YOU MONEY" and Chase shows no payer email or phone. "You have a Zelle request" / "requested money" is a request, not a payment. "Your latest statement is now available" is not a payment.',
  cashapp:
    'Cash App. A payment reads "You were sent $X by <NAME>", "<NAME> sent you $X" or "<NAME> paid you $X". "Payment sent" / "You paid <NAME> $X" is money going out: not a payment.',
  venmo:
    'Venmo. A payment reads "<NAME> paid you $X" and "MONEY CREDITED TO YOUR VENMO ACCOUNT"; in the body the amount may be split over several lines ("$", "396", ".", "00"), while the subject has it whole. "SENT TO @GonzoCar" is the business, not the payer. "You paid <NAME>", "Standard transfer initiated" (money moving to the bank) and transaction-history emails are not payments.',
  stripe:
    'Stripe. A payment reads "You\'ve just received a payment through Stripe" with "Payment $X" and a "Customer" line: a contract title such as RA_NAME_..., then the payer\'s email. Use the contract title as sender_name and that email as sender_handle. The text after the amount may mention other figures (rent before a fee): the amount is the one after "Payment". "Your $X payout ... is on the way" is money moving to the bank: not a payment. Sign-in alerts and legal notices are not payments.',
  chime:
    'Chime. A payment reads "<NAME> just sent you money" / "you just received $X from <NAME>". Requests ("is requesting $X"), expired requests and "Your transfer out has been initiated" are not payments.',
};

/**
 * "This type, or null". Written with `anyOf` because Gemini supports only a listed subset of JSON
 * Schema, and `anyOf` is on that list (checked in the SDK's types, 2026-10-10).
 */
function nullable(type: "string" | "integer"): Record<string, unknown> {
  return { anyOf: [{ type }, { type: "null" }] };
}

/** The answer's shape (spec 5.2, plus `transaction_id` for B37). Every field is required; "absent" is null. */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    is_payment: { type: "boolean" },
    provider: { type: "string", enum: Object.keys(EXPECTED_DKIM_DOMAINS) },
    amount_cents: nullable("integer"),
    sender_name: nullable("string"),
    sender_handle: nullable("string"),
    occurred_at: nullable("string"),
    transaction_id: nullable("string"),
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "is_payment",
    "provider",
    "amount_cents",
    "sender_name",
    "sender_handle",
    "occurred_at",
    "transaction_id",
    "confidence",
  ],
  additionalProperties: false,
};

/**
 * Bodies longer than this are cut, to bound cost. Real payment emails are 1-5 thousand characters
 * and the payment details come first; a cut is marked so the model knows text is missing.
 */
export const MAX_BODY_CHARS = 20_000;

/** Builds the request for one email. Only the provider, subject and cleaned body are sent (spec 5.2). */
export function buildExtractionRequest(input: ExtractionInput): LlmJsonRequest {
  const body =
    input.bodyText.length > MAX_BODY_CHARS
      ? `${input.bodyText.slice(0, MAX_BODY_CHARS)}\n[... rest of the email cut ...]`
      : input.bodyText;

  return {
    system: EXTRACTION_RULES,
    user: [
      `Provider: ${input.provider}`,
      `About this provider: ${PROVIDER_HINTS[input.provider]}`,
      "",
      `Subject: ${input.subject}`,
      "",
      "Body:",
      body,
    ].join("\n"),
    schema: EXTRACTION_SCHEMA,
  };
}

/**
 * The real extractor: asks an LLM to read the email. Its answer is returned untouched and is
 * NOT trusted: the caller must pass it through `validateExtraction`. Any error from the LLM
 * propagates (spec rule 5: no silent failure).
 */
export class LlmPaymentExtractor implements PaymentExtractor {
  constructor(private readonly llm: LlmJsonClient) {}

  extract(input: ExtractionInput): Promise<unknown> {
    return this.llm.generateJson(buildExtractionRequest(input));
  }
}
