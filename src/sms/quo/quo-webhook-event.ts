import type { QuoMessage, QuoMessageStatus } from "./quo-client.js";
import { QUO_STATUSES, parseMedia } from "./quo-http-client.js";
import { field, optionalStr, str } from "./quo-json.js";

/** The message events we listen for. Everything else Quo might send is ignored. */
export const QUO_MESSAGE_EVENTS = [
  "message.received",
  "message.delivered",
  "message.failed",
  "message.undelivered",
] as const;

/** One message event, read and checked. */
export interface QuoMessageEvent {
  type: (typeof QUO_MESSAGE_EVENTS)[number];
  /** The Quo number (`PN...`) the text was on; null when Quo does not say. */
  phoneNumberId: string | null;
  /** The text itself, in the same shape the history API gives. */
  message: QuoMessage;
  /** The other party (sender of an incoming text, recipient of an outgoing one). Null for group texts. */
  contactPhone: string | null;
}

/**
 * Reads a webhook delivery (envelope `{id, type, data: {resource, context}}`, API version 2026-03-30).
 * Returns null for event types we do not use. Throws for a message event that is not shaped as expected, so
 * the controller answers with an error and Quo retries instead of the text being lost silently.
 */
export function parseQuoMessageEvent(body: unknown): QuoMessageEvent | null {
  const type = str(body, "type");
  if (!(QUO_MESSAGE_EVENTS as readonly string[]).includes(type)) return null;

  const data = field(body, "data");
  const resource = field(data, "resource");
  const context = field(data, "context");

  const direction = str(resource, "direction");
  if (direction !== "incoming" && direction !== "outgoing")
    throw new Error(`Quo event has an unknown direction: ${direction}`);
  const status = str(resource, "status");
  if (!QUO_STATUSES.includes(status))
    throw new Error(`Quo event has an unknown status: ${status}`);
  const createdAt = new Date(str(resource, "createdAt"));
  if (Number.isNaN(createdAt.getTime()))
    throw new Error("Quo event has an invalid createdAt.");

  const sender = str(context, "senderIdentifier");
  const recipients = field(context, "recipientIdentifiers");
  if (
    !Array.isArray(recipients) ||
    !recipients.every((r) => typeof r === "string")
  )
    throw new Error("Quo event 'recipientIdentifiers' is not a list.");
  const media = field(resource, "media", true);

  return {
    type: type as QuoMessageEvent["type"],
    phoneNumberId: optionalStr(context, "phoneNumberId"),
    contactPhone:
      direction === "incoming"
        ? recipients.length === 1
          ? sender
          : null
        : recipients.length === 1
          ? (recipients[0] as string)
          : null,
    message: {
      id: str(resource, "id"),
      direction,
      from: sender,
      to: recipients as string[],
      text: optionalStr(resource, "text") ?? "",
      status: status as QuoMessageStatus,
      createdAt,
      media: Array.isArray(media) ? media.map(parseMedia) : [],
      errorCode: optionalStr(resource, "errorCode"),
    },
  };
}
