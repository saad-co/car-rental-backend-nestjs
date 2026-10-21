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
 * Where a signing request is, as firma says it (step 4, D75). firma's `status` is a set of flags that can be true together
 * (`sent` stays true after a finish or a cancel); the adapter resolves them into this one word, finished first.
 */
export type FirmaRequestStatus =
  "sent" | "finished" | "declined" | "cancelled" | "expired";

/** What the contracts need to know about one signing request. Every date is firma's own time. */
export interface FirmaRequestState {
  id: string;
  status: FirmaRequestStatus;
  /** When the driver first opened the signing page (from firma's audit trail); only looked up while `sent`. */
  viewedAt: Date | null;
  /** The time of the end state: finished, declined or cancelled (`expires_at` for expired); null while `sent`. */
  endedAt: Date | null;
  /**
   * Links to the signed PDF (the contract with firma's certificate page) and to the certificate alone. Both are null
   * until firma has finished making them (about 20 seconds after the signing) and for any request that was not
   * signed. A link works for an hour and needs no key: fetch it at once, never store it.
   */
  signedPdfUrl: string | null;
  certificateUrl: string | null;
}

/** One file downloaded from a firma link. */
export interface FirmaDownload {
  body: Buffer;
  contentType: string | null;
}

/** Options for one lookup. */
export interface FirmaLookupOptions {
  /** Give up on each call to firma after this long (default 20 s). The webhook answers firma within 5 s. */
  timeoutMs?: number;
}

/**
 * What the contracts need from firma (D70): create a signing request from our PDF and send it to the driver (step 3), then
 * read where it is and fetch the signed files (step 4). The real adapter is `FirmaHttpClient`; tests use a fake (same
 * pattern as `QuoClient`).
 *
 * Implementations throw `FirmaError` on any failure and never return a guess.
 */
export interface FirmaClient {
  createAndSend(request: FirmaSendRequest): Promise<FirmaSent>;
  /** firma is the authority on a contract's status: this is the one place we ask it. */
  getSigningRequest(
    id: string,
    options?: FirmaLookupOptions,
  ): Promise<FirmaRequestState>;
  /** Downloads a file from one of the links of a `FirmaRequestState` (25 MB at most, 30 s). */
  download(url: string): Promise<FirmaDownload>;
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
