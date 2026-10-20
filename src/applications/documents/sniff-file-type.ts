/** A file type we accept for application documents (D68): what to store it as, and its file extension. */
export interface SniffedFileType {
  contentType: "image/jpeg" | "image/png" | "application/pdf";
  extension: "jpg" | "png" | "pdf";
}

/**
 * Tells JPEG, PNG and PDF apart by the first bytes of the file (their "magic numbers"), not by the file name or the
 * type the browser says: both are chosen by whoever sends the request, the bytes are the file itself. A text file
 * renamed `licence.png` is refused.
 *
 * @returns the type, or null for anything else (including an empty file).
 */
export function sniffFileType(body: Buffer): SniffedFileType | null {
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  ) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    body.length >= 8 &&
    body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (body.length >= 5 && body.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { contentType: "application/pdf", extension: "pdf" };
  }
  return null;
}
