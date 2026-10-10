import { verifyDkim } from "./dkim-verification.js";
import { parseRawEmail } from "./parse-raw-email.js";

/** Builds a raw email from header lines and a body. Synthetic: replace with real samples once we have them (B5). */
function eml(headers: string[], body: string): Buffer {
  return Buffer.from([...headers, "", body].join("\r\n"));
}

describe("parseRawEmail", () => {
  it("reads the sender, subject and date", async () => {
    const parsed = await parseRawEmail(
      eml(
        [
          "From: Chase <No.Reply.Alerts@Chase.com>",
          "Subject: You received money with Zelle",
          "Date: Wed, 07 Oct 2026 14:30:00 +0000",
          "Content-Type: text/plain",
        ],
        "Hello",
      ),
    );
    expect(parsed.fromAddress).toBe("no.reply.alerts@chase.com");
    expect(parsed.subject).toBe("You received money with Zelle");
    expect(parsed.date).toEqual(new Date("2026-10-07T14:30:00Z"));
  });

  it("returns null / empty for missing headers instead of failing", async () => {
    const parsed = await parseRawEmail(
      eml(["Content-Type: text/plain"], "Hello"),
    );
    expect(parsed.fromAddress).toBeNull();
    expect(parsed.subject).toBe("");
    expect(parsed.date).toBeNull();
  });

  it("collects Authentication-Results top to bottom, unfolded, and feeds verifyDkim", async () => {
    const parsed = await parseRawEmail(
      eml(
        [
          "Authentication-Results: mail.gonzocar.com;",
          " dkim=pass header.d=chase.com",
          "Authentication-Results: mail.gonzocar.com; dkim=fail header.d=chase.com",
          "From: a@chase.com",
          "Content-Type: text/plain",
        ],
        "Hello",
      ),
    );
    expect(parsed.authenticationResults).toEqual([
      "mail.gonzocar.com; dkim=pass header.d=chase.com",
      "mail.gonzocar.com; dkim=fail header.d=chase.com",
    ]);
    expect(
      verifyDkim({
        authenticationResults: parsed.authenticationResults,
        trustedServerId: "mail.gonzocar.com",
        provider: "zelle_chase",
      }),
    ).toEqual({ verified: true });
  });

  it("strips HTML and style blocks when there is no plain-text part", async () => {
    const parsed = await parseRawEmail(
      eml(
        ["From: a@b.com", "Content-Type: text/html"],
        "<style>p { color: red }</style><p>Amount: <b>$600.00</b></p>",
      ),
    );
    expect(parsed.bodyText).toBe("Amount: $600.00");
  });

  it("prefers the plain-text part and decodes quoted-printable", async () => {
    const parsed = await parseRawEmail(
      eml(
        ["From: a@b.com", 'Content-Type: multipart/alternative; boundary="b1"'],
        [
          "--b1",
          "Content-Type: text/plain",
          "Content-Transfer-Encoding: quoted-printable",
          "",
          "You were sent =24120",
          "--b1",
          "Content-Type: text/html",
          "",
          "<p>html version</p>",
          "--b1--",
        ].join("\r\n"),
      ),
    );
    expect(parsed.bodyText).toBe("You were sent $120");
  });

  it("falls back to the HTML when the plain-text part is blank (Venmo's shape)", async () => {
    const parsed = await parseRawEmail(
      eml(
        ["From: a@b.com", 'Content-Type: multipart/alternative; boundary="b1"'],
        [
          "--b1",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          "",
          "--b1",
          "Content-Type: text/html; charset=UTF-8",
          "",
          '<html><head><style>p { color: red }</style></head><body><p>Pat paid you</p><p>TRANSACTION ID</p><p>123</p><img src="https://x.test/a.png"><a href="https://x.test/l">See transaction</a></body></html>',
          "--b1--",
        ].join("\r\n"),
      ),
    );
    expect(parsed.bodyText).toContain("Pat paid you");
    expect(parsed.bodyText).toContain("TRANSACTION ID");
    expect(parsed.bodyText).toContain("See transaction");
    expect(parsed.bodyText).not.toContain("color: red");
    expect(parsed.bodyText).not.toContain("x.test");
  });
});
