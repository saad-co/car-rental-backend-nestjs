import { likePattern, phoneDigits } from "./search.js";

describe("likePattern", () => {
  it("finds the text anywhere", () => {
    expect(likePattern("pat")).toBe("%pat%");
  });

  it("escapes the user's own wildcards and backslash, so they are searched as plain characters", () => {
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c:\\x")).toBe("%c:\\\\x%");
  });
});

describe("phoneDigits", () => {
  it("keeps only the digits of a phone typed in any format", () => {
    expect(phoneDigits("(312) 555-01")).toBe("31255501");
  });

  it("ignores searches with fewer than 3 digits", () => {
    expect(phoneDigits("pat")).toBeNull();
    expect(phoneDigits("unit 12")).toBeNull();
  });
});
