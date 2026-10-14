import { createHmac, timingSafeEqual } from "node:crypto";

/** How far the delivery's timestamp may be from our clock, in seconds. Quo's own example uses 5 minutes. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

export interface QuoSignatureInput {
  /** The webhook's signing secret as Quo shows it (`whsec_...`), from `QUO_WEBHOOK_SECRET`. */
  secret: string;
  /** Header `webhook-id`: stable across retries of one delivery. */
  webhookId: string | undefined;
  /** Header `webhook-timestamp`: Unix seconds when Quo signed the request. */
  timestamp: string | undefined;
  /** Header `webhook-signature`: space-separated `v1,<base64>` entries. */
  signatureHeader: string | undefined;
  /** The body exactly as received, before any JSON parsing (any change to a byte changes the signature). */
  rawBody: Buffer;
  /** For tests. Defaults to now. */
  now?: Date;
}

export type QuoSignatureResult =
  { valid: true } | { valid: false; reason: string };

/**
 * Checks that a webhook call really comes from Quo (spec 8: verify webhook signatures). Quo signs
 * `{webhook-id}.{webhook-timestamp}.{raw body}` with HMAC-SHA256 and sends the result in base64, so only
 * someone who knows the secret can produce a matching signature.
 *
 * Why each part matters:
 * - the raw body: if the body were parsed and re-written, a changed byte would still "look" the same;
 * - the timestamp: a recorded real call cannot be replayed an hour later (older than 5 minutes is refused);
 * - the constant-time comparison: a normal `===` stops at the first wrong character, which leaks how much of a
 *   guessed signature was right.
 *
 * Never throws for a bad request, it returns the reason so the controller can log it. A malformed
 * `QUO_WEBHOOK_SECRET` is our own mistake, not the caller's, so that one does throw.
 */
export function verifyQuoSignature(
  input: QuoSignatureInput,
): QuoSignatureResult {
  const { secret, webhookId, timestamp, signatureHeader, rawBody } = input;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0)
    throw new Error("QUO_WEBHOOK_SECRET is empty or not valid base64.");

  if (!webhookId || !timestamp || !signatureHeader)
    return {
      valid: false,
      reason:
        "missing webhook-id, webhook-timestamp or webhook-signature header",
    };

  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt))
    return { valid: false, reason: "webhook-timestamp is not a number" };
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - signedAt) > MAX_CLOCK_SKEW_SECONDS)
    return {
      valid: false,
      reason: "webhook-timestamp is too far from the current time",
    };

  const expected = createHmac("sha256", key)
    .update(`${webhookId}.${timestamp}.`)
    .update(rawBody)
    .digest();

  // The header may carry several signatures (for example while a secret is being rotated): any one may match.
  const matches = signatureHeader.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const received = Buffer.from(signature, "base64");
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  });

  return matches
    ? { valid: true }
    : { valid: false, reason: "signature does not match" };
}
