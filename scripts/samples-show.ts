/**
 * Developer tool: shows every saved sample email so you can label it. Works offline, reads files only.
 *
 *   npm run samples:show            for each .eml: sender, subject, provider, and the first lines of the cleaned body
 *   npm run samples:show -- --full  same, with the whole cleaned body
 *
 * It also creates `labels.json` next to the samples (or adds the missing entries to it), never overwriting what
 * you wrote. Fill in the ground truth by hand for every email:
 *
 *   "is_payment":    true if it is an INCOMING payment to us; false for anything else (payouts, requests,
 *                    transfers out, "you paid/sent", statements, security notices, ...)
 *   "amount_cents":  the payment itself in whole cents (31785 for $317.85); null if not a payment
 *   "sender_name":   the payer's name as the email shows it; null if not a payment
 *   "sender_handle": the payer's email, phone or username if the email shows one, else null
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRawEmail } from "../src/email-intake/parse-raw-email.js";
import { providerFromSender } from "../src/email-intake/sender-provider.js";

/** Same folder `imap-peek` saves to: outside both repos, because real emails contain driver names. */
const samplesDir = path.resolve(process.env.IMAP_SAVE_DIR ?? "../mail-samples");
const labelsFile = path.join(samplesDir, "labels.json");
const full = process.argv.includes("--full");

interface Label {
  is_payment: boolean | null;
  amount_cents: number | null;
  sender_name: string | null;
  sender_handle: string | null;
}

await mkdir(samplesDir, { recursive: true });
const files = (await readdir(samplesDir)).filter((name) => name.endsWith(".eml")).sort();
const labels = await readLabels();

let added = 0;
for (const [index, file] of files.entries()) {
  const parsed = await parseRawEmail(await readFile(path.join(samplesDir, file)));
  console.log(`\n[${index + 1}/${files.length}] ${file}`);
  console.log(`  From:     ${parsed.fromAddress}   (provider: ${providerFromSender(parsed.fromAddress) ?? "NOT ON THE ALLOW-LIST"})`);
  console.log(`  Subject:  ${parsed.subject}`);
  console.log(`  Body:`);
  console.log(indent(bodyLines(parsed.bodyText)));

  if (!(file in labels)) {
    labels[file] = { is_payment: null, amount_cents: null, sender_name: null, sender_handle: null };
    added++;
  }
}

await writeFile(labelsFile, `${JSON.stringify(labels, null, 2)}\n`);
const unlabelled = Object.values(labels).filter((label) => label.is_payment === null).length;
console.log(`\n${files.length} emails. ${added} new entries added to ${labelsFile}`);
console.log(`${unlabelled} still have "is_payment": null and need your label.`);

/** The labels written so far, or an empty set if the file does not exist yet. */
async function readLabels(): Promise<Record<string, Label>> {
  try {
    return JSON.parse(await readFile(labelsFile, "utf8")) as Record<string, Label>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error; // a broken labels.json must be fixed by hand, never silently replaced
  }
}

/** Drops blank lines and lines that are only an image or link, then keeps the first 14 unless --full. */
function bodyLines(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^\[https?:\/\/[^\]]*\]$/.test(line));
  return full ? lines : lines.slice(0, 14);
}

function indent(lines: string[]): string {
  return lines.map((line) => `    ${line}`).join("\n");
}
