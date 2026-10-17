/** A document fetched from the website's storage. */
export interface FetchedDocument {
  body: Buffer;
  /** MIME type when the source tells us, otherwise null. */
  contentType: string | null;
}

/**
 * Where the website's uploaded documents come from (D54): given the path stored on an application, returns the
 * file. Behind an interface so tests use a fake. The real one asks a small read-only function on the website's
 * Supabase project (`SupabaseDocumentSource`).
 *
 * Implementations throw `DocumentSourceError` for failures, with a plain-language message.
 */
export interface DocumentSource {
  fetch(path: string): Promise<FetchedDocument>;
}

/**
 * A failure to fetch a document. `permanent` means retrying cannot help (the file is gone, the path is wrong),
 * so the copier gives up on that document at once. `blocksAll` means nothing can be fetched until someone fixes
 * the connection (a refused token): the copier stops the run and does NOT count an attempt against any document.
 */
export class DocumentSourceError extends Error {
  constructor(
    message: string,
    readonly permanent = false,
    readonly blocksAll = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentSourceError";
  }
}
