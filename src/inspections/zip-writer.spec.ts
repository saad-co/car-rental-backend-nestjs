import { crc32 as nodeCrc32 } from "node:zlib";
import { buildZip, crc32 } from "./zip-writer.js";

/** Reads a ZIP back through its central directory: the names, the stored bytes and the checksum each one claims. */
function readZip(zip: Buffer) {
  const endAt = zip.length - 22;
  expect(zip.readUInt32LE(endAt)).toBe(0x06054b50);
  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  const files: { name: string; data: Buffer; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    expect(zip.readUInt32LE(localAt)).toBe(0x04034b50);
    const localName = zip.readUInt16LE(localAt + 26);
    const dataAt = localAt + 30 + localName;
    files.push({ name, data: zip.subarray(dataAt, dataAt + size), crc });
    at += 46 + nameLength;
  }
  return files;
}

describe("crc32", () => {
  it("matches Node's own checksum", () => {
    for (const text of ["", "a", "The quick brown fox", "x".repeat(10_000)]) {
      expect(crc32(Buffer.from(text))).toBe(nodeCrc32(text));
    }
  });
});

describe("buildZip", () => {
  it("stores every file under its name with the right bytes and checksum", () => {
    const entries = [
      { name: "INS-1/01_EXT_FRONT.jpg", data: Buffer.from([0xff, 0xd8, 1, 2]) },
      { name: "INS-1/damage_1.jpg", data: Buffer.from("second") },
      { name: "INS-1/empty.txt", data: Buffer.alloc(0) },
    ];
    const files = readZip(buildZip(entries));
    expect(files.map((f) => f.name)).toEqual(entries.map((e) => e.name));
    files.forEach((file, i) => {
      expect(file.data.equals(entries[i].data)).toBe(true);
      expect(file.crc).toBe(nodeCrc32(entries[i].data));
    });
  });

  it("writes names as UTF-8", () => {
    const [file] = readZip(
      buildZip([{ name: "dañado.jpg", data: Buffer.from("x") }]),
    );
    expect(file.name).toBe("dañado.jpg");
  });

  it("makes the same bytes for the same files (no clock inside)", () => {
    const entries = [{ name: "a.txt", data: Buffer.from("same") }];
    expect(buildZip(entries).equals(buildZip(entries))).toBe(true);
  });

  it("makes a valid empty ZIP", () => {
    expect(readZip(buildZip([]))).toEqual([]);
  });
});
