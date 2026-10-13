import type { LlmJsonClient, LlmJsonRequest } from "../llm/llm-client.js";

/** One driver as the AI sees it: everything that can identify a payer (D48). */
export interface DriverCandidate {
  id: string;
  name: string;
  status: string;
  email: string;
  phone: string;
  aliases: { type: string; value: string }[];
}

/** The payment to place: who the provider says paid, and through which method. */
export interface PaymentToMatch {
  /** `zelle` | `cashapp` | `venmo` | `chime` | `stripe`. */
  method: string;
  senderName: string;
  senderHandle: string | null;
  /** Integer cents; shown to the AI in dollars. */
  amountCents: number;
}

/** The checked answer. `driverId` is always one of the candidates' ids, or null. */
export interface AiMatch {
  driverId: string | null;
  confidence: number;
  explanation: string;
}

export const MATCH_RULES = `You assign one incoming rent payment to a driver of GonzoCar, a car rental fleet.
You get the payment (method, amount, the payer name the provider shows, and a handle if any) and the list of drivers, each with its id, name, status, email, phone and known payment aliases (names, handles, company names or family members the driver has paid from before, per method).
Exact alias, email and phone matches were already handled before you: you decide the rest, using all of this context.

Rules:
1. driver_id is the id of the driver who most likely made this payment, copied exactly from the list, or null if no driver fits.
2. Evidence, strongest first: an alias equal or nearly equal to the payer name or handle (same method is strongest); the payer's full name equal to the driver's name (ignore capitals, middle names, initials, accents); a handle that clearly contains the driver's name.
3. A shared first name only, or a shared last name only, is weak evidence: confidence below 0.7.
4. If two or more drivers fit about equally well, choose the best but keep confidence below 0.7.
5. Similar names are a trap: if another driver's name is close to the payer's (a letter or two apart, a shared last name, a nickname like Jon/John), keep confidence below 0.7 unless an alias, email, phone or handle clearly settles it. An exact name is NOT proof on its own when such a close name exists.
6. A company or another person's name matches only through an alias; otherwise driver_id is null.
7. confidence: 0.95 or more for an exact full name with no close name among the other drivers; about 0.8 for a strong but not exact match; below 0.7 when unsure.
8. Prefer active drivers, but an inactive driver may still pay old rent.
9. explanation: one short sentence on the evidence, without repeating the whole driver list.
Answer with JSON only, following the schema.`;

export const MATCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    driver_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    explanation: { type: "string" },
  },
  required: ["driver_id", "confidence", "explanation"],
  additionalProperties: false,
};

/** Builds the request: the payment and the drivers as JSON. */
export function buildMatchRequest(
  payment: PaymentToMatch,
  drivers: DriverCandidate[],
): LlmJsonRequest {
  return {
    system: MATCH_RULES,
    user: [
      "Payment:",
      JSON.stringify({
        method: payment.method,
        amount: `$${Math.floor(payment.amountCents / 100)}.${String(payment.amountCents % 100).padStart(2, "0")}`,
        payer_name: payment.senderName,
        payer_handle: payment.senderHandle,
      }),
      "",
      "Drivers:",
      JSON.stringify(drivers),
    ].join("\n"),
    schema: MATCH_SCHEMA,
  };
}

/**
 * Checks the AI's answer before anything trusts it. An id that is not in the list becomes null (spec 6.1),
 * so the AI can never invent a driver. Anything malformed throws: the payment is then recorded as
 * "matching failed" and goes to review.
 */
export function validateMatch(
  output: unknown,
  drivers: DriverCandidate[],
): AiMatch {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    throw new Error("AI match answer is not a JSON object");
  }
  const o = output as Record<string, unknown>;
  if (
    typeof o.confidence !== "number" ||
    !(o.confidence >= 0 && o.confidence <= 1)
  ) {
    throw new Error("AI match confidence must be a number from 0 to 1");
  }
  const explanation =
    typeof o.explanation === "string" ? o.explanation.trim().slice(0, 300) : "";
  const known =
    typeof o.driver_id === "string" &&
    drivers.some((driver) => driver.id === o.driver_id);
  return {
    driverId: known ? (o.driver_id as string) : null,
    // A dropped (invented) id must never carry a high confidence.
    confidence: known ? o.confidence : 0,
    explanation:
      !known && typeof o.driver_id === "string"
        ? `AI named a driver that is not in the list. ${explanation}`.trim()
        : explanation,
  };
}

/** Asks the AI which driver made a payment. Errors (network, rate limit) propagate to the caller. */
export class AiDriverMatcher {
  constructor(private readonly llm: LlmJsonClient) {}

  async match(
    payment: PaymentToMatch,
    drivers: DriverCandidate[],
  ): Promise<AiMatch> {
    const output = await this.llm.generateJson(
      buildMatchRequest(payment, drivers),
    );
    return validateMatch(output, drivers);
  }
}
