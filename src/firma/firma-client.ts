/** One person who signs. firma needs the name split in two. */
export interface FirmaRecipient {
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Where on the page a value goes: firma finds the marker text (`{{LESSEE_NAME}}`) in the uploaded PDF, removes it and puts a
 * field in its place. Sizes are percentages of the page, measured from the marker's own box.
 */
interface AnchorBase {
  /** The marker text exactly as it is printed in the PDF, braces included. */
  anchor: string;
  widthPct: number;
  heightPct: number;
  /** Shift of the field from the marker's top-left corner, in percent of the page (negative = left / up). */
  xOffsetPct: number;
  yOffsetPct?: number;
}

/** A locked text field: the signer sees the value and cannot change it. */
export interface FirmaTextAnchor extends AnchorBase {
  kind: "text";
  value: string;
  /** 8 to 48; firma ignores every other font setting of an anchored field. */
  fontSize: number;
}

/** The signer's signature box. */
export interface FirmaSignatureAnchor extends AnchorBase {
  kind: "signature";
}

/** A date firma fills in with the day the signer signs. */
export interface FirmaDateAnchor extends AnchorBase {
  kind: "date";
  fontSize: number;
}

export type FirmaAnchor =
  FirmaTextAnchor | FirmaSignatureAnchor | FirmaDateAnchor;

export interface FirmaSendRequest {
  /** The title firma shows in its email and dashboard. */
  name: string;
  /** The template PDF exactly as stored (anchors must run on the original file, never a processed one). */
  pdf: Buffer;
  recipient: FirmaRecipient;
  anchors: FirmaAnchor[];
}

export interface FirmaSent {
  /** firma's id of the signing request: one envelope, one contract. */
  signingRequestId: string;
}

/**
 * The only thing the contracts need from firma (D70) in step 3: create a signing request from our PDF and send it to the
 * driver in one call. The real adapter is `FirmaHttpClient`; tests use a fake (same pattern as `QuoClient`).
 *
 * Implementations throw `FirmaError` on any failure and never return a guess.
 */
export interface FirmaClient {
  createAndSend(request: FirmaSendRequest): Promise<FirmaSent>;
}

/** Injection token. The value is null when `FIRMA_API_KEY` is not set: sending then answers 503. */
export const FIRMA_CLIENT = Symbol("FIRMA_CLIENT");

/**
 * firma refused, did not answer, or answered something we cannot use. `message` is a plain sentence that carries firma's
 * own reason; it never holds the API key or the contract's values.
 */
export class FirmaError extends Error {
  constructor(
    message: string,
    /** The HTTP status firma answered with; null when it did not answer at all (network, timeout). */
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FirmaError";
  }
}
