import type { EmailProvider } from "./dkim-verification.js";

/**
 * The only sender addresses we process, each with its provider. Confirmed from real emails
 * (2026-10-09). A `Map`, not a plain object, so an odd address like `constructor` can never
 * match an inherited property.
 */
const PROVIDER_BY_SENDER = new Map<string, EmailProvider>([
  ["no.reply.alerts@chase.com", "zelle_chase"],
  ["cash@square.com", "cashapp"],
  ["venmo@venmo.com", "venmo"],
  ["notifications@stripe.com", "stripe"],
  ["alerts@account.chime.com", "chime"],
]);

/** The allow-list itself: use it to search the mailbox for payment senders only (spec 5.1). */
export const ALLOWED_SENDERS: readonly string[] = [
  ...PROVIDER_BY_SENDER.keys(),
];

/**
 * Which provider an email claims to be from, judged by its sender address, or `null` if the
 * sender is not on the allow-list (that email is never processed).
 *
 * The sender is only a claim: anyone can write any `From:`. It is `verifyDkim` that proves the
 * email really came from that provider, so always run both.
 */
export function providerFromSender(
  address: string | null,
): EmailProvider | null {
  if (address === null) return null;
  return PROVIDER_BY_SENDER.get(address.trim().toLowerCase()) ?? null;
}
