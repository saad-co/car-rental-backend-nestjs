import {
  mapLegacyDriver,
  parseLegacyUtc,
  planImport,
  type ExistingDriver,
  type LegacyDriverRow,
} from "./driver-mapping.js";

/** A valid old row; tests change one field at a time. Made-up data. */
function row(overrides: Partial<LegacyDriverRow> = {}): LegacyDriverRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    first_name: " Pat ",
    last_name: "Example",
    email: " Pat.Example@Example.com ",
    phone: "(312) 555-0123",
    billing_status: "active",
    created_at: "2025-03-01 14:30:00",
    ...overrides,
  };
}

function skipReason(r: LegacyDriverRow): string {
  const result = mapLegacyDriver(r);
  if (result.kind !== "skip") throw new Error("expected a skip");
  return result.skip.reason;
}

describe("mapLegacyDriver", () => {
  it("cleans the values into our format", () => {
    const result = mapLegacyDriver(row());
    expect(result).toEqual({
      kind: "driver",
      driver: {
        legacyId: "00000000-0000-0000-0000-000000000001",
        firstName: "Pat",
        lastName: "Example",
        email: "pat.example@example.com",
        phone: "+13125550123",
        status: "active",
        createdAt: new Date("2025-03-01T14:30:00Z"),
      },
    });
  });

  it("maps the old statuses: terminated is inactive, paused stays active", () => {
    const status = (billing_status: string) => {
      const result = mapLegacyDriver(row({ billing_status }));
      return result.kind === "driver"
        ? result.driver.status
        : result.skip.reason;
    };
    expect(status("terminated")).toBe("inactive");
    expect(status("paused")).toBe("active");
    expect(status("active")).toBe("active");
    expect(status("frozen")).toBe('unknown billing_status "frozen"');
  });

  it("skips rows that break our rules, with the reason", () => {
    expect(skipReason(row({ email: "" }))).toBe("email missing or invalid");
    expect(skipReason(row({ email: "not-an-email" }))).toBe(
      "email missing or invalid",
    );
    expect(skipReason(row({ phone: "121" }))).toBe("phone is not a US number");
    expect(skipReason(row({ phone: "+44 20 7946 0958" }))).toBe(
      "phone is not a US number",
    );
    expect(skipReason(row({ last_name: "  " }))).toBe(
      "first or last name missing",
    );
  });
});

describe("parseLegacyUtc", () => {
  it("reads the old zone-less time as UTC, not as local time", () => {
    expect(parseLegacyUtc("2025-03-01 14:30:00.123456")?.toISOString()).toBe(
      "2025-03-01T14:30:00.123Z",
    );
    expect(parseLegacyUtc(null)).toBeNull();
  });
});

describe("planImport", () => {
  const a = row({ id: "a", email: "a@example.com", phone: "3125550001" });
  const b = row({ id: "b", email: "b@example.com", phone: "3125550002" });

  it("inserts new drivers", () => {
    const plan = planImport([a, b], []);
    expect(plan.inserts.map((d) => d.legacyId)).toEqual(["a", "b"]);
    expect(plan.skips).toEqual([]);
  });

  it("skips every old driver that shares an email or a phone with another old driver", () => {
    const shared = row({
      id: "c",
      email: "a@example.com",
      phone: "3125550003",
    });
    const plan = planImport([a, b, shared], []);
    expect(plan.inserts.map((d) => d.legacyId)).toEqual(["b"]);
    expect(plan.skips).toEqual([
      { legacyId: "a", reason: "email shared with another old driver" },
      { legacyId: "c", reason: "email shared with another old driver" },
    ]);
  });

  it("never overwrites a driver created in our system with the same email or phone", () => {
    const ours: ExistingDriver = {
      id: "ours-1",
      legacyId: null,
      firstName: "X",
      lastName: "Y",
      email: "a@example.com",
      phone: "+13125559999",
      status: "active",
    };
    const plan = planImport([a], [ours]);
    expect(plan.inserts).toEqual([]);
    expect(plan.skips).toEqual([
      {
        legacyId: "a",
        reason: "email already used by another driver in our system",
      },
    ]);
  });

  it("on a re-run: unchanged rows are left alone and changed rows are updated", () => {
    const imported = (
      legacyId: string,
      email: string,
      phone: string,
      status: string,
    ): ExistingDriver => ({
      id: `ours-${legacyId}`,
      legacyId,
      firstName: "Pat",
      lastName: "Example",
      email,
      phone,
      status,
    });
    const plan = planImport(
      [
        a,
        row({
          id: "b",
          email: "b@example.com",
          phone: "3125550002",
          billing_status: "terminated",
        }),
      ],
      [
        imported("a", "a@example.com", "+13125550001", "active"),
        imported("b", "b@example.com", "+13125550002", "active"),
      ],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates.map((u) => [u.id, u.driver.status])).toEqual([
      ["ours-b", "inactive"],
    ]);
  });
});
