import type { DataSource } from "typeorm";
import { AliasType } from "../src/aliases/normalize-alias.js";
import {
  AliasSource,
  PaymentAlias,
} from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { LlmRateLimitError } from "../src/llm/llm-client.js";
import type {
  AiDriverMatcher,
  AiMatch,
} from "../src/matching/ai-driver-matcher.js";
import { MatchingService } from "../src/matching/matching.service.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { openTestDatabase } from "./test-database.js";

/** Stands in for the AI: answers what the test sets, counts calls. */
class FakeAi {
  calls = 0;
  answer: () => Promise<AiMatch> = () =>
    Promise.resolve({ driverId: null, confidence: 0, explanation: "none" });
  match(): Promise<AiMatch> {
    this.calls++;
    return this.answer();
  }
}

describe("MatchingService.matchPending (test database)", () => {
  let db: DataSource;
  let ai: FakeAi;
  let tim: string;
  let kim: string;
  let seq = 0;

  const service = () =>
    new MatchingService(
      db,
      new LedgerService(db),
      ai as unknown as AiDriverMatcher,
    );
  const reload = (id: string) =>
    db.getRepository(Payment).findOneByOrFail({ id });

  async function addPayment(
    source: PaymentSource,
    senderName: string,
  ): Promise<string> {
    seq++;
    const result = await db.getRepository(Payment).insert({
      source,
      externalId: `email-${seq}`,
      transactionId: null,
      amountCents: 5800,
      senderName,
      senderHandle: null,
      occurredAt: new Date(Date.UTC(2026, 9, 12, 0, seq)),
      extractionConfidence: 0.9,
      status: PaymentStatus.unmatched,
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE payments, payment_aliases, drivers CASCADE");
    ai = new FakeAi();
    const drivers = await db.getRepository(Driver).save([
      {
        firstName: "Timothy",
        lastName: "Sutton",
        email: "tim@example.com",
        phone: "+13125550101",
      },
      {
        firstName: "Kim",
        lastName: "Lee",
        email: "kim@example.com",
        phone: "+13125550102",
      },
    ]);
    [tim, kim] = drivers.map((d) => d.id);
    await db.getRepository(PaymentAlias).insert({
      driverId: kim,
      type: AliasType.cashapp,
      value: "College And Beyond",
      valueNormalized: "college and beyond",
      source: AliasSource.legacy,
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("assigns by alias without asking the AI; Cash App becomes confirmed", async () => {
    const id = await addPayment(
      PaymentSource.email_cashapp,
      "COLLEGE AND BEYOND",
    );
    expect(await service().matchPending()).toEqual({ assigned: 1, review: 0 });

    expect(await reload(id)).toMatchObject({
      driverId: kim,
      matchMethod: MatchMethod.alias,
      matchConfidence: 1,
      status: PaymentStatus.confirmed,
    });
    expect(ai.calls).toBe(0);
  });

  it("assigns a confident AI match (status confirmed) and learns the alias at 0.9+, so the next one needs no AI", async () => {
    ai.answer = () =>
      Promise.resolve({
        driverId: tim,
        confidence: 0.95,
        explanation: "Same name",
      });
    const first = await addPayment(PaymentSource.email_zelle, "TIM SUTTON");
    await service().matchPending();

    expect(await reload(first)).toMatchObject({
      driverId: tim,
      matchMethod: MatchMethod.ai,
      status: PaymentStatus.confirmed,
    });
    expect(
      await db.getRepository(PaymentAlias).findOneBy({ driverId: tim }),
    ).toMatchObject({
      type: AliasType.zelle,
      source: AliasSource.ai_match,
    });

    const second = await addPayment(PaymentSource.email_zelle, "Tim  Sutton");
    await service().matchPending();
    expect((await reload(second)).matchMethod).toBe(MatchMethod.alias);
    expect(ai.calls).toBe(1);
  });

  it("uses an alias learned earlier in the same run (one AI call for two payments)", async () => {
    ai.answer = () =>
      Promise.resolve({
        driverId: tim,
        confidence: 0.95,
        explanation: "Same name",
      });
    const first = await addPayment(PaymentSource.email_zelle, "TIM SUTTON");
    const second = await addPayment(PaymentSource.email_zelle, "Tim  Sutton");
    expect(await service().matchPending()).toEqual({ assigned: 2, review: 0 });

    expect((await reload(first)).matchMethod).toBe(MatchMethod.ai);
    expect((await reload(second)).matchMethod).toBe(MatchMethod.alias);
    expect(ai.calls).toBe(1);
  });

  it("sends an exact driver name to the AI too: only aliases, emails and phones skip it", async () => {
    ai.answer = () =>
      Promise.resolve({
        driverId: tim,
        confidence: 0.95,
        explanation: "Same name",
      });
    const id = await addPayment(PaymentSource.email_zelle, "Timothy Sutton");
    await service().matchPending();
    expect(await reload(id)).toMatchObject({
      driverId: tim,
      matchMethod: MatchMethod.ai,
    });
    expect(ai.calls).toBe(1);
  });

  it("assigns between 0.7 and 0.9 but learns no alias", async () => {
    ai.answer = () =>
      Promise.resolve({
        driverId: tim,
        confidence: 0.75,
        explanation: "Close",
      });
    const id = await addPayment(PaymentSource.email_venmo, "Tim S");
    await service().matchPending();

    expect((await reload(id)).driverId).toBe(tim);
    expect(
      await db.getRepository(PaymentAlias).countBy({ driverId: tim }),
    ).toBe(0);
  });

  it("sends a weak match (< 0.7) to review with the suggestion", async () => {
    ai.answer = () =>
      Promise.resolve({
        driverId: tim,
        confidence: 0.69,
        explanation: "Last name only",
      });
    const id = await addPayment(PaymentSource.email_venmo, "Pat Sutton");
    expect(await service().matchPending()).toEqual({ assigned: 0, review: 1 });

    expect(await reload(id)).toMatchObject({
      driverId: null,
      suggestedDriverId: tim,
      matchConfidence: 0.69,
      status: PaymentStatus.unmatched,
    });
    // Looked at once: not asked again on the next run.
    await service().matchPending();
    expect(ai.calls).toBe(1);
  });

  it("stops on a rate limit and retries next run; another AI error goes to review", async () => {
    const id = await addPayment(PaymentSource.email_venmo, "Someone");
    ai.answer = () => Promise.reject(new LlmRateLimitError("429"));
    await expect(service().matchPending()).rejects.toThrow(LlmRateLimitError);
    expect((await reload(id)).matchAttemptedAt).toBeNull();

    ai.answer = () => Promise.reject(new Error("bad JSON"));
    await service().matchPending();
    expect(await reload(id)).toMatchObject({
      driverId: null,
      matchExplanation: "AI matching failed: bad JSON",
    });
  });
});
