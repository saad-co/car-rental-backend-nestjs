/** One file to put in a ZIP. */
export interface ZipEntry {
  /** The path inside the ZIP, forward slashes, no leading slash. */
  name: string;
  data: Buffer;
}

/** CRC-32 (the checksum ZIP files carry), table-driven. Computed here so the export needs no extra library. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The fixed time every entry gets (1980-01-01 00:00, the ZIP epoch): the same files always make the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11 of the flags: file names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/**
 * Makes a ZIP file in memory, entries stored without compression (the photos are JPEGs, which do not shrink). Plain ZIP, not
 * ZIP64: the limits (65,535 files, 4 GB) are far above one inspection (about 40 files), and anything over throws.
 * @throws RangeError too many files or too many bytes for a plain ZIP.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) throw new RangeError("Too many files.");
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk number, internal and external attributes: all zero
    central.writeUInt32LE(offset, 42); // where the local header starts
    centrals.push(central, name);

    offset += local.length + name.length + size;
    if (offset > MAX_BYTES) throw new RangeError("Too many bytes.");
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize > MAX_BYTES) throw new RangeError("Too many bytes.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16); // where the central directory starts
  return Buffer.concat([...locals, ...centrals, end]);
}
