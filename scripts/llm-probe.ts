/**
 * Developer tool: which Gemini models can we use, and how fast does one answer with "thinking" on or off?
 * Sends a tiny made-up request (no real email data). NOT part of the API.
 *
 *   npm run llm:probe                     lists the flash models, then times LLM_MODEL three ways
 *   npm run llm:probe -- --model=<name>   times that model instead
 *
 * Why: extraction does not need the model's internal reasoning ("thinking"), which makes answers
 * slow. Gemini switches it off in one of two ways depending on the model (thinkingBudget: 0 on
 * some, thinkingLevel: MINIMAL on newer ones; the wrong one is an error), so we measure instead
 * of guessing.
 */
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

const model =
  process.argv.find((arg) => arg.startsWith("--model="))?.slice("--model=".length) ??
  requireEnv("LLM_MODEL");
const ai = new GoogleGenAI({
  apiKey: requireEnv("LLM_API_KEY"),
  httpOptions: { timeout: 90_000, retryOptions: { attempts: 1 } },
});

console.log("Flash models available to this key:");
for await (const found of await ai.models.list()) {
  if (found.name?.includes("flash")) {
    console.log(`  ${found.name}${found.thinking ? "   (thinking model)" : ""}`);
  }
}

const variants: { label: string; thinkingConfig?: ThinkingConfig }[] = [
  { label: "default" },
  { label: "thinkingBudget 0", thinkingConfig: { thinkingBudget: 0 } },
  { label: "thinkingLevel MINIMAL", thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
];

console.log(`\nTiming ${model} on a tiny JSON request:`);
for (const variant of variants) {
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model,
      contents: "Subject: Pat Example paid you $12.00",
      config: {
        systemInstruction: "Extract the amount in cents and the payer's name.",
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: { amount_cents: { type: "integer" }, payer: { type: "string" } },
          required: ["amount_cents", "payer"],
        },
        temperature: 0,
        ...(variant.thinkingConfig ? { thinkingConfig: variant.thinkingConfig } : {}),
      },
    });
    console.log(`  ${variant.label.padEnd(22)} ${Date.now() - started} ms   ${response.text?.trim()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : String(error);
    console.log(`  ${variant.label.padEnd(22)} ${Date.now() - started} ms   ERROR: ${message}`);
  }
}
