import {
  DocumentSourceError,
  type DocumentSource,
  type FetchedDocument,
} from "./document-source.js";

/** Largest file we copy. Bigger ones are refused while downloading, so one huge file cannot fill memory. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export interface SupabaseDocumentSourceOptions {
  /** Full address of the website's `get-driver-document` function. From `DOCUMENTS_SOURCE_URL`. */
  functionUrl: string;
  /** The shared secret that function checks (`DOCUMENTS_READ_TOKEN` on the website's side). From `DOCUMENTS_SOURCE_TOKEN`. */
  token: string;
  /** Give up on one request after this long (default 30 s). */
  timeoutMs?: number;
  /** For tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * `DocumentSource` on top of the website's read-only edge function (D54). Two steps, because the bucket is
 * private: we ask the function for a signed link to one path (it answers `{ "url": ... }`, valid for 60 seconds),
 * then download that link. The function only creates links; it never lists, moves or deletes anything.
 *
 * Its answers: 401 wrong token, 404 no such file, 400 a path it does not accept.
 */
export class SupabaseDocumentSource implements DocumentSource {
  constructor(private readonly options: SupabaseDocumentSourceOptions) {
    if (!options.functionUrl.startsWith("https://"))
      throw new Error("DOCUMENTS_SOURCE_URL must be an https address.");
    if (!options.token) throw new Error("DOCUMENTS_SOURCE_TOKEN is missing.");
  }

  async fetch(path: string): Promise<FetchedDocument> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const timeout = () => AbortSignal.timeout(this.options.timeoutMs ?? 30_000);

    // 1. A signed link for this one file.
    const signed = await doFetch(this.options.functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-documents-token": this.options.token,
      },
      body: JSON.stringify({ path }),
      signal: timeout(),
    }).catch((error: unknown) => {
      throw new DocumentSourceError(
        "Could not reach the website's document storage. It will be tried again.",
        false,
        false,
        { cause: error },
      );
    });
    if (signed.status === 401)
      throw new DocumentSourceError(
        "The website refused our access to its documents (token). Ask the developer to check DOCUMENTS_SOURCE_TOKEN.",
        false,
        true,
      );
    if (signed.status === 404)
      throw new DocumentSourceError(
        "The website's storage no longer has this file (it may have been deleted there).",
        true,
      );
    if (signed.status === 400)
      throw new DocumentSourceError(
        "The website did not accept this file's path.",
        true,
      );
    if (!signed.ok)
      throw new DocumentSourceError(
        `The website's document storage answered ${signed.status}. It will be tried again.`,
      );
    const answer = (await signed.json().catch(() => null)) as {
      url?: unknown;
    } | null;
    if (typeof answer?.url !== "string" || !answer.url.startsWith("https://"))
      throw new DocumentSourceError(
        "The website's document storage gave an answer we could not read.",
      );

    // 2. The file itself, from the 60-second link.
    const file = await doFetch(answer.url, { signal: timeout() }).catch(
      (error: unknown) => {
        throw new DocumentSourceError(
          "Could not download the file from the website's storage. It will be tried again.",
          false,
          false,
          { cause: error },
        );
      },
    );
    if (file.status === 404)
      throw new DocumentSourceError(
        "The website's storage no longer has this file (it may have been deleted there).",
        true,
      );
    if (!file.ok)
      throw new DocumentSourceError(
        `The website's storage answered ${file.status} for the file. It will be tried again.`,
      );
    const declared = Number(file.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
      await file.body?.cancel();
      throw new DocumentSourceError(
        "The file is too large to copy (over 25 MB).",
        true,
      );
    }

    // Read in pieces and stop as soon as the limit is passed, whatever the headers claimed.
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (file.body) {
      for await (const chunk of file.body) {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES)
          throw new DocumentSourceError(
            "The file is too large to copy (over 25 MB).",
            true,
          );
        chunks.push(chunk);
      }
    }
    if (size === 0)
      throw new DocumentSourceError("The website returned an empty file.");
    const type = file.headers.get("content-type")?.split(";")[0]?.trim();
    return { body: Buffer.concat(chunks), contentType: type || null };
  }
}
