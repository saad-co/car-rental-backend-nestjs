import { readFileSync } from "node:fs";
import type { FirmaAnchor } from "../firma/firma-client.js";

/**
 * The Illinois lease PDF and where each value goes on it (Module 2 step 3, D74). The PDF is the client's Ashwood sample
 * with every value replaced by a `{{MARKER}}` text; firma finds each marker and puts a locked field in its place. The
 * driver's licence photo of the sample was removed from the last page before it was stored here. One template serves all
 * four Illinois companies (their texts are identical, compared line by line 2026-10-19).
 */
export const ILLINOIS_TEMPLATE_FILE = "illinois-lease.pdf";

/** Every value printed on the contract, by its marker name (`{{LESSEE_NAME}}` is `LESSEE_NAME`). */
export const VALUE_KEYS = [
  "COMPANY_NAME",
  "COMPANY_ADDRESS",
  "LESSOR_SIGNATURE",
  "START_DATE",
  "END_DATE",
  "TERM_MONTHS",
  "LESSEE_NAME",
  "LESSEE_ADDRESS",
  "LICENSE_NUMBER",
  "LICENSE_STATE",
  "DATE_OF_BIRTH",
  "LESSEE_EMAIL",
  "LESSEE_PHONE",
  "VEHICLE_MODEL",
  "VEHICLE_VIN",
  "VEHICLE_PLATE",
  "VEHICLE_PLATE_STATE",
  "BASE_RATE",
  "INSURANCE",
  "UNLIMITED_MILES",
  "MAINTENANCE",
  "TAXES",
  "TOTAL_RATE",
  "PAYMENT_LABEL",
  "SECURITY_DEPOSIT",
  "DOCUMENTATION_FEE",
  "INSURANCE_START_FEE",
  "OTHER_ONE_TIME",
  "HOLD_VEHICLE",
  "ONE_TIME_TOTAL",
  "AMOUNT_DUE_AT_PICKUP",
  "EXCESS_MILEAGE",
  "INSURANCE_EXCESS",
  "OTHER_RECURRING",
  "PURCHASE_OPTION",
] as const;

export type ValueKey = (typeof VALUE_KEYS)[number];
export type ContractValues = Record<ValueKey, string>;

/** The two markers that are not values: the driver signs and dates here. */
export const SIGNATURE_MARKER = "{{LESSEE_SIGNATURE}}";
export const DATE_MARKER = "{{LESSEE_DATE}}";

export function markerOf(key: string): string {
  return `{{${key}}}`;
}

/**
 * How a value sits on its marker. firma puts the field's top-left corner on the marker's and the value is centred in the
 * field; the text of the PDF does not move. A field is never narrower than its marker, because its white background is
 * what hides the marker text:
 * - `inline`: a value longer than the marker grows to the right (at most `maxWidthPct`);
 * - `cell`: for a centred table cell, a long value grows to both sides, so it stays centred.
 */
type Layout = "inline" | "cell";

interface Placement {
  key: ValueKey;
  layout: Layout;
  /** The marker's own width and height as a percentage of the page, measured from the template. */
  markerWidthPct: number;
  markerHeightPct: number;
  /** The widest the field may be: the free space on the line, or just the marker where text follows it directly. */
  maxWidthPct: number;
  /** The font size the surrounding text has; it shrinks (down to 8) when a long value would not fit. */
  fontSize: number;
  /** Measured: how far firma puts the field to the right of the marker's real position, taken back off (percent of the page). */
  driftXPct: number;
}

const p = (
  key: ValueKey,
  layout: Layout,
  markerWidthPct: number,
  markerHeightPct: number,
  maxWidthPct: number,
  fontSize: number,
  driftXPct = 0,
): Placement => ({
  key,
  layout,
  markerWidthPct,
  markerHeightPct,
  maxWidthPct,
  fontSize,
  driftXPct,
});

/**
 * One row per value on the page, measured once from `illinois-lease.pdf` (2026-10-21). If the template changes, measure
 * again: a marker that is not here stays on the contract as raw `{{TEXT}}`, and a row for a marker that is not in the PDF
 * makes firma refuse the send.
 */
export const PLACEMENTS: readonly Placement[] = [
  // Page 1 header and parties. COMPANY_NAME is printed three times (heading, Lessor line, signature block) and START_DATE
  // twice; firma cannot pick one match among duplicates on a page, so each shares one box, sized for the tightest spot.
  p("COMPANY_NAME", "inline", 17.54, 1.55, 17.9, 10),
  p("START_DATE", "inline", 13.07, 1.4, 13.07, 10),
  p("COMPANY_ADDRESS", "inline", 23.3, 1.68, 76, 11),
  p("LESSEE_NAME", "inline", 17.47, 1.68, 69, 11),
  p("LESSEE_ADDRESS", "inline", 20.65, 1.68, 76, 11),
  // Licence and vehicle lines: text follows right after each marker ("|"), so the field may not grow past the marker.
  p("LICENSE_NUMBER", "inline", 21.19, 1.68, 21.19, 11),
  p("LICENSE_STATE", "inline", 18.53, 1.68, 18.53, 11),
  p("DATE_OF_BIRTH", "inline", 19.01, 1.68, 76, 11),
  // firma puts these two 1.6% right of their markers (the other lines are exact), so the drift is taken back off.
  p("LESSEE_EMAIL", "inline", 17.93, 1.68, 18.5, 11, 1.55),
  p("LESSEE_PHONE", "inline", 18.25, 1.68, 45, 11, 1.64),
  p("VEHICLE_MODEL", "inline", 21.77, 1.82, 21.77, 12),
  p("VEHICLE_VIN", "inline", 18, 1.82, 18, 12),
  p("VEHICLE_PLATE", "inline", 20.59, 1.82, 20.59, 12),
  p("VEHICLE_PLATE_STATE", "inline", 27.85, 1.82, 49, 12),
  // Page 1 disclosure table.
  p("TERM_MONTHS", "inline", 15.39, 1.4, 15.39, 10),
  p("END_DATE", "cell", 11.48, 1.4, 11.48, 10),
  p("BASE_RATE", "cell", 12.21, 1.4, 12.21, 10),
  p("INSURANCE", "cell", 12.48, 1.4, 12.48, 10),
  p("UNLIMITED_MILES", "cell", 17.92, 1.4, 17.92, 10),
  p("MAINTENANCE", "cell", 15.11, 1.4, 15.11, 10),
  p("TAXES", "cell", 8.27, 1.4, 8.27, 10),
  p("TOTAL_RATE", "cell", 13.23, 1.4, 13.23, 10),
  p("SECURITY_DEPOSIT", "cell", 18.65, 1.4, 18.65, 10),
  p("DOCUMENTATION_FEE", "cell", 20.88, 1.4, 20.88, 10),
  p("INSURANCE_START_FEE", "cell", 21.96, 1.4, 21.96, 10),
  p("OTHER_ONE_TIME", "cell", 17.56, 1.4, 17.56, 10),
  p("HOLD_VEHICLE", "cell", 15.47, 1.4, 15.47, 10),
  p("ONE_TIME_TOTAL", "cell", 17.31, 1.4, 17.31, 10),
  p("AMOUNT_DUE_AT_PICKUP", "cell", 24.32, 1.4, 24.32, 10),
  p("PAYMENT_LABEL", "cell", 16.91, 1.4, 16.91, 10),
  p("EXCESS_MILEAGE", "cell", 17.38, 1.4, 17.38, 10),
  // Page 2 (rest of the recurring charges).
  p("INSURANCE_EXCESS", "cell", 19.38, 1.4, 19.38, 10),
  p("OTHER_RECURRING", "cell", 18.83, 1.4, 18.83, 10),
  // Page 4, section 15.
  p("PURCHASE_OPTION", "inline", 20.26, 1.55, 20.3, 10),
  // Page 6, the signature block.
  p("LESSOR_SIGNATURE", "inline", 19.29, 2.07, 22, 14),
];

/** The signature box of the driver and its date, measured the same way. */
const SIGNATURE = { widthPct: 20.73, heightPct: 3.6, yOffsetPct: -2 };
const DATE = { widthPct: 17.07, heightPct: 1.69, fontSize: 11 };

const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;
/** Average glyph width as a fraction of the font size, a little generous so a value never runs past its field. */
const GLYPH_WIDTH = 0.55;
const MIN_FONT_SIZE = 8;
/** The field is a little taller than its text so letters with tails are not cut. */
const LINE_HEIGHT = 1.4;
/** Added to the marker's measured height (percent of the page); measured on the signing page, where 0 left brace tails showing. */
const MARKER_HEIGHT_EXTRA = 0.37;

function textWidthPct(text: string, fontSize: number): number {
  return ((text.length * GLYPH_WIDTH * fontSize) / PAGE_WIDTH_PT) * 100;
}

/** The biggest font size, from the surrounding text's own down to 8, at which `text` fits in `widthPct`. */
function fitFontSize(text: string, widthPct: number, base: number): number {
  let size = base;
  while (size > MIN_FONT_SIZE && textWidthPct(text, size) > widthPct) size--;
  return size;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toAnchor(place: Placement, value: string): FirmaAnchor {
  // The value shrinks (down to 8) until it fits where the field may grow to.
  const fontSize = fitFontSize(value, place.maxWidthPct, place.fontSize);
  const width = Math.min(
    place.maxWidthPct,
    Math.max(place.markerWidthPct, textWidthPct(value, fontSize) + 1),
  );
  const xOffsetPct =
    (place.layout === "cell" ? (place.markerWidthPct - width) / 2 : 0) -
    place.driftXPct;
  return {
    kind: "text",
    anchor: markerOf(place.key),
    value,
    fontSize,
    widthPct: round2(width),
    xOffsetPct: round2(xOffsetPct),
    // Taller than the marker, so the white background also covers the tails of its braces and its underscores.
    heightPct: round2(
      Math.max(
        place.markerHeightPct + MARKER_HEIGHT_EXTRA,
        (fontSize * LINE_HEIGHT * 100) / PAGE_HEIGHT_PT,
      ),
    ),
  };
}

/**
 * Every anchor of the contract: one locked text field per value placement, then the driver's signature box and date.
 * Pure: the same values always give the same anchors.
 */
export function buildAnchors(values: ContractValues): FirmaAnchor[] {
  return [
    ...PLACEMENTS.map((place) => toAnchor(place, values[place.key])),
    {
      kind: "signature",
      anchor: SIGNATURE_MARKER,
      widthPct: SIGNATURE.widthPct,
      heightPct: SIGNATURE.heightPct,
      xOffsetPct: 0,
      yOffsetPct: SIGNATURE.yOffsetPct,
    },
    {
      kind: "date",
      anchor: DATE_MARKER,
      widthPct: DATE.widthPct,
      heightPct: DATE.heightPct,
      xOffsetPct: 0,
      fontSize: DATE.fontSize,
    },
  ];
}

let cached: Buffer | undefined;

/** The template PDF's bytes, exactly as stored (read once). */
export function loadIllinoisTemplate(): Buffer {
  cached ??= readFileSync(
    `${import.meta.dirname}/templates/${ILLINOIS_TEMPLATE_FILE}`,
  );
  return cached;
}
