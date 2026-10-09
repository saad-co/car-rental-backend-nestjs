import {
  validateExtraction,
  type ExtractionInput,
} from "./payment-extraction.js";

const email: ExtractionInput = {
  provider: "venmo",
  subject: "Jonathan Johnson paid you $600.00",
  bodyText: "Payment notification. Transaction ID 12345",
};

/** What a well-behaved extractor returns for the email above. */
const good = {
  is_payment: true,
  provider: "venmo",
  amount_cents: 60000,
  sender_name: "Jonathan Johnson",
  sender_handle: null,
  occurred_at: "2026-10-07T14:30:00Z",
  confidence: 0.97,
};

function failedReason(output: unknown, input = email): string {
  const result = validateExtraction(output, input);
  if (result.kind !== "failed")
    throw new Error(`expected failed, got ${result.kind}`);
  return result.reason;
}

describe("validateExtraction", () => {
  it("accepts a valid payment and converts it to typed values", () => {
    expect(validateExtraction(good, email)).toEqual({
      kind: "payment",
      payment: {
        provider: "venmo",
        amountCents: 60000,
        senderName: "Jonathan Johnson",
        senderHandle: null,
        occurredAt: new Date("2026-10-07T14:30:00Z"),
        confidence: 0.97,
      },
    });
  });

  it("returns not_payment (not a failure) when the extractor says so", () => {
    expect(validateExtraction({ is_payment: false }, email)).toEqual({
      kind: "not_payment",
    });
  });

  it("rejects output that is not an object or has the wrong shape", () => {
    expect(failedReason("600")).toMatch(/not a JSON object/);
    expect(failedReason(null)).toMatch(/not a JSON object/);
    expect(failedReason({ ...good, is_payment: "yes" })).toMatch(/is_payment/);
    expect(failedReason({ ...good, sender_name: "  " })).toMatch(/sender_name/);
    expect(failedReason({ ...good, confidence: 1.5 })).toMatch(/confidence/);
    expect(failedReason({ ...good, occurred_at: "not a date" })).toMatch(
      /occurred_at/,
    );
  });

  it("rejects amounts that are not positive whole cents", () => {
    expect(failedReason({ ...good, amount_cents: 600.5 })).toMatch(
      /amount_cents/,
    );
    expect(failedReason({ ...good, amount_cents: "60000" })).toMatch(
      /amount_cents/,
    );
    expect(failedReason({ ...good, amount_cents: 0 })).toMatch(/amount_cents/);
    expect(failedReason({ ...good, amount_cents: -100 })).toMatch(
      /amount_cents/,
    );
  });

  it("rejects a provider that differs from the verified sender", () => {
    expect(failedReason({ ...good, provider: "zelle_chase" })).toMatch(
      /does not match the verified sender/,
    );
  });

  it("rejects an amount that does not appear in the email text (hallucination)", () => {
    expect(failedReason({ ...good, amount_cents: 70000 })).toMatch(
      /does not appear/,
    );
  });

  it("does not match an amount inside a bigger number", () => {
    const bigger: ExtractionInput = {
      ...email,
      subject: "X paid you $1,600.00",
      bodyText: "",
    };
    expect(failedReason({ ...good, amount_cents: 60000 }, bigger)).toMatch(
      /does not appear/,
    );
    const longer: ExtractionInput = {
      ...email,
      subject: "X paid you $600.005",
      bodyText: "",
    };
    expect(failedReason({ ...good, amount_cents: 60000 }, longer)).toMatch(
      /does not appear/,
    );
  });

  it("finds the amount written in other common forms", () => {
    const body = (text: string): ExtractionInput => ({
      ...email,
      subject: "",
      bodyText: text,
    });
    const ok = (cents: number, text: string) =>
      validateExtraction({ ...good, amount_cents: cents }, body(text)).kind;

    expect(ok(12000, "You were sent $120 by Riva D Brewer.")).toBe("payment");
    expect(ok(120000, "Amount: $1,200.00")).toBe("payment");
    expect(ok(120000, "Amount: 1200.00 USD")).toBe("payment");
    expect(ok(4550, "sent you $45.50 for gas")).toBe("payment");
    expect(ok(12000, "You were sent $120.")).toBe("payment");
  });

  it("accepts occurred_at: null", () => {
    const result = validateExtraction({ ...good, occurred_at: null }, email);
    expect(result.kind === "payment" && result.payment.occurredAt).toBeNull();
  });
});
