import { AliasType } from "../aliases/normalize-alias.js";
import { PaymentSource, PaymentStatus } from "../payments/payment.entity.js";
import { validateMatch, type DriverCandidate } from "./ai-driver-matcher.js";
import { buildAliasIndex, findByAlias } from "./alias-lookup.js";
import { statusWhenAssigned } from "./matching.service.js";

const drivers = [
  { id: "d1", email: "tim@example.com", phone: "+13125550101" },
  { id: "d2", email: "kim@example.com", phone: "+13125550102" },
];
const index = buildAliasIndex(
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
      findByAlias(payment(PaymentSource.email_zelle, "Timothy  Sutton"), index),
    ).toEqual({
      driverId: "d1",
      explanation: 'Known zelle alias "TIMOTHY SUTTON"',
    });
    expect(
      findByAlias(
        payment(PaymentSource.email_cashapp, "college and beyond"),
        index,
      )?.driverId,
    ).toBe("d2");
  });

  it("never matches an alias of another method (type-filtered, defect 1)", () => {
    expect(
      findByAlias(payment(PaymentSource.email_venmo, "Timothy Sutton"), index),
    ).toBeNull();
  });

  it("matches the driver's own email or phone shown as the handle", () => {
    expect(
      findByAlias(
        payment(PaymentSource.email_zelle, "T S", "TIM@example.com"),
        index,
      )?.driverId,
    ).toBe("d1");
    expect(
      findByAlias(
        payment(PaymentSource.email_venmo, "K", "(312) 555-0102"),
        index,
      )?.driverId,
    ).toBe("d2");
  });

  it("gives up when two different drivers are found (a human or the AI decides)", () => {
    expect(
      findByAlias(
        payment(PaymentSource.email_zelle, "Timothy Sutton", "kim@example.com"),
        index,
      ),
    ).toBeNull();
  });
});

describe("validateMatch", () => {
  const list: DriverCandidate[] = [
    { id: "d1", name: "Tim Sutton", status: "active", aliases: [] },
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

describe("statusWhenAssigned", () => {
  it("Zelle waits for the bank (reported); the others are final (confirmed)", () => {
    expect(statusWhenAssigned(PaymentSource.email_zelle)).toBe(
      PaymentStatus.reported,
    );
    expect(statusWhenAssigned(PaymentSource.email_cashapp)).toBe(
      PaymentStatus.confirmed,
    );
    expect(statusWhenAssigned(PaymentSource.email_venmo)).toBe(
      PaymentStatus.confirmed,
    );
  });
});
