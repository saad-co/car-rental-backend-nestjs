/**
 * Developer tool: runs the real AI extractor on the labelled sample emails and compares every
 * answer with your label (the ground truth). NOT part of the API.
 *
 *   npm run extract:eval                   every labelled email in ../mail-samples/labels.json
 *   npm run extract:eval -- --only=22138   only the files whose name contains "22138"
 *   npm run extract:eval -- --only=gonzobilling-2214
 *
 * Privacy (agreed 2026-10-10): before anything is sent, the payer's name (each word of it) and the
 * payer's email are replaced with fake ones, and the script refuses to send if any of them is still
 * in the text. Add other names to replace with REDACT_EXTRA=Name One,Name Two in .env.
 *
 * Needs LLM_API_KEY and LLM_MODEL in .env. Calls are made one at a time with a pause between them
 * (EVAL_DELAY_MS, default 4000) because the free Gemini tier is rate-limited.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@google/genai";
import { verifyDkim } from "../src/email-intake/dkim-verification.js";
import { GeminiJsonClient } from "../src/email-intake/gemini-client.js";
import { LlmPaymentExtractor } from "../src/email-intake/llm-payment-extractor.js";
import { parseRawEmail } from "../src/email-intake/parse-raw-email.js";
import {
  validateExtraction,
  type ExtractionInput,
  type ExtractionResult,
} from "../src/email-intake/payment-extraction.js";
import { providerFromSender } from "../src/email-intake/sender-provider.js";

interface Label {
  is_payment: boolean | null;
  amount_cents: number | null;
  sender_name: string | null;
  sender_handle: string | null;
}

/** Reads a required setting from the environment; stops with a clear message if it is missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

const samplesDir = path.resolve(process.env.IMAP_SAVE_DIR ?? "../mail-samples");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const delayMs = Number(process.env.EVAL_DELAY_MS ?? 4000);
const extraNames = (process.env.REDACT_EXTRA ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
/** The one server whose Authentication-Results we trust: Gmail's (D38), as in the real pipeline. */
const trustedServerId = process.env.IMAP_TRUSTED_SERVER ?? "mx.google.com";
const FAKE_EMAIL = "payer@example.com";
const FAKE_WORDS = ["Pat", "Example", "Sample", "Tester", "Demo", "Placeholder"];

const extractor = new LlmPaymentExtractor(
  new GeminiJsonClient({ apiKey: requireEnv("LLM_API_KEY"), model: requireEnv("LLM_MODEL") }),
);
const labels = JSON.parse(await readFile(path.join(samplesDir, "labels.json"), "utf8")) as Record<
  string,
  Label
>;
const files = Object.keys(labels)
  .filter((file) => only === undefined || file.includes(only))
  .sort();

type Outcome = "PASS" | "FAIL" | "ERROR";
const results: { provider: string; outcome: Outcome }[] = [];
console.log(`Evaluating ${files.length} emails with ${process.env.LLM_MODEL} ...\n`);

for (const [index, file] of files.entries()) {
  const label = labels[file];
  const prefix = `[${index + 1}/${files.length}] ${file}`;
  let provider = "?";
  try {
    if (!label || label.is_payment === null) throw new Error("not labelled yet");
    const checked = await evaluate(file, label);
    provider = checked.provider;
    results.push({ provider, outcome: checked.pass ? "PASS" : "FAIL" });
    console.log(`${checked.pass ? "PASS" : "FAIL"} ${prefix} (${provider}): ${checked.detail}`);
    if (!checked.pass) console.log(`     model said: ${JSON.stringify(checked.output)}`);
  } catch (error) {
    // Recorded and shown, never hidden: an error counts against the run like a failure.
    results.push({ provider, outcome: "ERROR" });
    console.log(`ERROR ${prefix}: ${describeError(error)}`);
  }
  if (index < files.length - 1) await sleep(delayMs);
}

printSummary();

/** Runs one email through the same steps the pipeline will use, and compares with the label. */
async function evaluate(
  file: string,
  label: Label,
): Promise<{ provider: string; pass: boolean; detail: string; output: unknown }> {
  const parsed = await parseRawEmail(await readFile(path.join(samplesDir, file)));
  const provider = providerFromSender(parsed.fromAddress);
  if (provider === null) throw new Error(`sender ${parsed.fromAddress} is not on the allow-list`);

  const dkim = verifyDkim({
    authenticationResults: parsed.authenticationResults,
    trustedServerId,
    provider,
  });
  if (!dkim.verified) throw new Error(`DKIM not verified (${dkim.reason}), so the pipeline would never extract it`);

  process.stdout.write(`     asking ${process.env.LLM_MODEL} ...\r`);

  const redact = makeRedactor(label);
  const input: ExtractionInput = {
    provider,
    subject: redact.apply(parsed.subject),
    bodyText: redact.apply(parsed.bodyText),
  };
  redact.assertGone(`${input.subject}\n${input.bodyText}`);

  const output = await withOneRetryOnRateLimit(() => extractor.extract(input));
  const { pass, detail } = compare(label, validateExtraction(output, input), redact);
  return { provider, pass, detail, output };
}

/**
 * Replaces the payer's email and every word (3+ letters) of the payer's name with fake ones,
 * keeping upper/lower case so the text still reads naturally. Word edges are letters only, so
 * names inside contract titles like RA_JANE_DOE_IL_... are replaced too.
 */
function makeRedactor(label: Label) {
  const words = [
    ...new Set(
      [label.sender_name, ...extraNames]
        .filter((name): name is string => name !== null)
        .flatMap((name) => name.split(/[^A-Za-z]+/))
        .filter((word) => word.length >= 3)
        .map((word) => word.toLowerCase()),
    ),
  ];
  const wordPattern = (word: string) => new RegExp(`(?<![A-Za-z])${escapeRegExp(word)}(?![A-Za-z])`, "gi");
  const handlePattern = label.sender_handle ? new RegExp(escapeRegExp(label.sender_handle), "gi") : null;

  return {
    apply(text: string): string {
      let result = handlePattern ? text.replace(handlePattern, FAKE_EMAIL) : text;
      words.forEach((word, i) => {
        const fake = FAKE_WORDS[i % FAKE_WORDS.length] ?? "Pat";
        result = result.replace(wordPattern(word), (found) =>
          found === found.toUpperCase() ? fake.toUpperCase() : found === found.toLowerCase() ? fake.toLowerCase() : fake,
        );
      });
      return result;
    },
    /** Refuses to continue if any real name or the real email survived. */
    assertGone(text: string): void {
      const left = words.filter((word) => wordPattern(word).test(text));
      if (handlePattern?.test(text)) left.push("(payer email)");
      if (left.length > 0) throw new Error(`redaction failed, not sent: ${left.join(", ")} still present`);
    },
  };
}

/** Compares what survived validation with the label. Names and handles are compared ignoring case and spacing. */
function compare(
  label: Label,
  result: ExtractionResult,
  redact: ReturnType<typeof makeRedactor>,
): { pass: boolean; detail: string } {
  if (!label.is_payment) {
    return result.kind === "not_payment"
      ? { pass: true, detail: "not a payment, as labelled" }
      : { pass: false, detail: `expected not_payment, got ${describeResult(result)}` };
  }
  if (result.kind !== "payment") return { pass: false, detail: `expected a payment, got ${describeResult(result)}` };

  const got = result.payment;
  const expectedName = redact.apply(label.sender_name ?? "");
  const expectedHandle = label.sender_handle === null ? null : FAKE_EMAIL;
  const problems: string[] = [];
  if (got.amountCents !== label.amount_cents) problems.push(`amount ${got.amountCents} vs label ${label.amount_cents}`);
  if (normalise(got.senderName) !== normalise(expectedName)) problems.push(`name "${got.senderName}" vs "${expectedName}"`);
  if (normalise(got.senderHandle) !== normalise(expectedHandle)) problems.push(`handle "${got.senderHandle}" vs "${expectedHandle}"`);

  return problems.length === 0
    ? { pass: true, detail: `${got.amountCents} cents from "${got.senderName}" (confidence ${got.confidence})` }
    : { pass: false, detail: problems.join("; ") };
}

function describeResult(result: ExtractionResult): string {
  if (result.kind === "failed") return `failed validation: ${result.reason}`;
  if (result.kind === "payment") return `a payment of ${result.payment.amountCents} cents`;
  return "not_payment";
}

/** The free tier answers 429 when called too often: wait a minute and try once more, then give up loudly. */
async function withOneRetryOnRateLimit<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 429) throw error;
    console.log("     rate-limited (429): waiting 60 s, then one retry ...");
    await sleep(60_000);
    return call();
  }
}

function printSummary(): void {
  console.log("\nSummary per provider:");
  const providers = [...new Set(results.map((result) => result.provider))].sort();
  for (const provider of providers) {
    const mine = results.filter((result) => result.provider === provider);
    const count = (outcome: Outcome) => mine.filter((result) => result.outcome === outcome).length;
    console.log(
      `  ${provider.padEnd(12)} ${count("PASS")}/${mine.length} pass` +
        (count("FAIL") ? `, ${count("FAIL")} fail` : "") +
        (count("ERROR") ? `, ${count("ERROR")} error` : ""),
    );
  }
  const passed = results.filter((result) => result.outcome === "PASS").length;
  console.log(`  ${"all".padEnd(12)} ${passed}/${results.length} pass`);
  if (passed < results.length) process.exitCode = 1;
}

function normalise(value: string | null): string | null {
  return value === null ? null : value.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const status = error instanceof ApiError ? ` (HTTP ${error.status})` : "";
  return `${error.message}${status}`;
}
