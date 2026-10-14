/** Delivery state of a text as Quo reports it. `failed` is only seen in webhooks and retries. */
export type QuoMessageStatus =
  "queued" | "sent" | "delivered" | "undelivered" | "failed" | "received";

/** A file attached to a text (MMS). `type` is the MIME type when Quo knows it. */
export interface QuoMedia {
  url: string;
  type: string | null;
}

/** One text as Quo returns it. Only the fields we use. */
export interface QuoMessage {
  /** Quo's id, `AC...`. Unique; the key that stops the same text being stored twice. */
  id: string;
  direction: "incoming" | "outgoing";
  from: string;
  to: string[];
  text: string;
  status: QuoMessageStatus;
  /** When Quo created it. */
  createdAt: Date;
  media: QuoMedia[];
  /** Quo's reason when the text failed or was not delivered (webhooks only). Null otherwise. */
  errorCode: string | null;
}

/** One page of a conversation's history, newest text first. */
export interface QuoMessagePage {
  messages: QuoMessage[];
  /** Pass back as `pageToken` to get the next (older) page; null when there are no more. */
  nextPageToken: string | null;
}

export interface ListConversationOptions {
  /** Only texts created after this moment (used to fetch just what is new). */
  createdAfter?: Date;
  pageToken?: string;
}

/**
 * The only things the chat needs from Quo: send one text, and read the history with one contact.
 * The real adapter is `QuoHttpClient`; tests use a fake (same pattern as `LlmJsonClient`, D50).
 *
 * Implementations throw on any failure and never return a guess. An error answer from Quo is a
 * `QuoApiError`, so callers can show Quo's own reason.
 */
export interface QuoClient {
  /** Sends a plain text (no files: Quo's API cannot send MMS) from our Quo number to `to` (E.164). */
  sendText(to: string, text: string): Promise<QuoMessage>;

  /** History of the conversation between our Quo number and `contactPhone` (E.164), newest first. */
  listConversation(
    contactPhone: string,
    options?: ListConversationOptions,
  ): Promise<QuoMessagePage>;
}

/**
 * Quo answered with an error status. `status` is the HTTP status (400 = our number's A2P registration is not
 * approved, 402 = subscription or credits ran out, 403 = daily cap reached, 401 = wrong API key), and the
 * message carries Quo's own explanation.
 */
export class QuoApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Quo's own words for what went wrong (the `message` of its error answer). For logs, not for admins. */
    readonly reason: string = message,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QuoApiError";
  }
}
