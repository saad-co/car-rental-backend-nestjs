import {
  FirmaError,
  type FirmaAnchor,
  type FirmaClient,
  type FirmaDownload,
  type FirmaLookupOptions,
  type FirmaRequestState,
  type FirmaSendRequest,
  type FirmaSent,
} from "./firma-client.js";
import { firstViewedAt, toFirmaRequestState } from "./firma-request-state.js";

const REQUESTS_URL =
  "https://api.firma.dev/functions/v1/signing-request-api/signing-requests";
const FIRMA_URL = `${REQUESTS_URL}/create-and-send`;

/** Largest file we download (the same limit as the texted-in files). A bigger one is refused while downloading. */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** The id firma wants on the recipient so each anchor can name who signs it. */
const RECIPIENT_ID = "temp_1";

export interface FirmaHttpClientOptions {
  /** From app.firma.dev > Developers. Read from `FIRMA_API_KEY`; a test key and a live key are different keys. */
  apiKey: string;
  /** Give up after this long (default 20 s). */
  timeoutMs?: number;
  /** For tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * `FirmaClient` on top of firma's REST API. The key goes alone in the `Authorization` header, with no `Bearer`
 * prefix. Anchor tags only work with an uploaded document, so every send uploads the PDF (base64) with its anchors.
 */
export class FirmaHttpClient implements FirmaClient {
  constructor(private readonly options: FirmaHttpClientOptions) {
    if (!options.apiKey)
      throw new Error("firma API key is missing (FIRMA_API_KEY).");
  }

  async createAndSend(request: FirmaSendRequest): Promise<FirmaSent> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(FIRMA_URL, {
      method: "POST",
      headers: {
        Authorization: this.options.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: request.name,
        document: request.pdf.toString("base64"),
        recipients: [
          {
            id: RECIPIENT_ID,
            first_name: request.recipient.firstName,
            last_name: request.recipient.lastName,
            email: request.recipient.email,
            designation: "Signer",
          },
        ],
        anchor_tags: request.anchors.map(toAnchorTag),
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
    }).catch((error: unknown) => {
      // The request may have reached firma before the wire broke: say so, so nobody sends the contract twice blindly.
      throw new FirmaError(
        `Could not get an answer from firma (${
          error instanceof Error ? error.message : String(error)
        }). It may still have created the request: check firma's dashboard before sending again.`,
        null,
        { cause: error },
      );
    });

    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      throw new FirmaError(
        `firma refused the request (${response.status}): ${firmaReason(json, text, response)}`,
        response.status,
      );
    }
    const id =
      json !== null && typeof json === "object" && "id" in json
        ? (json as { id: unknown }).id
        : undefined;
    if (typeof id !== "string" || id === "") {
      throw new FirmaError(
        `firma answered ${response.status} but gave no signing request id.`,
        response.status,
      );
    }
    return { signingRequestId: id };
  }

  /**
   * Where the request is (step 4, D75): one call for the request, and, only while it is still `sent`, one for the audit
   * trail to see whether the driver opened it (the request has no such field). A finished, declined, cancelled or expired
   * request cannot become `viewed`, so it costs one call.
   */
  async getSigningRequest(
    id: string,
    options: FirmaLookupOptions = {},
  ): Promise<FirmaRequestState> {
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 20_000;
    const path = encodeURIComponent(id);
    const request = await this.getJson(`${REQUESTS_URL}/${path}`, timeoutMs);
    // Parse once without the audit trail to learn the status, then add the viewing time when it can matter.
    const state = toFirmaRequestState(request, null);
    if (state.status !== "sent") return state;
    const audit = await this.getJson(
      `${REQUESTS_URL}/${path}/audit`,
      timeoutMs,
    );
    return { ...state, viewedAt: firstViewedAt(audit) };
  }

  /**
   * Downloads a file from a link firma gave. The links are pre-signed (they work for an hour and need no key), so the
   * `Authorization` key is never sent to them: it goes only to firma's API. Only `https`, 25 MB at most, no redirects.
   */
  async download(url: string): Promise<FirmaDownload> {
    const doFetch = this.options.fetchImpl ?? fetch;
    if (new URL(url).protocol !== "https:") {
      throw new FirmaError("Refusing a non-https file link.");
    }
    const response = await doFetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new FirmaError(
        `Could not download the file from firma (${
          error instanceof Error ? error.message : String(error)
        }).`,
        null,
        { cause: error },
      );
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FirmaError(
        `firma's file link answered ${response.status}.`,
        response.status,
      );
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel();
      throw new FirmaError(
        `The file is too large (${declared} bytes; the limit is ${MAX_DOWNLOAD_BYTES}).`,
      );
    }
    // Read in pieces and stop as soon as the limit is passed, whatever the headers claimed.
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      try {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_DOWNLOAD_BYTES) {
            throw new FirmaError(
              `The file is too large (the limit is ${MAX_DOWNLOAD_BYTES} bytes).`,
            );
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (error instanceof FirmaError) throw error;
        throw new FirmaError(
          `The download from firma broke off (${
            error instanceof Error ? error.message : String(error)
          }).`,
          null,
          { cause: error },
        );
      }
    }
    if (size === 0)
      throw new FirmaError("firma's file link gave an empty file.");
    return {
      body: Buffer.concat(chunks),
      contentType:
        response.headers.get("content-type")?.split(";")[0]?.trim() || null,
    };
  }

  /** One authorised GET on firma's API; its JSON answer, or a `FirmaError` carrying firma's own reason. */
  private async getJson(url: string, timeoutMs: number): Promise<unknown> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(url, {
      method: "GET",
      headers: { Authorization: this.options.apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => {
      throw new FirmaError(
        `Could not get an answer from firma (${
          error instanceof Error ? error.message : String(error)
        }).`,
        null,
        { cause: error },
      );
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      throw new FirmaError(
        `firma refused the request (${response.status}): ${firmaReason(json, text, response)}`,
        response.status,
      );
    }
    return json;
  }
}

/** firma's own words for a refusal (`{ error, code }`), or the start of the body when it is not JSON. */
function firmaReason(json: unknown, text: string, response: Response): string {
  if (json !== null && typeof json === "object") {
    const { error, message } = json as { error?: unknown; message?: unknown };
    if (typeof error === "string" && error !== "") return error;
    if (typeof message === "string" && message !== "") return message;
  }
  return text.slice(0, 200) || response.statusText;
}

/** One of our anchors as firma's `anchor_tags` entry. Every marker is matched everywhere it appears (`occurrence: 0`). */
function toAnchorTag(anchor: FirmaAnchor): Record<string, unknown> {
  const common = {
    anchor_string: anchor.anchor,
    recipient_id: RECIPIENT_ID,
    width: anchor.widthPct,
    height: anchor.heightPct,
    x_offset: anchor.xOffsetPct,
    y_offset: anchor.yOffsetPct ?? 0,
    offset_units: "percent",
    // Every match of the marker gets the same field: firma cannot pick one among duplicates on a page.
    occurrence: 0,
    // A marker missing from the PDF is an error, never a silently empty spot.
    ignore_if_not_present: false,
    // The marker text is removed, and the field's white background covers what is left of it (the tails of the braces and
    // the underscores sit below the line and survive the removal alone).
    remove_anchor_text: true,
    add_white_background: true,
  };
  switch (anchor.kind) {
    case "text":
      return {
        ...common,
        type: "text",
        read_only: true,
        read_only_value: anchor.value,
        font_size: anchor.fontSize,
      };
    case "date":
      return {
        ...common,
        type: "date",
        date_signing_default: true,
        font_size: anchor.fontSize,
      };
    case "signature":
      return { ...common, type: "signature" };
  }
}
