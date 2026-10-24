import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { LicenceSlot } from "./template-kit.js";

/** The driver's licence file could not be put on the contract. The message is safe to show: it never carries the file. */
export class LicenceError extends Error {}

export interface LicenceFile {
  body: Buffer;
}

/** The longest side the picture keeps: a licence card is 85 mm wide on the page, so this is far more than enough to read. */
const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 85;
/** Kept clear of the page edge when a slot runs past the bottom of the page. */
const PAGE_MARGIN_PT = 24;

function isPdf(body: Buffer): boolean {
  return body.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Any picture firma-sized: upright (EXIF), at most `MAX_SIDE_PX` on its longest side, flat white background, JPEG. */
async function normaliseImage(body: Buffer): Promise<Buffer> {
  try {
    return await sharp(body)
      .rotate()
      .resize({
        width: MAX_SIDE_PX,
        height: MAX_SIDE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch {
    throw new LicenceError(
      "The driver's licence file cannot be read as a picture.",
    );
  }
}

/**
 * Draws the driver's licence on the last page of the template, inside the slot the sample's photo had (D76). firma has no
 * read-only picture field, so the picture is part of the PDF we upload; the markers' text is untouched, so the anchors still
 * match (checked against firma, 2026-10-24). The picture is scaled to fit, never stretched, and centred in the slot.
 * A licence that is a PDF has its first page drawn the same way.
 * @throws LicenceError the file is neither a readable picture nor a readable PDF.
 */
export async function placeLicence(
  template: Buffer,
  licence: LicenceFile,
  slot: LicenceSlot,
): Promise<Buffer> {
  const doc = await PDFDocument.load(template);
  const page = doc.getPage(doc.getPageCount() - 1);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const left = (slot.leftPct / 100) * pageWidth;
  const top = (slot.topPct / 100) * pageHeight;
  const width = (slot.widthPct / 100) * pageWidth;
  // A slot that runs past the bottom of the page is cut to what the page has.
  const height = Math.min(
    (slot.heightPct / 100) * pageHeight,
    pageHeight - top - PAGE_MARGIN_PT,
  );
  const bottom = pageHeight - top - height;

  let drawn: { width: number; height: number };
  if (isPdf(licence.body)) {
    try {
      const source = await PDFDocument.load(licence.body);
      if (source.getPageCount() === 0) throw new Error("no page");
      const [embedded] = await doc.embedPdf(source, [0]);
      const scale = Math.min(width / embedded.width, height / embedded.height);
      drawn = {
        width: embedded.width * scale,
        height: embedded.height * scale,
      };
      page.drawPage(embedded, {
        x: left + (width - drawn.width) / 2,
        y: bottom + (height - drawn.height) / 2,
        width: drawn.width,
        height: drawn.height,
      });
    } catch {
      throw new LicenceError(
        "The driver's licence file cannot be read as a PDF.",
      );
    }
  } else {
    const image = await doc.embedJpg(await normaliseImage(licence.body));
    const scale = Math.min(width / image.width, height / image.height);
    drawn = { width: image.width * scale, height: image.height * scale };
    page.drawImage(image, {
      x: left + (width - drawn.width) / 2,
      y: bottom + (height - drawn.height) / 2,
      width: drawn.width,
      height: drawn.height,
    });
  }
  return Buffer.from(await doc.save());
}
