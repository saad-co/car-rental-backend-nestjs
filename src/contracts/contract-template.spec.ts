import {
  FIELD_PADDING_PCT,
  SIGNATURE_MARKER,
  VALUE_KEYS,
  allTemplates,
  buildAnchors,
  loadTemplate,
  markerOf,
  templateFor,
  textWidthPct,
  type ContractValues,
  type ValueKey,
} from "./contract-template.js";

const values = Object.fromEntries(
  VALUE_KEYS.map((key) => [key, `value of ${key}`]),
) as ContractValues;

const NBSP = " ";

/**
 * The values a client template has no place for (D91: the client's tables, followed as written). A template shows every
 * other value; a value it does not show is listed here, so a lost marker cannot go unnoticed.
 */
const NOT_SHOWN: Record<string, ValueKey[]> = {
  // The client's California and Silver Pine tables dropped the "Excess Mileage Charge (Per Mile)" row.
  "Gonzo Enterprises Inc|CA": ["EXCESS_MILEAGE", "RECURRING_TOTAL"],
  "Silver Pine Holdings LLC|IL": ["EXCESS_MILEAGE"],
  // The client's Ashwood page 1 has an email line but no phone line.
  "Ashwood Holdings LLC|IL": ["LESSEE_PHONE"],
};

const keyOf = (t: { company: string; state: string }) =>
  `${t.company}|${t.state}`;

describe("templateFor", () => {
  it("has one template for each of the five companies", () => {
    const find = (name: string, state: string) =>
      templateFor({ name, state })?.file;
    expect(find("Gonzo Enterprises Inc", "IL")).toBe("gonzo-il-lease.pdf");
    expect(find("Gonzo Enterprises Inc", "CA")).toBe("gonzo-ca-lease.pdf");
    expect(find("Evergreen Holdings LLC", "IL")).toBe("evergreen-lease.pdf");
    expect(find("Ashwood Holdings LLC", "IL")).toBe("ashwood-lease.pdf");
    expect(find("Silver Pine Holdings LLC", "IL")).toBe(
      "silver-pine-lease.pdf",
    );
  });

  it("has none for a company or state that is not built", () => {
    expect(
      templateFor({ name: "Gonzo Enterprises Inc", state: "TN" }),
    ).toBeUndefined();
    expect(
      templateFor({ name: "Some Other LLC", state: "IL" }),
    ).toBeUndefined();
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

describe.each(allTemplates().map((t) => [keyOf(t), t] as const))(
  "buildAnchors for %s",
  (key, template) => {
    const anchors = buildAnchors(
      { ...values, TOTAL_RATE: "$409.00", LESSEE_NAME: "Jesus Test" },
      template,
    );
    const texts = anchors.filter((a) => a.kind === "text");

    it("shows every value at least once, except the ones the client's template has no place for", () => {
      const shown = new Set(template.placements.map((place) => place.key));
      const missing = VALUE_KEYS.filter((k) => !shown.has(k)).sort();
      expect(missing).toEqual([...(NOT_SHOWN[key] ?? [])].sort());
      const total = anchors.find((a) => a.anchor === "{{TOTAL_RATE}}");
      expect(total).toMatchObject({ kind: "text" });
      expect(total?.kind === "text" && total.value.trim()).toBe("$409.00");
    });

    it("uses one box per marker: firma cannot pick one match among duplicates", () => {
      const markers = template.placements.map((place) => place.marker);
      expect(new Set(markers).size).toBe(markers.length);
      expect(texts).toHaveLength(markers.length);
    });

    it("knows no marker that is not a placement or the signature", () => {
      const known = new Set([
        ...template.placements.map((place) => markerOf(place.marker)),
        SIGNATURE_MARKER,
      ]);
      for (const a of anchors) expect(known.has(a.anchor), a.anchor).toBe(true);
    });

    it("adds the driver's signature box and no date: the templates have none under the signature", () => {
      expect(anchors.filter((a) => a.kind === "signature")).toEqual([
        expect.objectContaining({ anchor: SIGNATURE_MARKER }),
      ]);
      expect(anchors.filter((a) => a.kind === "date")).toEqual([]);
      expect(template.signature.heightPct).toBeGreaterThan(4);
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

    it("has a licence slot of a sensible size", () => {
      const slot = template.licenceSlot;
      expect(slot.leftPct).toBeGreaterThanOrEqual(0);
      expect(slot.leftPct + slot.widthPct).toBeLessThanOrEqual(100);
      expect(slot.topPct).toBeGreaterThanOrEqual(0);
      expect(slot.widthPct).toBeGreaterThan(20);
      expect(slot.heightPct).toBeGreaterThan(10);
    });
  },
);

describe("loadTemplate", () => {
  it.each(allTemplates().map((t) => t.file))("reads %s as a PDF", (file) => {
    const pdf = loadTemplate(file);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.length).toBeLessThan(5_000_000);
  });
});
