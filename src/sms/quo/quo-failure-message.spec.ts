import { QuoApiError } from "./quo-client.js";
import {
  describeQuoFailure,
  friendlyStoredError,
  isTextableUsNumber,
} from "./quo-failure-message.js";

const quo = (status: number, reason: string) =>
  new QuoApiError(
    status,
    `Quo refused POST /v1/messages (${status}): ${reason}`,
    reason,
  );

describe("describeQuoFailure", () => {
  it.each([
    [
      400,
      "At least one of the phone numbers in the `to` array is invalid",
      "not valid for texting",
    ],
    [400, "A2P registration not approved", "A2P registration"],
    [400, "something else", "refused the text as invalid"],
    [401, "Unauthorized", "API key"],
    [402, "Subscription expired", "no credits"],
    [403, "daily cap", "daily message limit"],
    [404, "Not found", "could not find"],
    [429, "slow down", "too many requests"],
    [500, "boom", "problem on its side"],
  ])(
    "explains a %i from Quo (%s) in plain words",
    (status, reason, expected) => {
      expect(describeQuoFailure(quo(status, reason))).toContain(expected);
    },
  );

  it("never shows Quo's technical words or status to the admin", () => {
    const text = describeQuoFailure(
      quo(
        400,
        "At least one of the phone numbers in the `to` array is invalid",
      ),
    );
    expect(text).not.toContain("`to`");
    expect(text).not.toContain("400");
    expect(text).not.toContain("POST");
  });

  it("explains an unreachable Quo and an unreadable answer", () => {
    expect(
      describeQuoFailure(
        new Error("Could not reach Quo (POST /v1/messages): fetch failed"),
      ),
    ).toContain("Could not reach Quo");
    expect(
      describeQuoFailure(new Error("Quo field 'x' is not a non-empty string.")),
    ).toContain("could not read");
    expect(describeQuoFailure(new Error("kaboom"))).toContain("server log");
  });
});

describe("isTextableUsNumber", () => {
  it("accepts real-looking US numbers", () => {
    expect(isTextableUsNumber("+13127362939")).toBe(true);
    expect(isTextableUsNumber("+13057210909")).toBe(true);
  });

  it("rejects numbers a US carrier cannot have", () => {
    expect(isTextableUsNumber("+11235550123")).toBe(false); // area code starts with 1
    expect(isTextableUsNumber("+13121550123")).toBe(false); // exchange starts with 1
    expect(isTextableUsNumber("+0312736293")).toBe(false);
    expect(isTextableUsNumber("+923001234567")).toBe(false);
  });
});

describe("friendlyStoredError", () => {
  it("turns Quo's raw words saved before the plain messages into the plain sentence", () => {
    const raw =
      "Quo refused POST /v1/messages (400): At least one of the phone numbers in the `to` array is invalid";
    const text = friendlyStoredError(raw);
    expect(text).toContain("not valid for texting");
    expect(text).not.toContain("POST");
  });

  it("leaves anything else unchanged", () => {
    expect(friendlyStoredError(null)).toBeNull();
    expect(friendlyStoredError("The Quo account has no credits left.")).toBe(
      "The Quo account has no credits left.",
    );
    expect(friendlyStoredError("Quo: 30007")).toBe("Quo: 30007");
  });
});
