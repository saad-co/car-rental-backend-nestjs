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
 * Thrown by an adapter when the AI could not answer for a reason that is NOT about the email and goes away by
 * itself: a rate limit or quota (HTTP 429) or the provider being overloaded or down (HTTP 500/502/503/504).
 * The same request works later, so the intake retries it on every run WITHOUT counting a strike toward giving
 * up on the email, and without moving past it (B49, and the 503 spike seen on 2026-10-13).
 */
export class LlmTemporaryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmTemporaryError";
  }
}

/** The provider refused because of a rate limit or quota (HTTP 429). */
export class LlmRateLimitError extends LlmTemporaryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmRateLimitError";
  }
}

/** The provider was overloaded or down (HTTP 500, 502, 503 or 504): "high demand", try again later. */
export class LlmUnavailableError extends LlmTemporaryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmUnavailableError";
  }
}
