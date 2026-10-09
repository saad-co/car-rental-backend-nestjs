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
  /** Readable body text. If the email is HTML only, the markup (and `<style>`) is stripped. */
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
    .map((header) => header.line.slice(header.line.indexOf(":") + 1).replace(/\s+/g, " ").trim());

  return {
    fromAddress: parsed.from?.value[0]?.address?.toLowerCase() ?? null,
    subject: parsed.subject ?? "",
    date: parsed.date ?? null,
    authenticationResults,
    bodyText: (parsed.text ?? "").trim(),
  };
}
