import {
  DATE_MARKER,
  PLACEMENTS,
  SIGNATURE_MARKER,
  VALUE_KEYS,
  buildAnchors,
  loadIllinoisTemplate,
  markerOf,
  type ContractValues,
} from "./contract-template.js";

const values = Object.fromEntries(
  VALUE_KEYS.map((key) => [key, `value of ${key}`]),
) as ContractValues;

describe("buildAnchors", () => {
  const anchors = buildAnchors({
    ...values,
    TOTAL_RATE: "$409.00",
    LESSEE_NAME: "Jesus Test",
  });

  it("gives every value at least one locked text field with its own value", () => {
    for (const key of VALUE_KEYS) {
      const tags = anchors.filter(
        (a) => a.kind === "text" && a.anchor === markerOf(key),
      );
      expect(tags.length, key).toBeGreaterThan(0);
    }
    const total = anchors.find(
      (a) => a.kind === "text" && a.anchor === "{{TOTAL_RATE}}",
    );
    expect(total).toMatchObject({ kind: "text", value: "$409.00" });
  });

  it("knows no marker that is not a value, a signature or a date", () => {
    const known = new Set([
      ...VALUE_KEYS.map(markerOf),
      SIGNATURE_MARKER,
      DATE_MARKER,
    ]);
    for (const a of anchors) expect(known.has(a.anchor), a.anchor).toBe(true);
  });

  it("adds the driver's signature box and date", () => {
    expect(anchors.filter((a) => a.kind === "signature")).toEqual([
      expect.objectContaining({ anchor: SIGNATURE_MARKER }),
    ]);
    expect(anchors.filter((a) => a.kind === "date")).toEqual([
      expect.objectContaining({ anchor: DATE_MARKER }),
    ]);
  });

  it("has one box per marker: firma cannot pick one match among duplicates", () => {
    const keys = PLACEMENTS.map((place) => place.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every field inside its limits", () => {
    for (const a of anchors) {
      expect(a.widthPct, a.anchor).toBeGreaterThan(0);
      expect(a.heightPct, a.anchor).toBeGreaterThan(0);
      if (a.kind !== "signature") {
        expect(a.fontSize, a.anchor).toBeGreaterThanOrEqual(8);
        expect(a.fontSize, a.anchor).toBeLessThanOrEqual(48);
      }
    }
  });

  it("shrinks a long value to fit instead of running over the text beside it", () => {
    const short = buildAnchors({ ...values, VEHICLE_VIN: "1HGCM82633A004352" });
    const long = buildAnchors({
      ...values,
      VEHICLE_VIN: "1HGCM82633A004352EXTRA",
    });
    const size = (list: typeof short) =>
      list.find((a) => a.kind === "text" && a.anchor === "{{VEHICLE_VIN}}")!;
    const normal = size(short);
    const shrunk = size(long);
    if (normal.kind !== "text" || shrunk.kind !== "text")
      throw new Error("not text");
    expect(shrunk.fontSize).toBeLessThan(normal.fontSize);
    expect(shrunk.widthPct).toBeLessThanOrEqual(18);
  });

  it("is the same every time for the same values", () => {
    expect(buildAnchors(values)).toEqual(buildAnchors(values));
  });
});

describe("loadIllinoisTemplate", () => {
  it("reads a PDF", () => {
    const pdf = loadIllinoisTemplate();
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.length).toBeLessThan(5_000_000);
  });
});
