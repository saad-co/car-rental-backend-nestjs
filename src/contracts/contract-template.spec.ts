import {
  DATE_MARKER,
  FIELD_PADDING_PCT,
  SIGNATURE_MARKER,
  VALUE_KEYS,
  buildAnchors,
  loadTemplate,
  markerOf,
  templateFor,
  textWidthPct,
  type ContractValues,
} from "./contract-template.js";

const values = Object.fromEntries(
  VALUE_KEYS.map((key) => [key, `value of ${key}`]),
) as ContractValues;

const NBSP = " ";

describe("templateFor", () => {
  it("has a template for Illinois and California, none for another state", () => {
    expect(templateFor("IL")?.file).toBe("illinois-lease.pdf");
    expect(templateFor("CA")?.file).toBe("california-lease.pdf");
    expect(templateFor("TN")).toBeUndefined();
  });
});

describe("textWidthPct", () => {
  it("gives every digit and the dollar sign the same width, which lines money up", () => {
    expect(textWidthPct("$000.00", 10)).toBeCloseTo(
      textWidthPct("$888.88", 10),
    );
    expect(textWidthPct("$1,000.00", 10)).toBeGreaterThan(
      textWidthPct("$100.00", 10),
    );
  });
});

describe.each(["IL", "CA"])("buildAnchors for %s", (state) => {
  const template = templateFor(state)!;
  const anchors = buildAnchors(
    { ...values, TOTAL_RATE: "$409.00", LESSEE_NAME: "Jesus Test" },
    template,
  );
  const texts = anchors.filter((a) => a.kind === "text");

  it("gives every value at least one locked text field", () => {
    for (const key of VALUE_KEYS) {
      expect(
        template.placements.some((place) => place.key === key),
        key,
      ).toBe(true);
    }
    const total = anchors.find((a) => a.anchor === "{{TOTAL_RATE}}");
    expect(total).toMatchObject({ kind: "text" });
    expect(total?.kind === "text" && total.value.trim()).toBe("$409.00");
  });

  it("uses one box per marker: firma cannot pick one match among duplicates", () => {
    const markers = template.placements.map((place) => place.marker);
    expect(new Set(markers).size).toBe(markers.length);
    expect(texts).toHaveLength(markers.length);
  });

  it("knows no marker that is not a placement, the signature or the date", () => {
    const known = new Set([
      ...template.placements.map((place) => markerOf(place.marker)),
      SIGNATURE_MARKER,
      DATE_MARKER,
    ]);
    for (const a of anchors) expect(known.has(a.anchor), a.anchor).toBe(true);
  });

  it("adds the driver's signature box and date, tall enough to cover the tails of their markers", () => {
    expect(anchors.filter((a) => a.kind === "signature")).toEqual([
      expect.objectContaining({ anchor: SIGNATURE_MARKER }),
    ]);
    expect(anchors.filter((a) => a.kind === "date")).toEqual([
      expect.objectContaining({ anchor: DATE_MARKER }),
    ]);
    expect(template.date.heightPct).toBeGreaterThan(1.7);
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

  it("covers every marker completely: the field starts on or before it and reaches its far edge", () => {
    for (const place of template.placements) {
      const a = anchors.find((x) => x.anchor === markerOf(place.marker))!;
      const left = place.markerLeftPct + a.xOffsetPct + place.driftXPct;
      expect(left, place.marker).toBeLessThanOrEqual(
        place.markerLeftPct + 0.001,
      );
      expect(left + a.widthPct, place.marker).toBeGreaterThanOrEqual(
        place.markerLeftPct + place.markerWidthPct - 0.01,
      );
    }
  });

  it("right-aligns every amount on the same line, whatever its length", () => {
    const amounts = ["$0.00", "$19.45", "$389.00", "$1,234.56", "$12,345.67"];
    for (const place of template.placements.filter(
      (p) => p.layout === "money",
    )) {
      const rights = amounts.map((amount) => {
        const a = buildAnchors(
          { ...values, [place.key]: amount },
          template,
        ).find((x) => x.anchor === markerOf(place.marker))!;
        if (a.kind !== "text") throw new Error("not text");
        expect(a.value.endsWith(amount), place.marker).toBe(true);
        const left = place.markerLeftPct + a.xOffsetPct + place.driftXPct;
        return left + FIELD_PADDING_PCT + textWidthPct(a.value, a.fontSize);
      });
      for (const right of rights) {
        expect(right, place.marker).toBeCloseTo(template.moneyRightPct, 1);
      }
    }
  });

  it("pads an amount only with non-breaking spaces, which firma keeps", () => {
    const a = buildAnchors({ ...values, BASE_RATE: "$1.00" }, template).find(
      (x) => x.anchor === "{{BASE_RATE}}",
    )!;
    if (a.kind !== "text") throw new Error("not text");
    expect(a.value.replaceAll(NBSP, "")).toBe("$1.00");
  });

  it("shrinks a long value to fit instead of running over the text beside it", () => {
    const place = template.placements.find((p) => p.key === "VEHICLE_VIN")!;
    const at = (vin: string) => {
      const a = buildAnchors({ ...values, VEHICLE_VIN: vin }, template).find(
        (x) => x.anchor === markerOf(place.marker),
      )!;
      if (a.kind !== "text") throw new Error("not text");
      return a;
    };
    const normal = at("1HGCM82633A004352");
    const shrunk = at("1HGCM82633A004352".repeat(4));
    expect(shrunk.fontSize).toBeLessThan(normal.fontSize);
    expect(shrunk.widthPct).toBeLessThanOrEqual(place.maxWidthPct + 0.01);
  });

  it("is the same every time for the same values", () => {
    expect(buildAnchors(values, template)).toEqual(
      buildAnchors(values, template),
    );
  });

  it("has a licence slot on the page", () => {
    const slot = template.licenceSlot;
    expect(slot.leftPct + slot.widthPct).toBeLessThanOrEqual(100);
    expect(slot.topPct).toBeGreaterThanOrEqual(0);
    expect(slot.widthPct).toBeGreaterThan(20);
    expect(slot.heightPct).toBeGreaterThan(10);
  });
});

describe("loadTemplate", () => {
  it.each(["illinois-lease.pdf", "california-lease.pdf"])(
    "reads %s as a PDF",
    (file) => {
      const pdf = loadTemplate(file);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(10_000);
      expect(pdf.length).toBeLessThan(5_000_000);
    },
  );
});
