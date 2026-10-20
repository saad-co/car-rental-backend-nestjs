import { sniffFileType } from "./sniff-file-type.js";

describe("sniffFileType (D64)", () => {
  it("knows JPEG, PNG and PDF by their first bytes", () => {
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(
      sniffFileType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toEqual({ contentType: "image/png", extension: "png" });
    expect(sniffFileType(Buffer.from("%PDF-1.7\n..."))).toEqual({
      contentType: "application/pdf",
      extension: "pdf",
    });
  });

  it("refuses everything else: text, GIF, a truncated header, an empty file", () => {
    expect(sniffFileType(Buffer.from("licence.png, honest"))).toBeNull();
    expect(sniffFileType(Buffer.from("GIF89a..."))).toBeNull();
    expect(sniffFileType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffFileType(Buffer.from("%PDF"))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });
});
