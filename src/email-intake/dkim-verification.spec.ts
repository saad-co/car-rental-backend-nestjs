import { verifyDkim, type EmailProvider } from "./dkim-verification.js";

const SERVER = "mail.gonzocar.com";

/** Synthetic headers shaped like what a Mailcow server writes. Replace with real ones once we have samples (B5). */
const PASS_CHASE = `${SERVER}; dkim=pass header.d=chase.com header.s=sel1; spf=pass smtp.mailfrom=chase.com`;

function verify(
  authenticationResults: string[],
  provider: EmailProvider = "zelle_chase",
) {
  return verifyDkim({
    authenticationResults,
    trustedServerId: SERVER,
    provider,
  });
}

describe("verifyDkim", () => {
  it("accepts dkim=pass for the provider's exact domain", () => {
    expect(verify([PASS_CHASE])).toEqual({ verified: true });
  });

  it("accepts when one of several signatures matches, and ignores comments", () => {
    const header = `${SERVER}; dkim=pass (2048-bit key) header.d=other.com; dkim=pass (1024-bit key) header.d=chase.com`;
    expect(verify([header])).toEqual({ verified: true });
  });

  it("rejects a valid signature from another domain (e.g. a rewritten forward)", () => {
    const result = verify([`${SERVER}; dkim=pass header.d=gonzocar.com`]);
    expect(result).toEqual({
      verified: false,
      reason: "DKIM passed for gonzocar.com, expected chase.com",
    });
  });

  it("rejects look-alike domains", () => {
    expect(
      verify([`${SERVER}; dkim=pass header.d=evilchase.com`]).verified,
    ).toBe(false);
    expect(
      verify([`${SERVER}; dkim=pass header.d=chase.com.evil.com`]).verified,
    ).toBe(false);
  });

  it("rejects dkim=fail, dkim=none and a missing DKIM result", () => {
    expect(verify([`${SERVER}; dkim=fail header.d=chase.com`]).verified).toBe(
      false,
    );
    expect(verify([`${SERVER}; dkim=none`]).verified).toBe(false);
    expect(
      verify([`${SERVER}; spf=pass smtp.mailfrom=chase.com`]).verified,
    ).toBe(false);
  });

  it("ignores a header written by another server, even if it says pass", () => {
    const result = verify(["evil.example.net; dkim=pass header.d=chase.com"]);
    expect(result).toEqual({
      verified: false,
      reason: `No Authentication-Results header from ${SERVER}`,
    });
  });

  it("uses only the topmost header from our server (forged copy below is ignored)", () => {
    const real = `${SERVER}; dkim=fail header.d=chase.com`;
    const forged = `${SERVER}; dkim=pass header.d=chase.com`;
    expect(verify([real, forged]).verified).toBe(false);
  });

  it("rejects when there are no headers at all", () => {
    expect(verify([]).verified).toBe(false);
  });

  it("checks the domain of the claimed provider", () => {
    expect(verify([PASS_CHASE], "venmo").verified).toBe(false);
  });
});

/**
 * Headers shaped exactly like real ones from gonzobilling@gmail.com (2026-10-09), with the personal
 * addresses replaced. Gmail names itself `mx.google.com` and writes the signer as `header.i=@domain`.
 */
describe("verifyDkim with Gmail's Authentication-Results", () => {
  const GMAIL = "mx.google.com";
  const verifyGmail = (header: string, provider: EmailProvider) =>
    verifyDkim({
      authenticationResults: [header],
      trustedServerId: GMAIL,
      provider,
    });

  /** Cash App: signed by square.com and, as the sender, by amazonses.com; forwarded by another Gmail (ARC). */
  const CASH_APP = `${GMAIL}; dkim=pass header.i=@square.com header.s=sel1 header.b=AAAA; dkim=pass header.i=@amazonses.com header.s=sel2 header.b=BBBB; arc=pass (i=2 spf=pass spfdomain=amazonses.square.com dkim=pass dkdomain=square.com dkim=pass dkdomain=amazonses.com dmarc=pass fromdomain=square.com); spf=pass (google.com: domain of forwarder+caf_=gonzobilling=gmail.com@gmail.com designates 209.85.220.41 as permitted sender) smtp.mailfrom="forwarder+caf_=gonzobilling=gmail.com@gmail.com"; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=square.com; dara=pass header.i=@gmail.com`;

  const VENMO = `${GMAIL}; dkim=pass header.i=@venmo.com header.s=sel1 header.b=CCCC; dkim=pass header.i=@amazonses.com header.s=sel2 header.b=DDDD; spf=pass (google.com: domain of bounce@amazonses.com designates 54.240.36.154 as permitted sender) smtp.mailfrom=bounce@amazonses.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=venmo.com`;

  it("verifies a real-shaped Cash App header", () => {
    expect(verifyGmail(CASH_APP, "cashapp")).toEqual({ verified: true });
  });

  it("verifies a real-shaped Venmo header", () => {
    expect(verifyGmail(VENMO, "venmo")).toEqual({ verified: true });
  });

  it("does not let one provider's email pass as another's", () => {
    expect(verifyGmail(CASH_APP, "venmo").verified).toBe(false);
    expect(verifyGmail(VENMO, "zelle_chase").verified).toBe(false);
  });

  it("does not treat a sending-service signature (amazonses.com) as the provider's", () => {
    const onlyAmazon = `${GMAIL}; dkim=pass header.i=@amazonses.com header.s=sel2 header.b=BBBB`;
    expect(verifyGmail(onlyAmazon, "cashapp").verified).toBe(false);
  });

  it("accepts an identity with a local part, and rejects subdomains and look-alikes", () => {
    const withUser = `${GMAIL}; dkim=pass header.i=alerts@chase.com`;
    expect(verifyGmail(withUser, "zelle_chase").verified).toBe(true);
    for (const identity of [
      "@mail.chase.com",
      "@evilchase.com",
      "@chase.com.evil.com",
    ]) {
      const header = `${GMAIL}; dkim=pass header.i=${identity}`;
      expect(verifyGmail(header, "zelle_chase").verified).toBe(false);
    }
  });

  it("ignores the ARC summary: a dkim=pass inside the parentheses is not a DKIM result", () => {
    const header = `${GMAIL}; dkim=fail header.i=@chase.com; arc=pass (i=1 dkim=pass dkdomain=chase.com)`;
    expect(verifyGmail(header, "zelle_chase").verified).toBe(false);
  });
});
