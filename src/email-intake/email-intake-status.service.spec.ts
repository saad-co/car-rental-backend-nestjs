import { describeError } from "./email-intake-status.service.js";

describe("describeError", () => {
  it("uses the message of an error", () => {
    expect(describeError(new Error("IMAP login failed"))).toBe(
      "IMAP login failed",
    );
  });

  it("appends the cause, so the reason is readable", () => {
    const error = new Error("Connection failed", {
      cause: new Error("ECONNRESET"),
    });
    expect(describeError(error)).toBe("Connection failed: ECONNRESET");
  });

  it("does not repeat a cause that says the same", () => {
    const error = new Error("same", { cause: new Error("same") });
    expect(describeError(error)).toBe("same");
  });

  it("handles things that are not errors", () => {
    expect(describeError("plain text")).toBe("plain text");
    expect(describeError(undefined)).toBe("Unknown error");
    expect(describeError(new Error("  "))).toBe("Unknown error");
  });

  it("cuts a very long message", () => {
    const text = describeError(new Error("x".repeat(2_000)));
    expect(text).toHaveLength(500);
    expect(text.endsWith("…")).toBe(true);
  });
});
