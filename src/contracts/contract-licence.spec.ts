import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { LicenceError, placeLicence } from "./contract-licence.js";
import { loadTemplate, templateFor } from "./contract-template.js";

const slot = templateFor("IL")!.licenceSlot;

/** A made-up 3:2 "licence": flat grey, so nothing personal is ever in a test. */
async function picture(
  format: "jpeg" | "png" | "webp" | "gif",
  width = 900,
  height = 600,
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: "#888888" },
  });
  return base[format]().toBuffer();
}

async function blankPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    // A page with nothing on it has no content stream, which cannot be drawn into another page.
    doc
      .addPage([612, 792])
      .drawRectangle({ x: 10, y: 10, width: 100, height: 60 });
  }
  return Buffer.from(await doc.save());
}

/** How many pictures the page draws, read from the saved PDF. */
async function imagesOnLastPage(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(doc.getPageCount() - 1);
  const resources = page.node.Resources();
  const xobjects = resources?.lookup(doc.context.obj("XObject"));
  return xobjects && "entries" in xobjects
    ? (xobjects as unknown as { entries(): unknown[] }).entries().length
    : 0;
}

describe("placeLicence", () => {
  it.each(["jpeg", "png", "webp", "gif"] as const)(
    "draws a %s picture on the last page and keeps the page count",
    async (format) => {
      const template = await blankPdf(3);
      const result = await placeLicence(
        template,
        { body: await picture(format) },
        slot,
      );
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
      expect(await imagesOnLastPage(result)).toBe(1);
    },
  );

  it("draws the first page of a PDF licence", async () => {
    const result = await placeLicence(
      await blankPdf(2),
      { body: await blankPdf(2) },
      slot,
    );
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
  });

  it("works on the real templates and leaves them readable", async () => {
    for (const state of ["IL", "CA"]) {
      const template = templateFor(state)!;
      const result = await placeLicence(
        loadTemplate(template.file),
        { body: await picture("jpeg") },
        template.licenceSlot,
      );
      expect(result.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(result.length).toBeLessThan(5_000_000);
    }
  });

  it("makes a big picture small before it goes in", async () => {
    const big = await picture("jpeg", 4200, 2650);
    const result = await placeLicence(await blankPdf(1), { body: big }, slot);
    expect(result.length).toBeLessThan(big.length);
    expect(result.length).toBeLessThan(1_000_000);
  });

  it("refuses a file that is neither a picture nor a PDF, without showing it", async () => {
    await expect(
      placeLicence(
        await blankPdf(1),
        { body: Buffer.from("secret text that is not an image") },
        slot,
      ),
    ).rejects.toThrow(LicenceError);
    await expect(
      placeLicence(
        await blankPdf(1),
        { body: Buffer.from("secret text that is not an image") },
        slot,
      ),
    ).rejects.not.toThrow(/secret/);
  });

  it("refuses a broken PDF licence", async () => {
    await expect(
      placeLicence(
        await blankPdf(1),
        { body: Buffer.from("%PDF-1.4 broken") },
        slot,
      ),
    ).rejects.toThrow(LicenceError);
  });
});
