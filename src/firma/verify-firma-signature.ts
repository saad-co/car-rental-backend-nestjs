import { createHmac, timingSafeEqual } from "node:crypto";

export interface FirmaSignatureInput {
  /** The webhook's signing secret exactly as firma shows it, from `FIRMA_WEBHOOK_SECRET`. */
  secret: string;
  /** Header `X-Firma-Signature`: `t=<unix seconds>,v1=<hex>`. */
  signatureHeader: string | undefined;
  /** Header `X-Firma-Signature-Old`: the same, made with the previous secret (sent for 7 days after a rotation). */
  oldSignatureHeader?: string | undefined;
  /** The body exactly as received, before any JSON parsing (a changed byte changes the signature). */
  rawBody: Buffer;
}

export type FirmaSignatureResult =
  { valid: true } | { valid: false; reason: string };

/**
 * Checks that a webhook call really comes from firma (spec 8 rule: webhook routes verify signatures from the raw body).
 * firma signs `<t>.<raw body>` with HMAC-SHA256, using the secret as it is written (no decoding, no prefix to strip), and
 * sends `t=<unix>,v1=<hex>`. While a secret is being rotated the old one signs too, in `X-Firma-Signature-Old`: either
 * header may match.
 *
 * There is deliberately **no timestamp tolerance** (firma's example makes it optional): firma's docs do not say whether a
 * retry (after 5 minutes, after 1 hour) is signed again, and a tolerance would refuse the very retries the schedule exists
 * for. A replayed call is harmless here because the body is never trusted: the handler only learns *which* contract to look
 * up, then asks firma itself for its state (D75).
 *
 * Why the rest matters: the raw body, because a parsed-and-rewritten body could look the same with different bytes; the
 * constant-time comparison, because a normal `===` stops at the first wrong character and leaks how much was right.
 *
 * Never throws for a bad request; it returns the reason so the controller can log it.
 */
export function verifyFirmaSignature(
  input: FirmaSignatureInput,
): FirmaSignatureResult {
  const { secret, rawBody } = input;
  if (!input.signatureHeader && !input.oldSignatureHeader) {
    return { valid: false, reason: "missing X-Firma-Signature header" };
  }
  const headers = [input.signatureHeader, input.oldSignatureHeader].filter(
    (header): header is string => !!header,
  );
  let malformed = true;
  for (const header of headers) {
    const parts = parseHeader(header);
    if (!parts) continue;
    malformed = false;
    const expected = createHmac("sha256", secret)
      .update(`${parts.t}.`)
      .update(rawBody)
      .digest();
    const received = Buffer.from(parts.v1, "hex");
    // `Buffer.from(…, "hex")` stops at the first bad character, so a wrong length also means a malformed value.
    if (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    ) {
      return { valid: true };
    }
  }
  return {
    valid: false,
    reason: malformed
      ? "X-Firma-Signature is not in the form t=<unix>,v1=<hex>"
      : "signature does not match",
  };
}

/** `t=1700000000,v1=abcd…` → its two values; null when either is missing. */
function parseHeader(header: string): { t: string; v1: string } | null {
  const values = new Map<string, string>();
  for (const piece of header.split(",")) {
    const at = piece.indexOf("=");
    if (at > 0)
      values.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
  }
  const t = values.get("t");
  const v1 = values.get("v1");
  return t && v1 ? { t, v1 } : null;
}
