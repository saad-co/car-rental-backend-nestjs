import {
  QuoApiError,
  type ListConversationOptions,
  type QuoClient,
  type QuoMedia,
  type QuoMessage,
  type QuoMessagePage,
  type QuoMessageStatus,
} from "./quo-client.js";
import { field, str } from "./quo-json.js";

const QUO_BASE_URL = "https://api.quo.com";
export const QUO_STATUSES: readonly string[] = [
  "queued",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "received",
] satisfies QuoMessageStatus[];

export interface QuoHttpClientOptions {
  /** From Quo settings > API. Read from `QUO_API_KEY`; never hard-coded. */
  apiKey: string;
  /** The Quo number texts go out from and are read for: `PN...`, from `QUO_PHONE_NUMBER_ID`. */
  phoneNumberId: string;
  /** Give up on one request after this long (default 15 s). */
  timeoutMs?: number;
  /** For tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * `QuoClient` on top of Quo's REST API, version 1. Sending exists only in v1 (the newer dated version cannot
 * send yet), so reading uses v1 too: one version, one set of field names.
 *
 * Quo wants the API key alone in the `Authorization` header, with no `Bearer` prefix. Every answer is
 * checked field by field before use; anything unexpected is an error, never a guess.
 */
export class QuoHttpClient implements QuoClient {
  constructor(private readonly options: QuoHttpClientOptions) {
    if (!options.apiKey)
      throw new Error("Quo API key is missing (QUO_API_KEY).");
    if (!options.phoneNumberId)
      throw new Error("Quo phone number id is missing (QUO_PHONE_NUMBER_ID).");
  }

  async sendText(to: string, text: string): Promise<QuoMessage> {
    const body = await this.request("POST", "/v1/messages", {
      body: {
        content: text,
        from: this.options.phoneNumberId,
        to: [to],
      },
    });
    return parseMessage(field(body, "data"));
  }

  async listConversation(
    contactPhone: string,
    options: ListConversationOptions = {},
  ): Promise<QuoMessagePage> {
    const query = new URLSearchParams({
      phoneNumberId: this.options.phoneNumberId,
      maxResults: "100",
    });
    // Quo wants the key repeated, not "participants[]". URLSearchParams encodes the "+" of E.164.
    query.append("participants", contactPhone);
    if (options.createdAfter)
      query.set("createdAfter", options.createdAfter.toISOString());
    if (options.pageToken) query.set("pageToken", options.pageToken);

    const body = await this.request("GET", `/v1/messages?${query}`);
    const data = field(body, "data");
    if (!Array.isArray(data))
      throw new Error("Quo's message list has no 'data' array.");
    const next = field(body, "nextPageToken", true);
    return {
      messages: data.map(parseMessage),
      nextPageToken: typeof next === "string" && next !== "" ? next : null,
    };
  }

  private request(
    method: "GET" | "POST",
    path: string,
    init: { body?: unknown } = {},
  ): Promise<unknown> {
    return quoRequest({ ...this.options, method, path, body: init.body });
  }
}

/** One phone number of the Quo workspace, as listed by `listQuoPhoneNumbers`. */
export interface QuoPhoneNumber {
  id: string;
  name: string;
  /** E.164, e.g. `+13125550100`. */
  number: string;
  /** Whether Quo marks texting in the US as restricted for this number. */
  usMessagingRestricted: boolean;
}

/** Lists the workspace's numbers, to find the `PN...` id for `QUO_PHONE_NUMBER_ID` (`npm run quo:numbers`). */
export async function listQuoPhoneNumbers(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<QuoPhoneNumber[]> {
  const body = await quoRequest({
    ...options,
    method: "GET",
    path: "/v1/phone-numbers",
  });
  const data = field(body, "data");
  if (!Array.isArray(data))
    throw new Error("Quo's phone number list has no 'data' array.");
  return data.map((raw: unknown) => ({
    id: str(raw, "id"),
    name: str(raw, "name"),
    number: str(raw, "number"),
    usMessagingRestricted:
      field(field(field(raw, "restrictions"), "messaging"), "US") ===
      "restricted",
  }));
}

/** One authenticated call. Throws `QuoApiError` for any non-2xx answer, with Quo's own message. */
async function quoRequest(args: {
  apiKey: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const doFetch = args.fetchImpl ?? fetch;
  const response = await doFetch(`${QUO_BASE_URL}${args.path}`, {
    method: args.method,
    headers: {
      Authorization: args.apiKey,
      ...(args.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
    signal: AbortSignal.timeout(args.timeoutMs ?? 15_000),
  }).catch((error: unknown) => {
    throw new Error(
      `Could not reach Quo (${args.method} ${args.path.split("?")[0]}): ${
        error instanceof Error ? error.message : String(error)
      }`,
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
    const reason =
      json !== null && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : text.slice(0, 200) || response.statusText;
    throw new QuoApiError(
      response.status,
      `Quo refused ${args.method} ${args.path.split("?")[0]} (${response.status}): ${reason}`,
    );
  }
  if (json === undefined)
    throw new Error(
      `Quo answered ${args.method} ${args.path.split("?")[0]} with ${response.status} but no JSON.`,
    );
  return json;
}

/** Reads one Quo message object, checking every field we rely on. */
function parseMessage(raw: unknown): QuoMessage {
  const direction = str(raw, "direction");
  if (direction !== "incoming" && direction !== "outgoing")
    throw new Error(`Quo message has an unknown direction: ${direction}`);
  const status = str(raw, "status");
  if (!QUO_STATUSES.includes(status))
    throw new Error(`Quo message has an unknown status: ${status}`);
  const to = field(raw, "to");
  if (!Array.isArray(to) || !to.every((n) => typeof n === "string"))
    throw new Error("Quo message 'to' is not a list of numbers.");
  const createdAt = new Date(str(raw, "createdAt"));
  if (Number.isNaN(createdAt.getTime()))
    throw new Error("Quo message has an invalid createdAt.");
  const media = field(raw, "media", true);
  return {
    id: str(raw, "id"),
    direction,
    from: str(raw, "from"),
    to: to as string[],
    // A text with only a photo has no words: Quo may send null or leave it out.
    text: typeof field(raw, "text", true) === "string" ? str(raw, "text") : "",
    status: status as QuoMessageStatus,
    createdAt,
    media: Array.isArray(media) ? media.map(parseMedia) : [],
    errorCode: null,
  };
}

export function parseMedia(raw: unknown): QuoMedia {
  const type = field(raw, "type", true);
  return { url: str(raw, "url"), type: typeof type === "string" ? type : null };
}
