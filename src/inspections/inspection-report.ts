import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

/** One photo as the report shows it. `thumb` is null when the file could not be read (the report says so instead of hiding it). */
export interface ReportPhoto {
  title: string;
  thumb: Buffer | null;
  capturedAt: Date | null;
  uploadedAt: Date;
  sha256: string;
  driverNote: string | null;
}

/** A line of the damage section: what staff marked on the check-out and what became of it. */
export interface ReportDamage {
  title: string;
  description: string;
  charged: string | null;
}

/** Everything the one-file report prints. Plain values, so the report can be tested without a database. */
export interface ReportData {
  reference: string;
  typeLabel: string;
  statusLabel: string;
  driverName: string;
  vehicle: string;
  pairedReference: string | null;
  submittedAt: Date | null;
  odometer: string;
  fuel: string;
  place: string | null;
  device: string | null;
  attestedAt: Date | null;
  review: string;
  /** The heading over the photos, e.g. "Photos: 21 of 21 shots, 2 damage close-ups". */
  photosHeading: string;
  /** What the driver answered about damage, in one line; null for an inspection made before the per-shot question (D112). */
  damageSummary: string | null;
  /** The shots in order, each followed by its damage close-ups. */
  shots: ReportPhoto[];
  /** Free-standing damage photos of an inspection made before D112. */
  damagePhotos: ReportPhoto[];
  damageItems: ReportDamage[];
  generatedAt: Date;
  generatedBy: string;
}

const PAGE_W = 595.28; // A4 in points
const PAGE_H = 841.89;
const MARGIN = 40;
const GAP = 12;
const COLUMNS = 3;
const CELL_W = (PAGE_W - 2 * MARGIN - (COLUMNS - 1) * GAP) / COLUMNS;
const THUMB_H = (CELL_W * 3) / 4;
const GREY = rgb(0.4, 0.4, 0.4);
const BLACK = rgb(0.1, 0.1, 0.1);

/** The time as a person in Chicago reads it, e.g. "Nov 16, 2026, 3:04 PM". */
export function chicagoTime(date: Date | null): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * The built-in PDF fonts only draw Latin-1 text, so a character outside it would make the whole report fail. Common typographic
 * marks become their plain twins and anything else becomes "?"; the real text is untouched in the database.
 */
export function pdfSafe(text: string): string {
  return Array.from(text.normalize("NFC"))
    .map((char) => {
      const code = char.codePointAt(0)!;
      if (char === "\n" || char === "\t") return " ";
      if (code >= 32 && code <= 126) return char;
      if (code >= 160 && code <= 255) return char;
      const plain: Record<string, string> = {
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
        "…": "...",
        " ": " ",
      };
      return plain[char] ?? "?";
    })
    .join("");
}

/** A small page writer: a cursor going down the page, wrapped text, and a new page when the next block does not fit. */
class Sheet {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  /** Starts a new page unless `height` points still fit above the bottom margin. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + 14) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of pdfSafe(text).split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) {
        line = trial;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the line (a hash, a long URL) is cut where it no longer fits.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (
          cut > 1 &&
          font.widthOfTextAtSize(rest.slice(0, cut), size) > width
        )
          cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  }

  /** Writes wrapped text at the cursor and moves down; returns the number of lines. */
  text(
    text: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
    } = {},
  ): number {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.font;
    const x = options.x ?? MARGIN;
    const lines = this.wrap(
      text,
      font,
      size,
      options.width ?? PAGE_W - MARGIN - x,
    );
    for (const line of lines) {
      this.ensure(size + 3);
      this.page.drawText(line, {
        x,
        y: this.y - size,
        size,
        font,
        color: options.color ?? BLACK,
      });
      this.y -= size + 3;
    }
    return lines.length;
  }

  gap(points: number): void {
    this.y -= points;
  }
}

/** Called when a photo's picture could not be put on the page: which photo, and why. */
export type PhotoProblem = (photo: ReportPhoto, error: unknown) => void;

/**
 * Draws a block of photos three to a row: the picture (or a note that the file is missing), the title, when it was received by
 * our server, the first characters of its fingerprint and the driver's note. Rows never split across pages.
 */
async function drawPhotos(
  sheet: Sheet,
  photos: ReportPhoto[],
  onProblem?: PhotoProblem,
): Promise<void> {
  for (let i = 0; i < photos.length; i += COLUMNS) {
    const row = photos.slice(i, i + COLUMNS);
    const noteLines = Math.max(
      ...row.map((p) =>
        p.driverNote
          ? sheet.wrap(`Note: ${p.driverNote}`, sheet.font, 7.5, CELL_W).length
          : 0,
      ),
    );
    const rowHeight = THUMB_H + 4 + 11 + 9 + 9 + noteLines * 9 + GAP;
    sheet.ensure(rowHeight);
    const top = sheet.y;
    for (let c = 0; c < row.length; c++) {
      const photo = row[c];
      const x = MARGIN + c * (CELL_W + GAP);
      let drawn = false;
      if (photo.thumb) {
        try {
          // A copy that owns its memory: Node serves buffers under 4 KB from a shared pool, and pdf-lib reads such a buffer from
          // the start of the pool instead of the start of the buffer ("SOI not found in JPEG"). Small thumbnails hit this.
          const image = await sheet.doc.embedJpg(new Uint8Array(photo.thumb));
          const scale = Math.min(CELL_W / image.width, THUMB_H / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          sheet.page.drawImage(image, {
            x: x + (CELL_W - w) / 2,
            y: top - THUMB_H + (THUMB_H - h) / 2,
            width: w,
            height: h,
          });
          drawn = true;
        } catch (error) {
          // The box below says so in the PDF, and the caller is told why (it logs it and counts it): never a silent blank.
          onProblem?.(photo, error);
        }
      }
      if (!drawn) {
        sheet.page.drawRectangle({
          x,
          y: top - THUMB_H,
          width: CELL_W,
          height: THUMB_H,
          borderColor: GREY,
          borderWidth: 0.5,
        });
        sheet.page.drawText("Photo file not available", {
          x: x + 8,
          y: top - THUMB_H / 2,
          size: 8,
          font: sheet.font,
          color: GREY,
        });
      }
      let y = top - THUMB_H - 4 - 10;
      sheet.page.drawText(pdfSafe(photo.title), {
        x,
        y,
        size: 9,
        font: sheet.bold,
        color: BLACK,
      });
      y -= 9;
      sheet.page.drawText(`Received ${chicagoTime(photo.uploadedAt)}`, {
        x,
        y,
        size: 7.5,
        font: sheet.font,
        color: GREY,
      });
      y -= 9;
      sheet.page.drawText(`SHA-256 ${photo.sha256.slice(0, 16)}...`, {
        x,
        y,
        size: 7.5,
        font: sheet.font,
        color: GREY,
      });
      if (photo.driverNote) {
        for (const line of sheet.wrap(
          `Note: ${photo.driverNote}`,
          sheet.font,
          7.5,
          CELL_W,
        )) {
          y -= 9;
          sheet.page.drawText(line, {
            x,
            y,
            size: 7.5,
            font: sheet.font,
            color: BLACK,
          });
        }
      }
    }
    sheet.y = top - rowHeight;
  }
}

/**
 * The one-file report of an inspection (spec p. 11): who, what vehicle, readings, times and place, the driver's confirmation,
 * the review, every photo as a thumbnail with its fingerprint, the damage photos with their notes, and the damage staff marked.
 * A4, built-in fonts, no network. A photo that cannot be read is shown as a box that says so.
 */
export async function buildInspectionReport(
  data: ReportData,
  onProblem?: PhotoProblem,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Vehicle inspection ${data.reference}`);
  doc.setCreator("GonzoCar");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sheet = new Sheet(doc, font, bold);

  sheet.text(`Vehicle ${data.typeLabel.toLowerCase()} report`, {
    size: 18,
    bold: true,
  });
  sheet.text(`${data.reference} - ${data.statusLabel}`, {
    size: 11,
    color: GREY,
  });
  sheet.gap(8);

  const facts: [string, string][] = [
    ["Driver", data.driverName],
    ["Vehicle", data.vehicle],
    ["Submitted", chicagoTime(data.submittedAt)],
    ["Mileage", data.odometer],
    ["Fuel", data.fuel],
    ["Location when submitted", data.place ?? "Not shared"],
    ["Device", data.device ?? "-"],
    [
      "Photos confirmed by driver",
      data.attestedAt ? chicagoTime(data.attestedAt) : "No",
    ],
    ["Staff review", data.review],
  ];
  if (data.pairedReference)
    facts.push(["Compared with check-in", data.pairedReference]);
  for (const [label, value] of facts) {
    sheet.ensure(14);
    sheet.page.drawText(pdfSafe(label), {
      x: MARGIN,
      y: sheet.y - 10,
      size: 9,
      font: bold,
      color: GREY,
    });
    const before = sheet.y;
    sheet.text(value, {
      x: MARGIN + 190,
      width: PAGE_W - MARGIN - (MARGIN + 190),
    });
    sheet.y = Math.min(sheet.y, before - 13);
  }

  if (data.damageItems.length > 0) {
    sheet.gap(10);
    sheet.text("New damage marked by staff", { size: 13, bold: true });
    for (const item of data.damageItems) {
      sheet.text(
        `${item.title}: ${item.description}${item.charged ? ` (charged ${item.charged})` : ""}`,
      );
    }
  }

  sheet.gap(12);
  sheet.text(data.photosHeading, { size: 13, bold: true });
  if (data.damageSummary) sheet.text(data.damageSummary, { color: GREY });
  sheet.gap(4);
  await drawPhotos(sheet, data.shots, onProblem);

  // Before D112 damage photos stood apart, at the end of the walk-around.
  if (data.damageSummary === null || data.damagePhotos.length > 0) {
    sheet.gap(6);
    sheet.text(
      `Damage photos added by the driver (${data.damagePhotos.length})`,
      { size: 13, bold: true },
    );
    sheet.gap(4);
    if (data.damagePhotos.length === 0)
      sheet.text("The driver reported no damage.", { color: GREY });
    else await drawPhotos(sheet, data.damagePhotos, onProblem);
  }

  const pages = doc.getPages();
  pages.forEach((page, i) => {
    page.drawText(
      pdfSafe(
        `${data.reference} - generated ${chicagoTime(data.generatedAt)} by ${data.generatedBy} - page ${i + 1} of ${pages.length}`,
      ),
      { x: MARGIN, y: 22, size: 7.5, font, color: GREY },
    );
  });
  return Buffer.from(await doc.save());
}
