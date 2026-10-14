import { createHmac } from "node:crypto";
import { verifyQuoSignature } from "./verify-quo-signature.js";

const SECRET_BYTES = Buffer.from("a-test-signing-key-of-some-length");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const NOW = new Date("2026-10-14T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const BODY = Buffer.from(
  '{"type":"message.received","data":{"resource":{"id":"AC1"}}}',
);

/** A signature made the way Quo documents it, independent of the code under test. */
function sign(id: string, timestamp: string, body: Buffer, key = SECRET_BYTES) {
  const digest = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]))
    .digest("base64");
  return `v1,${digest}`;
}

function verify(
  overrides: Partial<Parameters<typeof verifyQuoSignature>[0]> = {},
) {
  return verifyQuoSignature({
    secret: SECRET,
    webhookId: "msg_1",
    timestamp: TIMESTAMP,
    signatureHeader: sign("msg_1", TIMESTAMP, BODY),
    rawBody: BODY,
    now: NOW,
    ...overrides,
  });
}

describe("verifyQuoSignature", () => {
  it("accepts a correctly signed delivery", () => {
    expect(verify()).toEqual({ valid: true });
  });

  it("rejects a body changed by one byte", () => {
    const result = verify({
      rawBody: Buffer.from(BODY.toString().replace("AC1", "AC2")),
    });
    expect(result).toEqual({
      valid: false,
      reason: "signature does not match",
    });
  });

  it("rejects a signature made with another secret", () => {
    const header = sign(
      "msg_1",
      TIMESTAMP,
      BODY,
      Buffer.from("some-other-secret-entirely-different"),
    );
    expect(verify({ signatureHeader: header }).valid).toBe(false);
  });

  it("rejects a different webhook-id (the id is part of what is signed)", () => {
    expect(verify({ webhookId: "msg_2" }).valid).toBe(false);
  });

  it("rejects a correctly signed but old delivery (replay)", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 301);
    const result = verify({
      timestamp: old,
      signatureHeader: sign("msg_1", old, BODY),
    });
    expect(result).toEqual({
      valid: false,
      reason: "webhook-timestamp is too far from the current time",
    });
  });

  it("accepts when only one of several signatures matches", () => {
    const header = `v1,bm90LXRoZS1yaWdodC1vbmU= ${sign("msg_1", TIMESTAMP, BODY)}`;
    expect(verify({ signatureHeader: header })).toEqual({ valid: true });
  });

  it("rejects missing headers without throwing", () => {
    expect(verify({ signatureHeader: undefined }).valid).toBe(false);
    expect(verify({ webhookId: undefined }).valid).toBe(false);
    expect(verify({ timestamp: "abc" }).valid).toBe(false);
  });

  it("throws when our own secret is unusable (a configuration mistake)", () => {
    expect(() => verify({ secret: "whsec_" })).toThrow("QUO_WEBHOOK_SECRET");
  });
});
