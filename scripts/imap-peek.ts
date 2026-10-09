/**
 * Throwaway developer tool: proves we can read Mailcow mailboxes over IMAP. NOT part of the API.
 *
 * Read-only: each mailbox is opened read-only, so nothing is marked as read, moved or deleted.
 *
 *   npm run imap:peek                          every configured mailbox: sender counts + newest messages
 *   npm run imap:peek -- payashwood 123        saves UID 123 of that mailbox as a .eml file and shows what
 *                                              our own parseRawEmail + verifyDkim make of it
 *   npm run imap:peek -- payashwood 123 --body same, and also prints the cleaned body text
 *                                              (contains real names and amounts)
 *
 * Mailboxes come from `.env`: IMAP_USER_1 / IMAP_PASSWORD_1, IMAP_USER_2 / IMAP_PASSWORD_2, and so on
 * (or the single IMAP_USER / IMAP_PASSWORD). See `.env.example`.
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

interface Account {
  user: string;
  password: string;
}

/** Reads a required setting from the environment; stops with a clear message if it is missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

/** Numbered pairs (IMAP_USER_1, IMAP_USER_2, ...) if present, otherwise the single IMAP_USER pair. */
function loadAccounts(): Account[] {
  const accounts: Account[] = [];
  for (let n = 1; process.env[`IMAP_USER_${n}`] !== undefined; n++) {
    accounts.push({ user: requireEnv(`IMAP_USER_${n}`), password: requireEnv(`IMAP_PASSWORD_${n}`) });
  }
  if (accounts.length === 0) {
    accounts.push({ user: requireEnv("IMAP_USER"), password: requireEnv("IMAP_PASSWORD") });
  }
  return accounts;
}

const host = requireEnv("IMAP_HOST");
const port = Number(process.env.IMAP_PORT ?? 993);
const listCount = Number(process.env.IMAP_LIST_COUNT ?? 10);
/** The name our mail server puts at the start of its Authentication-Results header. Check the output and adjust. */
const trustedServerId = process.env.IMAP_TRUSTED_SERVER ?? host;
/** Outside both repos on purpose: real emails contain driver names and must not be committed. */
const saveDir = path.resolve(process.env.IMAP_SAVE_DIR ?? "../mail-samples");

const args = process.argv.slice(2);
const showBody = args.includes("--body");
const positional = args.filter((arg) => !arg.startsWith("--"));
const accounts = loadAccounts();

let failed = false;
if (positional.length === 0) {
  for (const account of accounts) {
    console.log(`\n=== ${account.user} ===`);
    try {
      await withMailbox(account, (client) => listMailbox(client));
    } catch (error) {
      // One bad login must not hide the other mailboxes, but it must be loud and fail the command.
      failed = true;
      console.error(`FAILED to read ${account.user}: ${describeError(error)}`);
    }
  }
} else {
  const uid = Number(positional[positional.length - 1]);
  const account = pickAccount(positional.length > 1 ? positional[0] : undefined);
  await withMailbox(account, (client) => inspectOne(client, account.user, uid));
}
if (failed) process.exitCode = 1;

/** Chooses the mailbox whose address starts with `prefix` (e.g. "payashwood"); optional if only one is configured. */
function pickAccount(prefix: string | undefined): Account {
  if (prefix === undefined) {
    const only = accounts[0];
    if (accounts.length !== 1 || !only) {
      throw new Error("Several mailboxes are configured. Say which: npm run imap:peek -- payashwood 123");
    }
    return only;
  }
  const matches = accounts.filter((account) => account.user.toLowerCase().startsWith(prefix.toLowerCase()));
  const match = matches[0];
  if (matches.length !== 1 || !match) {
    throw new Error(`"${prefix}" matches ${matches.length} configured mailboxes. Configured: ${accounts.map((a) => a.user).join(", ")}`);
  }
  return match;
}

/** Connects, opens INBOX read-only, runs `work`, and always releases the lock and logs out. */
async function withMailbox(account: Account, work: (client: ImapFlow) => Promise<void>): Promise<void> {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: account.user, pass: account.password },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      await work(client);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Prints how many messages came from each sender address, then the newest messages. Envelope data only: no bodies. */
async function listMailbox(client: ImapFlow): Promise<void> {
  const total = client.mailbox ? client.mailbox.exists : 0;
  console.log(`${total} messages in INBOX.`);
  if (total === 0) return;

  const rows: { uid: number; date: string; from: string; subject: string }[] = [];
  for await (const message of client.fetch("1:*", { uid: true, envelope: true })) {
    const envelope = message.envelope;
    rows.push({
      uid: message.uid,
      date: envelope?.date ? envelope.date.toISOString().slice(0, 16).replace("T", " ") : "no date",
      from: envelope?.from?.[0]?.address ?? "no sender",
      subject: envelope?.subject ?? "",
    });
  }

  const bySender = new Map<string, number>();
  for (const row of rows) bySender.set(row.from, (bySender.get(row.from) ?? 0) + 1);
  console.log("\nMessages per sender address:");
  [...bySender.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([from, count]) => console.log(`  ${String(count).padStart(5)}  ${from}`));

  console.log(`\nNewest ${Math.min(listCount, rows.length)}:`);
  rows
    .slice(-listCount)
    .reverse()
    .forEach((row) => console.log(`  UID ${String(row.uid).padEnd(6)} ${row.date}  ${row.from.padEnd(34)} ${row.subject}`));
  console.log("\nTo save one and check it: npm run imap:peek -- <mailbox> <UID>");
}

/** Saves one message as .eml, then shows what our own functions make of it. The body is printed only with --body. */
async function inspectOne(client: ImapFlow, user: string, uid: number): Promise<void> {
  if (!Number.isInteger(uid) || uid < 1) throw new Error("The UID must be a positive whole number.");

  const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!message || !message.source) throw new Error(`No message with UID ${uid} in ${user}.`);

  await mkdir(saveDir, { recursive: true });
  const file = path.join(saveDir, `${user.split("@")[0]}-${uid}.eml`);
  await writeFile(file, message.source);
  console.log(`Saved to ${file}\n`);

  const parsed = await parseRawEmail(message.source);
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

/** Error text for the console, including the server's own reason (e.g. for a failed login) when there is one. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const serverReason = (error as { responseText?: string }).responseText;
  return serverReason ? `${error.message} (${serverReason})` : error.message;
}
