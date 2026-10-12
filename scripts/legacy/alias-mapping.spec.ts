import {
  AliasType,
  normalizeAliasValue,
} from "../../src/aliases/normalize-alias.js";
import { planAliasImport, type LegacyAliasRow } from "./alias-mapping.js";

const drivers = new Map([
  ["old-a", "our-a"],
  ["old-b", "our-b"],
]);
const row = (
  id: string,
  driver: string,
  type: string,
  value: string | null,
): LegacyAliasRow => ({
  id,
  driver_id: driver,
  alias_type: type,
  alias_value: value,
});

describe("normalizeAliasValue", () => {
  it("lower-cases, trims and collapses spaces; drops $ and @ on handles; formats US phones", () => {
    expect(normalizeAliasValue(AliasType.zelle, "  TIMOTHY   SUTTON ")).toBe(
      "timothy sutton",
    );
    expect(normalizeAliasValue(AliasType.cashapp, "$PatEx")).toBe("patex");
    expect(normalizeAliasValue(AliasType.venmo, "@Pat-Ex")).toBe("pat-ex");
    expect(normalizeAliasValue(AliasType.phone, "(312) 555-0123")).toBe(
      "+13125550123",
    );
    // `$` only matters for Cash App/Venmo handles.
    expect(normalizeAliasValue(AliasType.zelle, "$Pat")).toBe("$pat");
  });
});

describe("planAliasImport", () => {
  it("inserts valid aliases for imported drivers", () => {
    const plan = planAliasImport(
      [
        row("1", "old-a", "zelle", "Timothy Sutton"),
        row("2", "old-a", "cashapp", "$Tim"),
      ],
      drivers,
      [],
    );
    expect(plan.inserts).toEqual([
      {
        driverId: "our-a",
        type: "zelle",
        value: "Timothy Sutton",
        valueNormalized: "timothy sutton",
      },
      {
        driverId: "our-a",
        type: "cashapp",
        value: "$Tim",
        valueNormalized: "tim",
      },
    ]);
    expect(plan.skips).toEqual([]);
  });

  it("skips, with reasons: unknown type, empty value, driver not imported", () => {
    const plan = planAliasImport(
      [
        row("1", "old-a", "paypal", "x"),
        row("2", "old-a", "zelle", " "),
        row("3", "old-z", "zelle", "Pat"),
      ],
      drivers,
      [],
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.skips.map((s) => s.reason)).toEqual([
      'unknown alias_type "paypal"',
      "empty value",
      "its driver was not imported",
    ]);
  });

  it("never gives one alias to two drivers", () => {
    const plan = planAliasImport(
      [
        row("1", "old-a", "zelle", "Pat Example"),
        row("2", "old-b", "zelle", "PAT EXAMPLE"),
      ],
      drivers,
      [],
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.skips).toHaveLength(2);
  });

  it("allows the same value under different types (lookups filter by type)", () => {
    const plan = planAliasImport(
      [row("1", "old-a", "zelle", "Pat"), row("2", "old-b", "venmo", "Pat")],
      drivers,
      [],
    );
    expect(plan.inserts).toHaveLength(2);
  });

  it("is re-runnable: an alias already ours is unchanged; another driver's is skipped", () => {
    const plan = planAliasImport(
      [row("1", "old-a", "zelle", "Pat"), row("2", "old-a", "venmo", "Kim")],
      drivers,
      [
        { driverId: "our-a", type: "zelle", valueNormalized: "pat" },
        { driverId: "our-b", type: "venmo", valueNormalized: "kim" },
      ],
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.skips[0]?.reason).toBe(
      "already an alias of another driver in our system",
    );
  });
});
