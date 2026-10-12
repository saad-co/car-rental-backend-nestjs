import type { DataSource } from "typeorm";
import {
  EmailIntakeService,
  type EmailIntakeDeps,
} from "../src/email-intake/email-intake.service.js";
import {
  InboundEmail,
  InboundEmailStatus,
} from "../src/email-intake/inbound-email.entity.js";
import type {
  MailboxMessage,
  MailboxReader,
  MailboxSession,
} from "../src/email-intake/mailbox-reader.js";
import type {
  ExtractionInput,
  PaymentExtractor,
} from "../src/email-intake/payment-extraction.js";
import { LlmRateLimitError } from "../src/email-intake/llm-client.js";
import { Payment, PaymentStatus } from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

const MAILBOX = "gonzobilling@gmail.com";
const GMAIL = "mx.google.com";

/** A real-shaped Venmo email: our server's DKIM header on top, a transaction id in the body. */
function venmoRaw(transactionId: string, dkimDomain = "venmo.com"): Buffer {
  return Buffer.from(
    [
      `Authentication-Results: ${GMAIL}; dkim=pass header.i=@${dkimDomain} header.s=s1 header.b=AAAA`,
      "From: Venmo <venmo@venmo.com>",
      "Subject: Pat Example paid you $396.00",
      "Content-Type: text/plain",
      "",
      `Pat Example paid you $396.00. Transaction ID ${transactionId}`,
    ].join("\r\n"),
  );
}

function message(
  uid: number,
  raw: Buffer,
  gmailMessageId = `gm-${uid}`,
): MailboxMessage {
  return {
    uid,
    gmailMessageId,
    receivedAt: new Date("2026-10-12T15:00:00Z"),
    raw,
  };
}

/** A mailbox in memory. Behaves like the real one: UIDs above the cursor, oldest first. */
class FakeMailbox implements MailboxReader {
  readonly mailbox = MAILBOX;
  constructor(
    public messages: MailboxMessage[],
    public uidValidity = 1,
  ) {}
  withInbox<T>(work: (session: MailboxSession) => Promise<T>): Promise<T> {
    const session: MailboxSession = {
      uidValidity: this.uidValidity,
      newUids: (after) =>
        Promise.resolve(
          this.messages
            .map((m) => m.uid)
            .filter((uid) => uid > after)
            .sort((a, b) => a - b),
        ),
      fetch: (uid) => {
        const found = this.messages.find((m) => m.uid === uid);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new Error(`no UID ${uid}`));
      },
    };
    return work(session);
  }
}

/** Stands in for the AI: reads the transaction id back out of the body; can be told to fail. */
class FakeExtractor implements PaymentExtractor {
  calls = 0;
  failing = false;
  rateLimited = false;
  extract(input: ExtractionInput): Promise<unknown> {
    this.calls++;
    if (this.rateLimited) {
      return Promise.reject(new LlmRateLimitError("429 quota exceeded"));
    }
    if (this.failing) return Promise.reject(new Error("503 model overloaded"));
    const id = /Transaction ID (\S+)/.exec(input.bodyText)?.[1] ?? null;
    return Promise.resolve({
      is_payment: true,
      provider: input.provider,
      amount_cents: 39600,
      sender_name: "Pat Example",
      sender_handle: null,
      occurred_at: null,
      confidence: 0.95,
      transaction_id: id,
    });
  }
}

describe("EmailIntakeService.syncNewMessages (test database)", () => {
  let db: DataSource;
  let mailbox: FakeMailbox;
  let extractor: FakeExtractor;

  const service = (startAfterUid: number | null = 100) => {
    const deps: EmailIntakeDeps = {
      mailbox,
      extractor,
      trustedServerId: GMAIL,
      startAfterUid,
    };
    return new EmailIntakeService(db, deps);
  };
  const emails = () =>
    db.getRepository(InboundEmail).find({ order: { imapUid: "ASC" } });
  const payments = () => db.getRepository(Payment).find();

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE payments, inbound_emails");
    extractor = new FakeExtractor();
    mailbox = new FakeMailbox([]);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("refuses the first run without a go-live point", async () => {
    mailbox.messages = [message(101, venmoRaw("TX1001"))];
    await expect(service(null).syncNewMessages()).rejects.toThrow(
      /IMAP_START_AFTER_UID/,
    );
    expect(await emails()).toHaveLength(0);
  });

  it("stores only emails above the go-live point, each with its payment, and skips them next run", async () => {
    mailbox.messages = [
      message(99, venmoRaw("TX0099")),
      message(101, venmoRaw("TX1001")),
    ];

    expect(await service().syncNewMessages()).toEqual({ ran: true, stored: 1 });
    const [email] = await emails();
    expect(email).toMatchObject({
      imapUid: 101,
      status: InboundEmailStatus.processed,
    });
    expect(await payments()).toEqual([
      expect.objectContaining({
        externalId: email.id,
        transactionId: "TX1001",
        amountCents: 39600,
        status: PaymentStatus.unmatched,
      }),
    ]);

    // Second run: the cursor is now 101, nothing new.
    expect(await service().syncNewMessages()).toEqual({ ran: true, stored: 0 });
    expect(extractor.calls).toBe(1);
  });

  it("never stores the same Gmail message twice, even under a new UID", async () => {
    mailbox.messages = [message(101, venmoRaw("TX1001"), "gm-same")];
    await service().syncNewMessages();
    mailbox.messages.push(message(102, venmoRaw("TX1001"), "gm-same"));

    expect(await service().syncNewMessages()).toEqual({ ran: true, stored: 0 });
    expect(await emails()).toHaveLength(1);
  });

  it("rejects an email with the wrong DKIM signer, without calling the AI", async () => {
    mailbox.messages = [message(101, venmoRaw("TX1001", "evil-venmo.com"))];
    await service().syncNewMessages();

    const [email] = await emails();
    expect(email.status).toBe(InboundEmailStatus.rejected_unverified);
    expect(email.statusReason).toMatch(/evil-venmo\.com/);
    expect(await payments()).toHaveLength(0);
    expect(extractor.calls).toBe(0);
  });

  it("makes one payment from two emails about the same transaction", async () => {
    mailbox.messages = [
      message(101, venmoRaw("TX1001")),
      message(102, venmoRaw("TX1001")),
    ];
    await service().syncNewMessages();

    const [first, second] = await emails();
    const [payment] = await payments();
    expect(first.status).toBe(InboundEmailStatus.processed);
    expect(second.status).toBe(InboundEmailStatus.duplicate_payment);
    expect(second.statusReason).toContain(payment.id);
    expect(await payments()).toHaveLength(1);
  });

  it("retries an email the AI fails on, then records it as failed on the third run and moves on", async () => {
    mailbox.messages = [
      message(101, venmoRaw("TX1001")),
      message(102, venmoRaw("TX1002")),
    ];
    extractor.failing = true;
    const intake = service(); // the same instance keeps the attempt count, like the running API

    await expect(intake.syncNewMessages()).rejects.toThrow(/attempt 1 of 3/);
    await expect(intake.syncNewMessages()).rejects.toThrow(/attempt 2 of 3/);
    expect(await emails()).toHaveLength(0); // nothing stored, nothing skipped

    // Third run: 101 reaches the limit and is recorded as failed (the AI is not asked again); the run
    // then reaches 102, which fails for the first time, so the run stops there.
    await expect(intake.syncNewMessages()).rejects.toThrow(
      /UID 102: AI failed \(attempt 1 of 3\)/,
    );
    extractor.failing = false;

    const [failed] = await emails();
    expect(failed).toMatchObject({
      imapUid: 101,
      status: InboundEmailStatus.extraction_failed,
    });
    expect(failed.statusReason).toMatch(/AI failed 3 runs in a row: 503/);

    // Next run continues with 102.
    expect(await intake.syncNewMessages()).toEqual({ ran: true, stored: 1 });
    expect((await emails()).map((e) => e.status)).toEqual([
      InboundEmailStatus.extraction_failed,
      InboundEmailStatus.processed,
    ]);
  });

  it("waits out rate limits without ever giving up on the email (B49)", async () => {
    mailbox.messages = [message(101, venmoRaw("TX1001"))];
    extractor.rateLimited = true;
    const intake = service();

    // Far more runs than the 3-strike limit: each one stops at 101, none records it as failed.
    for (let run = 0; run < 5; run++) {
      await expect(intake.syncNewMessages()).rejects.toThrow(/rate-limited/);
    }
    expect(await emails()).toHaveLength(0);

    extractor.rateLimited = false;
    expect(await intake.syncNewMessages()).toEqual({ ran: true, stored: 1 });
    expect((await emails())[0].status).toBe(InboundEmailStatus.processed);
  });

  it("does nothing while another run holds the lock", async () => {
    mailbox.messages = [message(101, venmoRaw("TX1001"))];
    const other = db.createQueryRunner();
    await other.connect();
    await other.query("SELECT pg_advisory_lock(3000001)");
    try {
      expect(await service().syncNewMessages()).toEqual({
        ran: false,
        reason: "another run is still working",
      });
    } finally {
      await other.query("SELECT pg_advisory_unlock(3000001)");
      await other.release();
    }
    expect(await emails()).toHaveLength(0);
  });
});
