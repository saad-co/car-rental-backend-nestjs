/**
 * Throwaway developer tool: proves we can read the payment mailbox over IMAP. NOT part of the API.
 *
 * Read-only: the mailbox is opened read-only, so nothing is marked as read, moved or deleted.
 *
 *   npm run imap:peek                          sender counts for the newest messages + the newest few
 *   npm run imap:peek -- --from=cash@square.com   the newest messages from one sender (searches everything)
 *   npm run imap:peek -- --from=cash@square.com --save   same, and saves each listed message as a .eml file
 *   npm run imap:peek -- 123                   saves UID 123 as a .eml file and shows what our own
 *                                              parseRawEmail + verifyDkim make of it
 *   npm run imap:peek -- 123 --body            same, and also prints the cleaned body text
 *                                              (contains real names and amounts)
 *
 * Settings come from `.env` (see `.env.example`): IMAP_HOST, IMAP_USER, IMAP_PASSWORD, IMAP_TRUSTED_SERVER.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import {
  EXPECTED_DKIM_DOMAIN,
  verifyDkim,
  type EmailProvider,
} from "../src/email-intake/dkim-verification.js";
import { parseRawEmail } from "../src/email-intake/parse-raw-email.js";

/** Reads a required setting from the environment; stops with a clear message if it is missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

const host = requireEnv("IMAP_HOST");
const user = requireEnv("IMAP_USER");
const password = requireEnv("IMAP_PASSWORD");
/** The name our mail server puts at the start of its Authentication-Results header (Gmail: mx.google.com). */
const trustedServerId = requireEnv("IMAP_TRUSTED_SERVER");
const port = Number(process.env.IMAP_PORT ?? 993);
const listCount = Number(process.env.IMAP_LIST_COUNT ?? 10);
/** How many of the newest messages are scanned for the per-sender counts (the inbox holds thousands). */
const scanCount = Number(process.env.IMAP_SCAN_COUNT ?? 300);
/** Outside both repos on purpose: real emails contain driver names and must not be committed. */
const saveDir = path.resolve(process.env.IMAP_SAVE_DIR ?? "../mail-samples");

const args = process.argv.slice(2);
const showBody = args.includes("--body");
const fromFilter = args.find((arg) => arg.startsWith("--from="))?.slice("--from=".length);
const saveAll = args.includes("--save");
const uidArg = args.find((arg) => !arg.startsWith("--"));

const client = new ImapFlow({
  host,
  port,
  secure: true,
  auth: { user, pass: password },
  logger: false,
});

await client.connect();
try {
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    if (uidArg !== undefined) {
      await inspectOne(Number(uidArg));
    } else if (fromFilter) {
      await listFromSender(fromFilter);
    } else {
      await listNewest();
    }
  } finally {
    lock.release();
  }
} finally {
  await client.logout();
}

interface Row {
  uid: number;
  date: string;
  from: string;
  subject: string;
}

/** Turns an IMAP envelope into a printable row. Envelope data only: no bodies. */
function toRow(message: { uid: number; envelope?: { date?: Date; from?: { address?: string }[]; subject?: string } }): Row {
  const envelope = message.envelope;
  return {
    uid: message.uid,
    date: envelope?.date ? envelope.date.toISOString().slice(0, 16).replace("T", " ") : "no date",
    from: envelope?.from?.[0]?.address ?? "no sender",
    subject: envelope?.subject ?? "",
  };
}

function printRows(rows: Row[]): void {
  rows.forEach((row) =>
    console.log(`  UID ${String(row.uid).padEnd(6)} ${row.date}  ${row.from.padEnd(34)} ${row.subject}`),
  );
}

/** Prints how many of the newest messages came from each sender address, then the newest few. */
async function listNewest(): Promise<void> {
  const total = client.mailbox ? client.mailbox.exists : 0;
  console.log(`${user}: ${total} messages in INBOX.`);
  if (total === 0) return;

  const rows: Row[] = [];
  const firstSeq = Math.max(1, total - scanCount + 1);
  for await (const message of client.fetch(`${firstSeq}:*`, { uid: true, envelope: true })) {
    rows.push(toRow(message));
  }

  const bySender = new Map<string, number>();
  for (const row of rows) bySender.set(row.from, (bySender.get(row.from) ?? 0) + 1);
  console.log(`\nMessages per sender address (newest ${rows.length} of ${total}):`);
  [...bySender.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([from, count]) => console.log(`  ${String(count).padStart(5)}  ${from}`));

  console.log(`\nNewest ${Math.min(listCount, rows.length)}:`);
  printRows(rows.slice(-listCount).reverse());
  console.log("\nTo save one and check it: npm run imap:peek -- <UID>");
}

/** Searches the whole inbox for one sender and prints the newest matches. */
async function listFromSender(sender: string): Promise<void> {
  const found = await client.search({ from: sender }, { uid: true });
  const uids = found === false ? [] : found;
  console.log(`${uids.length} messages from "${sender}" in INBOX (all time).`);
  if (uids.length === 0) return;

  const newest = uids.slice(-listCount);
  const rows: Row[] = [];
  for await (const message of client.fetch(newest, { uid: true, envelope: true }, { uid: true })) {
    rows.push(toRow(message));
  }
  console.log(`\nNewest ${rows.length}:`);
  printRows(rows.reverse());
  if (saveAll) {
    console.log("");
    for (const row of rows) {
      const { file } = await saveMessage(row.uid);
      console.log(`Saved UID ${row.uid} to ${file}`);
    }
  } else {
    console.log("\nTo save one and check it: npm run imap:peek -- <UID>   (or add --save to save all of these)");
  }
}

/** Downloads one message by UID and writes it as a .eml file in the samples folder (outside both repos). */
async function saveMessage(uid: number): Promise<{ source: Buffer; file: string }> {
  const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!message || !message.source) throw new Error(`No message with UID ${uid} in INBOX.`);

  await mkdir(saveDir, { recursive: true });
  const file = path.join(saveDir, `${user.split("@")[0]}-${uid}.eml`);
  await writeFile(file, message.source);
  return { source: message.source, file };
}

/** Saves one message as .eml, then shows what our own functions make of it. The body is printed only with --body. */
async function inspectOne(uid: number): Promise<void> {
  if (!Number.isInteger(uid) || uid < 1) throw new Error("The UID must be a positive whole number.");

  const { source, file } = await saveMessage(uid);
  console.log(`Saved to ${file}\n`);

  const parsed = await parseRawEmail(source);
  console.log(`From:    ${parsed.fromAddress}`);
  console.log(`Subject: ${parsed.subject}`);
  console.log(`Date:    ${parsed.date?.toISOString() ?? "none"}\n`);

  console.log(`Authentication-Results headers (${parsed.authenticationResults.length}), top to bottom:`);
  parsed.authenticationResults.forEach((header, i) => console.log(`  [${i}] ${header}`));

  if (showBody) {
    console.log("\nBody text as parseRawEmail returns it (this is what the LLM will be given):");
    console.log("-----");
    console.log(parsed.bodyText);
    console.log("-----");
  }

  console.log(`\nverifyDkim with trusted server "${trustedServerId}":`);
  for (const provider of Object.keys(EXPECTED_DKIM_DOMAIN) as EmailProvider[]) {
    const verdict = verifyDkim({
      authenticationResults: parsed.authenticationResults,
      trustedServerId,
      provider,
    });
    console.log(`  ${provider.padEnd(12)} ${verdict.verified ? "VERIFIED" : `rejected: ${verdict.reason}`}`);
  }
}
