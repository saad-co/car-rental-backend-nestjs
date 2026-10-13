import { AliasType } from "../aliases/normalize-alias.js";
import { PaymentSource } from "../payments/payment.entity.js";
import { validateMatch, type DriverCandidate } from "./ai-driver-matcher.js";
import { AliasIndex } from "./alias-index.js";

const drivers = [
  { id: "d1", email: "tim@example.com", phone: "+13125550101" },
  { id: "d2", email: "kim@example.com", phone: "+13125550102" },
];
const index = AliasIndex.build(
  [
    {
      driverId: "d1",
      type: AliasType.zelle,
      value: "TIMOTHY SUTTON",
      valueNormalized: "timothy sutton",
    },
    {
      driverId: "d2",
      type: AliasType.cashapp,
      value: "College And Beyond",
      valueNormalized: "college and beyond",
    },
  ],
  drivers,
);
const payment = (
  source: PaymentSource,
  senderName: string,
  senderHandle: string | null = null,
) => ({ source, senderName, senderHandle });

describe("findByAlias", () => {
  it("matches an alias of the payment's own method, ignoring capitals and spaces", () => {
    expect(
      index.find(payment(PaymentSource.email_zelle, "Timothy  Sutton")),
    ).toEqual({
      driverId: "d1",
      explanation: 'Known zelle alias "TIMOTHY SUTTON"',
    });
    expect(
      index.find(payment(PaymentSource.email_cashapp, "college and beyond"))
        ?.driverId,
    ).toBe("d2");
  });

  it("never matches an alias of another method (type-filtered, defect 1)", () => {
    expect(
      index.find(payment(PaymentSource.email_venmo, "Timothy Sutton")),
    ).toBeNull();
  });

  it("matches the driver's own email or phone shown as the handle", () => {
    expect(
      index.find(payment(PaymentSource.email_zelle, "T S", "TIM@example.com"))
        ?.driverId,
    ).toBe("d1");
    expect(
      index.find(payment(PaymentSource.email_venmo, "K", "(312) 555-0102"))
        ?.driverId,
    ).toBe("d2");
  });

  it("gives up when two different drivers are found (a human or the AI decides)", () => {
    expect(
      index.find(
        payment(PaymentSource.email_zelle, "Timothy Sutton", "kim@example.com"),
      ),
    ).toBeNull();
  });
});

describe("validateMatch", () => {
  const list: DriverCandidate[] = [
    {
      id: "d1",
      name: "Tim Sutton",
      status: "active",
      email: "tim@example.com",
      phone: "+13125550101",
      aliases: [],
    },
  ];

  it("keeps a known driver id with its confidence", () => {
    expect(
      validateMatch(
        { driver_id: "d1", confidence: 0.92, explanation: "Same name" },
        list,
      ),
    ).toEqual({
      driverId: "d1",
      confidence: 0.92,
      explanation: "Same name",
    });
  });

  it("drops an id that is not in the list, and its confidence (the AI can't invent a driver)", () => {
    const match = validateMatch(
      { driver_id: "d9", confidence: 0.99, explanation: "x" },
      list,
    );
    expect(match.driverId).toBeNull();
    expect(match.confidence).toBe(0);
    expect(match.explanation).toMatch(/not in the list/);
  });

  it("rejects a malformed answer", () => {
    expect(() =>
      validateMatch({ driver_id: "d1", confidence: 2 }, list),
    ).toThrow(/confidence/);
    expect(() => validateMatch("d1", list)).toThrow(/JSON object/);
  });
});
