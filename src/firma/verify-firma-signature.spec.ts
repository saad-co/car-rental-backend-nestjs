import { createHmac } from "node:crypto";
import { verifyFirmaSignature } from "./verify-firma-signature.js";

const SECRET = "a-made-up-firma-signing-secret";
const OLD_SECRET = "the-previous-made-up-secret";
const BODY = Buffer.from(
  '{"id":"evt_1","type":"signing_request.completed","data":{"signing_request":{"id":"sr_1"}}}',
);

/** A header made the way firma documents it, independent of the code under test. */
function sign(secret: string, body: Buffer, t = "1790000000"): string {
  const digest = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${t}.`), body]))
    .digest("hex");
  return `t=${t},v1=${digest}`;
}

function verify(
  overrides: Partial<Parameters<typeof verifyFirmaSignature>[0]> = {},
) {
  return verifyFirmaSignature({
    secret: SECRET,
    signatureHeader: sign(SECRET, BODY),
    rawBody: BODY,
    ...overrides,
  });
}

describe("verifyFirmaSignature", () => {
  it("accepts a correctly signed delivery", () => {
    expect(verify()).toEqual({ valid: true });
  });

  it("rejects a body changed by one byte", () => {
    const result = verify({
      rawBody: Buffer.from(BODY.toString().replace("sr_1", "sr_2")),
    });
    expect(result).toEqual({
      valid: false,
      reason: "signature does not match",
    });
  });

  it("rejects a signature made with another secret", () => {
    const result = verify({ signatureHeader: sign("not-our-secret", BODY) });
    expect(result).toEqual({
      valid: false,
      reason: "signature does not match",
    });
  });

  it("rejects a changed timestamp (it is part of what is signed)", () => {
    const header = sign(SECRET, BODY).replace("t=1790000000", "t=1790000001");
    expect(verify({ signatureHeader: header })).toEqual({
      valid: false,
      reason: "signature does not match",
    });
  });

  it("accepts the old secret's signature during a rotation, even when the current header is wrong", () => {
    const result = verify({
      signatureHeader: sign("the-new-secret-we-do-not-have-yet", BODY),
      oldSignatureHeader: sign(SECRET, BODY),
    });
    expect(result).toEqual({ valid: true });
  });

  it("does not accept the old header when it is signed with a different secret", () => {
    const result = verify({
      signatureHeader: sign("other", BODY),
      oldSignatureHeader: sign(OLD_SECRET, BODY),
    });
    expect(result.valid).toBe(false);
  });

  it("does not refuse an old timestamp (a retry an hour later must still pass)", () => {
    expect(
      verify({ signatureHeader: sign(SECRET, BODY, "1500000000") }),
    ).toEqual({ valid: true });
  });

  it.each([
    ["no header at all", undefined],
    ["an empty header", ""],
  ])("rejects %s", (_name, header) => {
    expect(verify({ signatureHeader: header }).valid).toBe(false);
  });

  it.each([
    ["no t", "v1=abcd"],
    ["no v1", "t=1790000000"],
    ["no separators", "garbage"],
    ["a v1 that is not hex", "t=1790000000,v1=zzzz"],
    ["a v1 of the wrong length", "t=1790000000,v1=abcd"],
  ])("rejects a malformed header: %s", (_name, header) => {
    expect(verify({ signatureHeader: header }).valid).toBe(false);
  });
});
