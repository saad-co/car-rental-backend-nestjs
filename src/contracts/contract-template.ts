import { readFileSync } from "node:fs";
import type { FirmaAnchor } from "../firma/firma-client.js";
import {
  VALUE_KEYS,
  type ContractTemplate,
  type ContractValues,
  round2,
  type Placement,
} from "./template-kit.js";
import { CALIFORNIA_TEMPLATE } from "./templates/california-placements.js";
import { ILLINOIS_TEMPLATE } from "./templates/illinois-placements.js";

export { VALUE_KEYS };
export type { ContractTemplate, ContractValues, Placement };
export type { ValueKey } from "./template-kit.js";

/**
 * The lease PDFs and where each value goes on them (Module 2 step 3, D74; one template per state, D76). Each PDF is the
 * client's sample with every value replaced by a `{{MARKER}}` text; firma finds each marker and puts a locked field over it.
 * firma never removes the marker text (it answers "not removed" for these PDFs): the field's white background is all that
 * hides it, so a field must cover its whole marker, tails of the braces included.
 */

/** The two markers that are not values: the driver signs and dates here. */
export const SIGNATURE_MARKER = "{{LESSEE_SIGNATURE}}";
export const DATE_MARKER = "{{LESSEE_DATE}}";

export function markerOf(name: string): string {
  return `{{${name}}}`;
}

const TEMPLATES: Record<string, ContractTemplate> = {
  IL: ILLINOIS_TEMPLATE,
  CA: CALIFORNIA_TEMPLATE,
};

/** The template of a state, or `undefined` when that state's contract is not built yet. */
export function templateFor(state: string): ContractTemplate | undefined {
  return TEMPLATES[state];
}

const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;
const MIN_FONT_SIZE = 8;
/** The field is a little taller than its text so letters with tails are not cut. */
const LINE_HEIGHT = 1.4;
/**
 * Added to the marker's measured height (percent of the page): the braces and underscores hang below the line box, and the
 * field's white background is all that hides them (measured on the signing page, where 0 left brace tails showing).
 */
const MARKER_HEIGHT_EXTRA = 0.37;
/** Where firma starts the text inside a field, from the field's left edge (measured: 2 pt). */
export const FIELD_PADDING_PCT = 0.32;
/**
 * A marker's last brace reaches a little past its measured box (seen on the signature page), so a field that has free room to
 * its right covers that much more. Where text follows the marker directly the field must stop at the marker.
 */
const RIGHT_COVER_PCT = 0.6;
/** Room kept after a padded value so firma does not shrink the font to fit it. */
const RIGHT_SLACK_PCT = 0.35;

const NBSP = "\u00a0";

/**
 * Widths of firma's font (Noto Sans, measured in a signed PDF, 2026-10-24) as a fraction of the font size. Digits and the
 * dollar sign are all the same width, which is what makes right-aligned money line up. Letters are taken a little wide so
 * a name is never cut.
 */
function glyphWidth(ch: string): number {
  if ((ch >= "0" && ch <= "9") || ch === "$") return 0.572;
  if (ch === "." || ch === "," || ch === ":") return 0.268;
  if (ch === " " || ch === NBSP) return 0.26;
  if (ch === "-") return 0.322;
  if (ch === "/") return 0.372;
  return 0.6;
}

/** The width of `text` at `fontSize`, in percent of the page. */
export function textWidthPct(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += glyphWidth(ch);
  return ((em * fontSize) / PAGE_WIDTH_PT) * 100;
}

/** The biggest font size, from the surrounding text's own down to 8, at which `text` fits in `widthPct`. */
function fitFontSize(text: string, widthPct: number, base: number): number {
  let size = base;
  while (size > MIN_FONT_SIZE && textWidthPct(text, size) > widthPct) size--;
  return size;
}

function fieldHeight(markerHeightPct: number, fontSize: number): number {
  return round2(
    Math.max(
      markerHeightPct + MARKER_HEIGHT_EXTRA,
      (fontSize * LINE_HEIGHT * 100) / PAGE_HEIGHT_PT,
    ),
  );
}

function toInlineAnchor(place: Placement, value: string): FirmaAnchor {
  // The value shrinks (down to 8) until it fits where the field may grow to.
  const fontSize = fitFontSize(value, place.maxWidthPct, place.fontSize);
  const cover =
    place.maxWidthPct > place.markerWidthPct + 0.05 ? RIGHT_COVER_PCT : 0;
  const width = Math.min(
    place.maxWidthPct,
    Math.max(
      place.markerWidthPct + cover,
      textWidthPct(value, fontSize) + 2 * FIELD_PADDING_PCT,
    ),
  );
  return {
    kind: "text",
    anchor: markerOf(place.marker),
    value,
    fontSize,
    widthPct: round2(width),
    xOffsetPct: round2(-place.driftXPct),
    heightPct: fieldHeight(place.markerHeightPct, fontSize),
  };
}

/**
 * A value that must end (`money`) or be centred (`center`) on a line the marker is not on: the field starts at or before the
 * marker's left edge (so its white background covers the whole marker), the value is padded on the left with spaces up to
 * where it must start, and the field reaches at least the marker's right edge. The padding is whole spaces, so the field's
 * own start moves by the remainder: the value lands exactly where it should.
 */
function toAlignedAnchor(
  place: Placement,
  value: string,
  targetPct: number,
): FirmaAnchor {
  const fontSize = place.fontSize;
  const textWidth = textWidthPct(value, fontSize);
  const textLeft =
    place.layout === "money"
      ? targetPct - textWidth
      : targetPct - textWidth / 2;
  const spaceWidth = textWidthPct(NBSP, fontSize);
  const spaces = Math.max(
    0,
    Math.ceil(
      (textLeft - FIELD_PADDING_PCT - place.markerLeftPct) / spaceWidth,
    ),
  );
  const fieldLeft = textLeft - FIELD_PADDING_PCT - spaces * spaceWidth;
  const markerRight = place.markerLeftPct + place.markerWidthPct;
  const textRight =
    fieldLeft + FIELD_PADDING_PCT + spaces * spaceWidth + textWidth;
  // A number that sits right before a word (`right`) must not reach past its marker: the box would hide the word's first letter.
  const slack = place.layout === "right" ? 0 : RIGHT_SLACK_PCT;
  const fieldRight = Math.max(markerRight, textRight + slack);
  return {
    kind: "text",
    anchor: markerOf(place.marker),
    value: NBSP.repeat(spaces) + value,
    fontSize,
    widthPct: round2(fieldRight - fieldLeft),
    xOffsetPct: round2(fieldLeft - place.markerLeftPct - place.driftXPct),
    heightPct: fieldHeight(place.markerHeightPct, fontSize),
  };
}

function toAnchor(
  template: ContractTemplate,
  place: Placement,
  value: string,
): FirmaAnchor {
  if (place.layout === "inline") return toInlineAnchor(place, value);
  const markerRight = place.markerLeftPct + place.markerWidthPct;
  const target =
    place.layout === "money"
      ? template.moneyRightPct
      : place.layout === "right"
        ? markerRight - FIELD_PADDING_PCT
        : place.markerLeftPct + place.markerWidthPct / 2;
  return toAlignedAnchor(place, value, target);
}

/**
 * Every anchor of the contract: one locked text field per marker, then the driver's signature box and date.
 * Pure: the same values always give the same anchors.
 */
export function buildAnchors(
  values: ContractValues,
  template: ContractTemplate,
): FirmaAnchor[] {
  const signature = template.signature;
  const date = template.date;
  return [
    ...template.placements.map((place) =>
      toAnchor(template, place, values[place.key]),
    ),
    {
      kind: "signature",
      anchor: SIGNATURE_MARKER,
      widthPct: signature.widthPct,
      heightPct: signature.heightPct,
      xOffsetPct: 0,
      yOffsetPct: signature.yOffsetPct,
    },
    {
      kind: "date",
      anchor: DATE_MARKER,
      widthPct: date.widthPct,
      heightPct: date.heightPct,
      xOffsetPct: 0,
      fontSize: 11,
    },
  ];
}

const cache = new Map<string, Buffer>();

/** The template PDF's bytes, exactly as stored (read once per file). */
export function loadTemplate(file: string): Buffer {
  let pdf = cache.get(file);
  if (!pdf) {
    pdf = readFileSync(`${import.meta.dirname}/templates/${file}`);
    cache.set(file, pdf);
  }
  return pdf;
}
