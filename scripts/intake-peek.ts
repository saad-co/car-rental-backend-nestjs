/**
 * Developer tool: runs the intake's real mailbox reader (`ImapMailboxReader`) read-only and prints what
 * it sees. NOT part of the API. No AI call, nothing written to the database.
 *
 *   npm run intake:peek                    allow-listed emails in the whole inbox; details of the newest 5
 *   npm run intake:peek -- --after=21000   only emails with a UID above 21000
 *
 * Prints UIDs, Gmail ids, dates and sender addresses only (no subjects or bodies: they contain names).
 * Run it twice: the same UID must show the same Gmail id both times.
 *
 * Settings from `.env`: IMAP_HOST, IMAP_USER, IMAP_PASSWORD (IMAP_PORT optional, default 993).
 */
import { ImapMailboxReader } from "../src/email-intake/mailbox/imap-mailbox-reader.js";
import { parseRawEmail } from "../src/email-intake/verification/parse-raw-email.js";
import { ALLOWED_SENDERS } from "../src/email-intake/verification/sender-provider.js";

/** Reads a required setting from the environment; stops with a clear message if it is missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

const after = Number(
  process.argv
    .find((arg) => arg.startsWith("--after="))
    ?.slice("--after=".length) ?? 0,
);

const reader = new ImapMailboxReader({
  host: requireEnv("IMAP_HOST"),
  port: Number(process.env.IMAP_PORT ?? 993),
  user: requireEnv("IMAP_USER"),
  password: requireEnv("IMAP_PASSWORD"),
});

await reader.withInbox(async (session) => {
  const uids = await session.newUids(after, ALLOWED_SENDERS);
  console.log(`${reader.mailbox}: UIDVALIDITY ${session.uidValidity}`);
  console.log(
    `${uids.length} allow-listed emails with UID above ${after}` +
      (uids.length ? ` (UIDs ${uids[0]} to ${uids.at(-1)})` : ""),
  );

  for (const uid of uids.slice(-5)) {
    const message = await session.fetch(uid);
    const parsed = await parseRawEmail(message.raw);
    console.log(
      `  UID ${String(uid).padEnd(6)} Gmail id ${message.gmailMessageId.padEnd(20)} received ${message.receivedAt.toISOString()}  ${parsed.fromAddress ?? "(no sender)"}`,
    );
  }
});
