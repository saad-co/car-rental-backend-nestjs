import sharp from "sharp";
import {
  buildInspectionReport,
  type ReportData,
  type ReportPhoto,
} from "./inspection-report.js";

const base: Omit<ReportData, "shots" | "damagePhotos"> = {
  reference: "INS-2026-000001",
  typeLabel: "Check-in",
  statusLabel: "Submitted",
  driverName: "Test Driver",
  vehicle: "2021 Test Camry",
  pairedReference: null,
  submittedAt: null,
  odometer: "1 mi",
  fuel: "Full",
  place: null,
  device: null,
  attestedAt: null,
  review: "Not reviewed",
  photosHeading: "Photos: 1 of 21 shots, 0 damage close-ups",
  damageSummary: null,
  damageItems: [],
  generatedAt: new Date("2026-11-17T12:00:00Z"),
  generatedBy: "admin@test",
};

const photo = (thumb: Buffer): ReportPhoto => ({
  title: "Front",
  thumb,
  capturedAt: null,
  uploadedAt: new Date("2026-11-17T12:00:00Z"),
  sha256: "a".repeat(64),
  driverNote: null,
});

describe("buildInspectionReport thumbnails", () => {
  it("draws a small thumbnail that Node keeps in its shared buffer pool", async () => {
    const jpeg = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#3b82f6" },
    })
      .jpeg()
      .toBuffer();
    // Under 4 KB, `Buffer.from(typedArray)` is cut from Node's shared pool: its bytes start at an offset inside a bigger array.
    // This is how the S3 storage returns small files, and pdf-lib used to read such a buffer from the wrong place.
    Buffer.from([1, 2, 3]); // makes sure the next pooled buffer does not start at 0
    const pooled = Buffer.from(new Uint8Array(jpeg));
    expect(jpeg.length).toBeLessThan(4096);
    expect(pooled.byteOffset).not.toBe(0);

    const problems: unknown[] = [];
    const pdf = await buildInspectionReport(
      { ...base, shots: [photo(pooled)], damagePhotos: [] },
      (_photo, error) => problems.push(error),
    );
    expect(problems).toEqual([]);
    expect(pdf.toString("latin1")).toContain("/Subtype /Image");
  });

  it("reports a thumbnail that is not a JPEG instead of dropping it silently", async () => {
    const problems: unknown[] = [];
    const pdf = await buildInspectionReport(
      {
        ...base,
        shots: [photo(Buffer.from("<Error>not a jpeg</Error>"))],
        damagePhotos: [],
      },
      (_photo, error) => problems.push(error),
    );
    expect(problems).toHaveLength(1);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
