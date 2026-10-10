import { EXPECTED_DKIM_DOMAINS } from "./dkim-verification.js";
import type { LlmJsonClient, LlmJsonRequest } from "./llm-client.js";
import {
  EXTRACTION_RULES,
  EXTRACTION_SCHEMA,
  LlmPaymentExtractor,
  MAX_BODY_CHARS,
  PROVIDER_HINTS,
  buildExtractionRequest,
} from "./llm-payment-extractor.js";
import type { ExtractionInput } from "./payment-extraction.js";

/** A fake LLM: remembers what it was asked and answers with a fixed value (or fails). */
class FakeLlm implements LlmJsonClient {
  requests: LlmJsonRequest[] = [];
  constructor(private readonly answer: () => Promise<unknown>) {}
  generateJson(request: LlmJsonRequest): Promise<unknown> {
    this.requests.push(request);
    return this.answer();
  }
}

const zelle: ExtractionInput = {
  provider: "zelle_chase",
  subject: "You received money with Zelle®",
  bodyText: "PAT EXAMPLE SENT YOU MONEY\nAmount $54.00 Sent on Oct 09, 2026",
};

describe("buildExtractionRequest", () => {
  it("sends the rules, the schema, and only the provider, subject and body", () => {
    const request = buildExtractionRequest(zelle);
    expect(request.system).toBe(EXTRACTION_RULES);
    expect(request.schema).toBe(EXTRACTION_SCHEMA);
    expect(request.user).toContain("Provider: zelle_chase");
    expect(request.user).toContain(`Subject: ${zelle.subject}`);
    expect(request.user).toContain(zelle.bodyText);
  });

  it("includes the hint for this provider and no other provider's", () => {
    const request = buildExtractionRequest({ ...zelle, provider: "stripe" });
    expect(request.user).toContain(PROVIDER_HINTS.stripe);
    expect(request.user).not.toContain(PROVIDER_HINTS.chime);
    expect(request.user).not.toContain(PROVIDER_HINTS.zelle_chase);
  });

  it("cuts a very long body and says so", () => {
    const long = "x".repeat(MAX_BODY_CHARS + 500);
    const request = buildExtractionRequest({ ...zelle, bodyText: long });
    expect(request.user).toContain("[... rest of the email cut ...]");
    expect(request.user.length).toBeLessThan(MAX_BODY_CHARS + 2_000);
  });
});

describe("EXTRACTION_SCHEMA", () => {
  it("requires every field and allows only our five providers", () => {
    const properties = EXTRACTION_SCHEMA.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(EXTRACTION_SCHEMA.required).toEqual(Object.keys(properties));
    expect(properties.provider?.enum).toEqual(
      Object.keys(EXPECTED_DKIM_DOMAINS),
    );
  });
});

describe("LlmPaymentExtractor", () => {
  it("asks the LLM once and returns its answer untouched", async () => {
    const answer = { is_payment: true, anything: "the validator decides" };
    const llm = new FakeLlm(() => Promise.resolve(answer));
    const result = await new LlmPaymentExtractor(llm).extract(zelle);
    expect(result).toBe(answer);
    expect(llm.requests).toHaveLength(1);
  });

  it("lets an LLM error through instead of hiding it", async () => {
    const llm = new FakeLlm(() => Promise.reject(new Error("quota exceeded")));
    await expect(new LlmPaymentExtractor(llm).extract(zelle)).rejects.toThrow(
      "quota exceeded",
    );
  });
});
