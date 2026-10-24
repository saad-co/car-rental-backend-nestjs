/**
 * What a state's template is made of (types, the value names, and the helpers the measured tables in `templates/` use).
 * Kept apart from `contract-template.ts` so the tables can import it without a circular import.
 */

/** Every value printed on the contract, by its name (the stored `sent_values` use these names, so they never change). */
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

/**
 * How a value sits on its marker. firma puts the field's top-left corner on the marker's and **left-aligns** the text in
 * the field (measured 2026-10-24: the text starts about `FIELD_PADDING_PCT` inside the field); the text of the PDF does not move.
 * - `inline`: the field starts on the marker; a value longer than the marker grows to the right (at most `maxWidthPct`);
 * - `money`: a table cell. The value is right-aligned on the template's `moneyRightPct`, so the decimals line up (digits all
 *   have the same width): the field starts on or before the marker (it must cover it) and the value is padded on the left
 *   with non-breaking spaces (firma keeps them) to land exactly on that line;
 * - `right`: like `money` but ending on the marker's own right edge (a number that sits right before a word, like "18 months");
 * - `center`: like `money` but centred on the marker (a label or a date in a centred cell).
 */
export type Layout = "inline" | "money" | "right" | "center";

export interface Placement {
  /** The marker's name in the PDF (`COMPANY_HEAD` is `{{COMPANY_HEAD}}`); several markers may show the same value. */
  marker: string;
  /** The value printed there. */
  key: ValueKey;
  layout: Layout;
  /** The marker's measured box, as percent of the page: left edge, width and height. */
  markerLeftPct: number;
  markerWidthPct: number;
  markerHeightPct: number;
  /** The widest the field may be: the free space on the line, or just the marker where text follows it directly. */
  maxWidthPct: number;
  /** The font size the surrounding text has; it shrinks (down to 8) when a long value would not fit. */
  fontSize: number;
  /** Measured: how far firma puts the field to the right of the marker's real position, taken back off (percent of the page). */
  driftXPct: number;
}

export interface Box {
  widthPct: number;
  heightPct: number;
  yOffsetPct: number;
}

/** Where the driver's licence picture goes on the last page, as percent of the page (the box the sample's photo had). */
export interface LicenceSlot {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

/** One state's contract: its PDF and everything measured on it. */
export interface ContractTemplate {
  /** The state whose text this is (`contract_companies.state`). */
  state: string;
  /** The PDF in `src/contracts/templates/`. */
  file: string;
  placements: readonly Placement[];
  /** The driver's signature box and its date, measured the same way. */
  signature: Box;
  date: Box;
  /** The line on which money in the disclosure table ends (percent of the page). */
  moneyRightPct: number;
  licenceSlot: LicenceSlot;
}

/** Placement helper: the shape used by the measured tables in `templates/`. */
export function place(
  marker: string,
  key: ValueKey,
  layout: Layout,
  markerLeftPct: number,
  markerWidthPct: number,
  markerHeightPct: number,
  maxWidthPct: number,
  fontSize: number,
  driftXPct = 0,
): Placement {
  return {
    marker,
    key,
    layout,
    markerLeftPct,
    markerWidthPct,
    markerHeightPct,
    maxWidthPct,
    fontSize,
    driftXPct,
  };
}

/** The signature and date boxes get extra height: the tails of the markers' braces showed below them in the first signed contract. */
export const SIGN_BOX_HEIGHT_EXTRA = 0.6;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A signature or date box: the marker's own size plus room for the tails of its braces. */
export function signBox(
  markerHeightPct: number,
  widthPct: number,
  yOffsetPct = 0,
  extraHeightPct = SIGN_BOX_HEIGHT_EXTRA,
): Box {
  return {
    widthPct: round2(widthPct),
    heightPct: round2(markerHeightPct + extraHeightPct),
    yOffsetPct,
  };
}
