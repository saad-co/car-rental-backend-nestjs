/** The payment providers whose emails we accept (spec section 5.1). */
export type EmailProvider =
  "cashapp" | "venmo" | "zelle_chase" | "stripe" | "chime";

/**
 * The domains a provider's DKIM signature may be for: one of these, matched EXACTLY. A signature
 * from any other domain (even a valid one) proves nothing about who sent the email.
 *
 * Confirmed from all 28 real samples read through Gmail (2026-10-10). Chime signs with two
 * domains depending on the email type: `account.chime.com` ("sent you money", sent through
 * SendGrid) and `chime.com` (requests, transfers out, sent through Amazon SES); both are Chime's
 * own. Each provider also gets a second signature from its sending service (`amazonses.com`,
 * `sendgrid.info`), which proves nothing about the provider and is ignored.
 */
export const EXPECTED_DKIM_DOMAINS: Record<EmailProvider, readonly string[]> = {
  cashapp: ["square.com"],
  venmo: ["venmo.com"],
  zelle_chase: ["chase.com"],
  stripe: ["stripe.com"],
  chime: ["account.chime.com", "chime.com"],
};

/** Outcome of the check. `reason` is stored in `InboundEmail.statusReason` when the email is rejected. */
export type DkimVerdict =
  { verified: true } | { verified: false; reason: string };

export interface VerifyDkimInput {
  /**
   * Every `Authentication-Results` header value of the email, top to bottom (newest first).
   * Our own mail server adds its header on arrival, so it is the topmost one.
   */
  authenticationResults: string[];
  /**
   * Host name of OUR mail server (the first word of the header it adds), e.g. `mx.google.com` for Gmail or `mail.gonzocar.com` for Mailcow.
   * Headers written by anyone else are ignored: a forger can put any text in a header.
   */
  trustedServerId: string;
  provider: EmailProvider;
}

/**
 * Decides whether an email really came from the provider it claims, using the DKIM result that
 * OUR mail server recorded when the email arrived. Passes only when `dkim=pass` and the signing
 * domain is exactly one of the provider's domains (spec 5.1). Never throws.
 */
export function verifyDkim(input: VerifyDkimInput): DkimVerdict {
  const trusted = input.trustedServerId.trim().toLowerCase();
  const expectedDomains = EXPECTED_DKIM_DOMAINS[input.provider];

  // Only the topmost header from our server counts. A forged copy lower down is ignored.
  const header = input.authenticationResults.find(
    (value) => parseHeader(value).serverId === trusted,
  );
  if (!header) {
    return {
      verified: false,
      reason: `No Authentication-Results header from ${trusted}`,
    };
  }

  const dkimResults = parseHeader(header).dkim;
  if (dkimResults.length === 0) {
    return {
      verified: false,
      reason: "No DKIM result in the Authentication-Results header",
    };
  }
  if (
    dkimResults.some(
      (r) => r.result === "pass" && expectedDomains.includes(r.domain),
    )
  ) {
    return { verified: true };
  }

  const passedDomains = dkimResults
    .filter((r) => r.result === "pass")
    .map((r) => r.domain);
  if (passedDomains.length > 0) {
    return {
      verified: false,
      reason: `DKIM passed for ${passedDomains.join(", ")}, expected ${expectedDomains.join(" or ")}`,
    };
  }
  return {
    verified: false,
    reason: `DKIM result: ${dkimResults.map((r) => r.result).join(", ")}`,
  };
}

interface ParsedHeader {
  /** First word of the header, lower-case. Empty if the header is blank. */
  serverId: string;
  dkim: { result: string; domain: string }[];
}

/**
 * Splits `mail.example.com; dkim=pass (comment) header.d=chase.com header.s=x; spf=pass ...` into
 * the server id and its DKIM results. The signing domain is read from `header.d=` (Mailcow) or
 * `header.i=@domain` (Gmail). Parenthesised comments are dropped, which also removes Gmail's
 * `arc=pass (... dkim=pass ...)` summary so it can never be mistaken for a DKIM result. A header
 * can hold several DKIM results (one per signature).
 */
function parseHeader(value: string): ParsedHeader {
  const [first = "", ...rest] = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .split(";")
    .map((part) => part.trim().toLowerCase());

  const dkim = rest.flatMap((part) => {
    const result = /^dkim=(\w+)/.exec(part)?.[1];
    if (!result) return [];
    const d = /(?:^|\s)header\.d=(\S+)/.exec(part)?.[1];
    const i = /(?:^|\s)header\.i=(\S+)/.exec(part)?.[1];
    // Mailcow writes `header.d=chase.com`; Gmail writes `header.i=@chase.com` (the signer's identity).
    const domain = d ?? i?.slice(i.lastIndexOf("@") + 1) ?? "";
    return [{ result, domain }];
  });

  return { serverId: first.split(" ")[0] ?? "", dkim };
}
