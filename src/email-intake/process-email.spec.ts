import { PaymentSource } from "../payments/payment.entity.js";
import { InboundEmailStatus } from "./inbound-email.entity.js";
import type {
  ExtractionInput,
  PaymentExtractor,
} from "./payment-extraction.js";
import { processEmail } from "./process-email.js";

const GMAIL = "mx.google.com";
const RECEIVED = new Date("2026-10-12T15:00:00Z");

/** A Venmo email as Gmail stores it: our server's DKIM header on top. Synthetic, real-shaped. */
function venmoEmail(options: { from?: string; dkimDomain?: string } = {}) {
  const lines = [
    `Authentication-Results: ${GMAIL}; dkim=pass header.i=@${options.dkimDomain ?? "venmo.com"} header.s=sel1 header.b=CCCC`,
    `From: Venmo <${options.from ?? "venmo@venmo.com"}>`,
    "Subject: Pat Example paid you $396.00",
    "Message-ID: <abc@venmo.com>",
    "Content-Type: text/plain",
    "",
    "Pat Example paid you $396.00. Transaction ID 4321987654",
  ];
  return Buffer.from(lines.join("\r\n"));
}

/** Stands in for the AI: returns a fixed answer and remembers what it was asked. */
class FakeExtractor implements PaymentExtractor {
  inputs: ExtractionInput[] = [];
  constructor(private readonly answer: () => Promise<unknown>) {}
  extract(input: ExtractionInput): Promise<unknown> {
    this.inputs.push(input);
    return this.answer();
  }
}

const venmoPayment = {
  is_payment: true,
  provider: "venmo",
  amount_cents: 39600,
  sender_name: "Pat Example",
  sender_handle: null,
  occurred_at: null,
  confidence: 0.95,
  transaction_id: "4321987654",
};

const run = (raw: Buffer, extractor: PaymentExtractor) =>
  processEmail(raw, RECEIVED, { trustedServerId: GMAIL, extractor });

describe("processEmail", () => {
  it("turns a verified payment email into a processed email and a payment", async () => {
    const extractor = new FakeExtractor(() => Promise.resolve(venmoPayment));
    const result = await run(venmoEmail(), extractor);

    expect(result.email).toMatchObject({
      messageId: "<abc@venmo.com>",
      fromAddress: "venmo@venmo.com",
      provider: "venmo",
      authDkimPass: true,
      authDkimDomain: "venmo.com",
      status: InboundEmailStatus.processed,
      statusReason: null,
      receivedAt: RECEIVED,
    });
    expect(result.payment).toEqual({
      source: PaymentSource.email_venmo,
      transactionId: "4321987654",
      amountCents: 39600,
      senderName: "Pat Example",
      senderHandle: null,
      // No date in the email: falls back to when our server received it.
      occurredAt: RECEIVED,
      extractionConfidence: 0.95,
    });
  });

  it("rejects a sender that is not on the allow-list, without calling the AI or keeping the body", async () => {
    const extractor = new FakeExtractor(() => Promise.resolve(venmoPayment));
    const result = await run(
      venmoEmail({ from: "venmo@venmo.com.evil.io" }),
      extractor,
    );

    expect(result.email.status).toBe(InboundEmailStatus.rejected_unverified);
    expect(result.email.statusReason).toMatch(/not on the allow-list/);
    expect(result.email.provider).toBe("unknown");
    expect(result.email.bodyText).toBeNull();
    expect(result.payment).toBeNull();
    expect(extractor.inputs).toHaveLength(0);
  });

  it("rejects an email whose DKIM signature is not the provider's, without calling the AI", async () => {
    const extractor = new FakeExtractor(() => Promise.resolve(venmoPayment));
    const result = await run(
      venmoEmail({ dkimDomain: "evil-venmo.com" }),
      extractor,
    );

    expect(result.email).toMatchObject({
      provider: "venmo",
      authDkimPass: false,
      status: InboundEmailStatus.rejected_unverified,
    });
    expect(result.email.statusReason).toMatch(/evil-venmo\.com/);
    expect(result.payment).toBeNull();
    expect(extractor.inputs).toHaveLength(0);
  });

  it("records not_payment when the AI says the email is not a payment", async () => {
    const extractor = new FakeExtractor(() =>
      Promise.resolve({ is_payment: false }),
    );
    const result = await run(venmoEmail(), extractor);

    expect(result.email.status).toBe(InboundEmailStatus.not_payment);
    expect(result.payment).toBeNull();
  });

  it("records extraction_failed with the reason when the AI answer fails validation", async () => {
    const extractor = new FakeExtractor(() =>
      Promise.resolve({ ...venmoPayment, amount_cents: 99900 }),
    );
    const result = await run(venmoEmail(), extractor);

    expect(result.email.status).toBe(InboundEmailStatus.extraction_failed);
    expect(result.email.statusReason).toMatch(/does not appear/);
    expect(result.payment).toBeNull();
  });

  it("records extraction_failed without calling the AI when the caller gives up on the email", async () => {
    const extractor = new FakeExtractor(() => Promise.resolve(venmoPayment));
    const result = await processEmail(
      venmoEmail(),
      RECEIVED,
      { trustedServerId: GMAIL, extractor },
      { abandonReason: "AI failed 3 runs in a row: 503" },
    );

    expect(result.email).toMatchObject({
      provider: "venmo",
      authDkimPass: true,
      status: InboundEmailStatus.extraction_failed,
      statusReason: "AI failed 3 runs in a row: 503",
    });
    expect(result.payment).toBeNull();
    expect(extractor.inputs).toHaveLength(0);
  });

  it("throws (records nothing) when the AI call fails, so the email is retried later", async () => {
    const extractor = new FakeExtractor(() =>
      Promise.reject(new Error("503 model overloaded")),
    );
    await expect(run(venmoEmail(), extractor)).rejects.toThrow(/503/);
  });
});
