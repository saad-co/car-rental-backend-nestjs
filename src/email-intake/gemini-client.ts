import { GoogleGenAI } from "@google/genai";
import type { LlmJsonClient, LlmJsonRequest } from "./llm-client.js";

export interface GeminiClientOptions {
  /** From Google AI Studio. Read from `LLM_API_KEY`; never hard-coded. */
  apiKey: string;
  /** e.g. `gemini-flash-latest` for trials; pin an exact model name before go-live. */
  model: string;
  /** Give up on one request after this long (default 60 s), instead of waiting forever. */
  timeoutMs?: number;
}

/**
 * `LlmJsonClient` on top of Google's Gemini API (`@google/genai`). It forces a JSON answer that
 * follows the request's schema (`responseMimeType` + `responseJsonSchema`) and parses it.
 *
 * It never guesses: no answer, or an answer that is not JSON, is an error, and any error from the
 * API (e.g. `ApiError` with `status` 429 when rate-limited) is passed on unchanged.
 */
export class GeminiJsonClient implements LlmJsonClient {
  private readonly ai: GoogleGenAI;

  constructor(private readonly options: GeminiClientOptions) {
    if (!options.apiKey)
      throw new Error("Gemini API key is missing (LLM_API_KEY).");
    if (!options.model) throw new Error("Gemini model is missing (LLM_MODEL).");
    this.ai = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        timeout: options.timeoutMs ?? 60_000,
        // The SDK would otherwise retry 429 and 5xx up to 5 times, waiting up to 60 s each time,
        // silently. Our caller decides instead and every failure is visible: the evaluation
        // retries once after a pause; the pipeline retries the email on its next run (D40).
        retryOptions: { attempts: 1 },
      },
    });
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const response = await this.ai.models.generateContent({
      model: this.options.model,
      contents: request.user,
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseJsonSchema: request.schema,
        // Extraction is not creative work: the same email should give the same answer.
        temperature: 0,
      },
    });

    const text = response.text;
    if (!text) {
      const reason = response.candidates?.[0]?.finishReason ?? "unknown";
      throw new Error(`Gemini returned no answer (finish reason: ${reason}).`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(
        `Gemini's answer is not valid JSON: ${text.slice(0, 200)}`,
        {
          cause: error,
        },
      );
    }
  }
}
