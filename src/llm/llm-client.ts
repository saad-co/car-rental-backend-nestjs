/** One request for a JSON answer from a language model. */
export interface LlmJsonRequest {
  /** The fixed instructions (the rules). */
  system: string;
  /** The data to work on: here, one email. */
  user: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
}

/**
 * The only thing the extractor needs from an LLM provider: "here are the rules, the data and a
 * JSON schema; give me the parsed JSON back". Each provider (Gemini now, OpenAI at go-live, B8)
 * is a small adapter behind this interface, and tests use a fake.
 *
 * Implementations must throw on any failure (network, quota, invalid JSON) and never return a
 * guess. The answer is still untrusted: it always goes through `validateExtraction`.
 */
export interface LlmJsonClient {
  generateJson(request: LlmJsonRequest): Promise<unknown>;
}

/**
 * Thrown by an adapter when the provider refuses because of a rate limit or quota (HTTP 429). Nothing is
 * wrong with the email: the same request works once the limit resets. The intake therefore retries these
 * on every run WITHOUT counting them toward giving up on the email (B49).
 */
export class LlmRateLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmRateLimitError";
  }
}
