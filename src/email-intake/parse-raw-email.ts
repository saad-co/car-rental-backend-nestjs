import { convert } from "html-to-text";
import { simpleParser } from "mailparser";

/** The parts of a raw email the intake pipeline needs. */
export interface ParsedEmail {
  /** Lower-case address of the first `From`, or null if there is none. */
  fromAddress: string | null;
  subject: string;
  /** The `Date` header, or null if missing or unreadable. */
  date: Date | null;
  /** Every `Authentication-Results` value, top to bottom (newest first). Input for `verifyDkim`. */
  authenticationResults: string[];
  /** Readable body text. If the plain-text part is missing or blank (Venmo), the HTML is converted to text. */
  bodyText: string;
}

/**
 * Turns a raw email (the bytes of an `.eml` file, or of a Gmail/IMAP message) into the fields we use.
 *
 * It does not decide whether the email is trustworthy; that is `verifyDkim`'s job. Throws if the
 * bytes cannot be parsed at all: the caller must record that as a failure, never swallow it.
 */
export async function parseRawEmail(raw: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw);

  const authenticationResults = parsed.headerLines
    .filter((header) => header.key === "authentication-results")
    .map((header) =>
      header.line
        .slice(header.line.indexOf(":") + 1)
        .replace(/\s+/g, " ")
        .trim(),
    );

  return {
    fromAddress: parsed.from?.value[0]?.address?.toLowerCase() ?? null,
    subject: parsed.subject ?? "",
    date: parsed.date ?? null,
    authenticationResults,
    bodyText: readableBody(parsed.text, parsed.html),
  };
}

/**
 * The readable text of an email. Normally the plain-text part. But Venmo sends a plain-text part
 * that is BLANK and puts the real content only in the HTML, and mailparser does not fall back to
 * the HTML when a (blank) text part exists. So when the plain text is empty, the HTML is converted
 * to text, without images or `<style>` blocks and without link addresses.
 */
function readableBody(text: string | undefined, html: string | false): string {
  const plain = (text ?? "").trim();
  if (plain !== "" || html === false) return plain;
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  }).trim();
}
