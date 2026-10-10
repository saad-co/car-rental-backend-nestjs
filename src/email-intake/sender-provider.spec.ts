import { ALLOWED_SENDERS, providerFromSender } from "./sender-provider.js";

describe("providerFromSender", () => {
  it("maps each allow-listed sender to its provider", () => {
    expect(providerFromSender("no.reply.alerts@chase.com")).toBe("zelle_chase");
    expect(providerFromSender("cash@square.com")).toBe("cashapp");
    expect(providerFromSender("venmo@venmo.com")).toBe("venmo");
    expect(providerFromSender("notifications@stripe.com")).toBe("stripe");
    expect(providerFromSender("alerts@account.chime.com")).toBe("chime");
  });

  it("ignores case and surrounding spaces", () => {
    expect(providerFromSender("  Cash@Square.COM ")).toBe("cashapp");
  });

  it("returns null for unknown senders, look-alikes, and no sender", () => {
    expect(providerFromSender("deals@rubberstamps.com")).toBeNull();
    expect(providerFromSender("cash@square.com.evil.com")).toBeNull();
    expect(providerFromSender("xcash@square.com")).toBeNull();
    expect(providerFromSender("")).toBeNull();
    expect(providerFromSender(null)).toBeNull();
  });

  it("does not match names inherited from Object", () => {
    expect(providerFromSender("constructor")).toBeNull();
    expect(providerFromSender("__proto__")).toBeNull();
  });

  it("exposes exactly the five allow-listed senders", () => {
    expect([...ALLOWED_SENDERS].sort()).toEqual([
      "alerts@account.chime.com",
      "cash@square.com",
      "no.reply.alerts@chase.com",
      "notifications@stripe.com",
      "venmo@venmo.com",
    ]);
  });
});
