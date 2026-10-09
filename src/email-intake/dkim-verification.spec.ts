import { verifyDkim } from "./dkim-verification.js";

const SERVER = "mail.gonzocar.com";

/** Synthetic headers shaped like what a Mailcow server writes. Replace with real ones once we have samples (B5). */
const PASS_CHASE = `${SERVER}; dkim=pass header.d=chase.com header.s=sel1; spf=pass smtp.mailfrom=chase.com`;

function verify(
  authenticationResults: string[],
  provider: "zelle_chase" | "venmo" = "zelle_chase",
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
