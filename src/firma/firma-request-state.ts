import {
  FirmaError,
  type FirmaRequestState,
  type FirmaRequestStatus,
} from "./firma-client.js";

/**
 * What `GET /signing-requests/:id` returns that we use (checked against the real API, D75). `status` is a set of flags, not
 * a word, and `sent` stays true whatever happens next. Everything is optional here: a missing field is read as "no".
 */
interface FirmaRequestJson {
  id?: unknown;
  status?: Record<string, unknown> | null;
  timestamps?: Record<string, unknown> | null;
  certificate?: { generated?: unknown } | null;
  expires_at?: unknown;
  final_document_download_url?: unknown;
  certificate_only_download_url?: unknown;
}

/**
 * Turns firma's flags into one status. Priority: finished, declined, cancelled, expired, else sent. A request cannot be
 * finished and cancelled together in practice; the order only decides the odd case, and a signed contract wins.
 */
export function resolveFirmaStatus(
  flags: Record<string, unknown> | null | undefined,
): FirmaRequestStatus {
  if (flags?.finished === true) return "finished";
  if (flags?.declined === true) return "declined";
  if (flags?.cancelled === true) return "cancelled";
  if (flags?.expired === true) return "expired";
  return "sent";
}

/**
 * Builds the state we use from firma's answer. `viewedAt` comes from the audit trail (the request itself has no such
 * field), so the caller passes it in.
 *
 * The file links are given only for a finished request whose certificate firma has finished making: before that the links
 * are null and, as an extra guard, a link is ignored while `certificate.generated` is not true.
 *
 * @throws FirmaError the answer has no id or the end state has no time we can read.
 */
export function toFirmaRequestState(
  json: unknown,
  viewedAt: Date | null,
): FirmaRequestState {
  const body = (
    json !== null && typeof json === "object" ? json : {}
  ) as FirmaRequestJson;
  if (typeof body.id !== "string" || body.id === "") {
    throw new FirmaError("firma's answer has no signing request id.");
  }
  const status = resolveFirmaStatus(body.status);
  const timestamps = body.timestamps ?? {};
  // The end state's own time (an expired request has no `expired_on`: `expires_at` is it, D75); if firma leaves it out
  // (never seen), the request's last change is the nearest honest time.
  const ownTime =
    status === "finished"
      ? readDate(timestamps.finished_on)
      : status === "declined"
        ? readDate(timestamps.declined_on)
        : status === "cancelled"
          ? readDate(timestamps.cancelled_on)
          : status === "expired"
            ? readDate(body.expires_at)
            : null;
  const endedAt =
    status === "sent"
      ? null
      : (ownTime ?? readDate(timestamps.last_changed_on));
  if (status !== "sent" && endedAt === null) {
    throw new FirmaError(
      `firma says the request is ${status} but gives no time for it.`,
    );
  }
  const filesReady =
    status === "finished" && body.certificate?.generated === true;
  return {
    id: body.id,
    status,
    viewedAt,
    endedAt,
    signedPdfUrl: filesReady ? readUrl(body.final_document_download_url) : null,
    certificateUrl: filesReady
      ? readUrl(body.certificate_only_download_url)
      : null,
  };
}

/** The earliest time the signer opened the signing page, from firma's audit trail; null when they have not. */
export function firstViewedAt(auditJson: unknown): Date | null {
  const results =
    auditJson !== null && typeof auditJson === "object"
      ? (auditJson as { results?: unknown }).results
      : undefined;
  if (!Array.isArray(results)) return null;
  const times = results
    .filter(
      (entry): entry is { source: string; event: string; timestamp: unknown } =>
        entry !== null &&
        typeof entry === "object" &&
        (entry as { source?: unknown }).source === "signer" &&
        (entry as { event?: unknown }).event === "document_viewed",
    )
    .map((entry) => readDate(entry.timestamp))
    .filter((date): date is Date => date !== null);
  return times.length === 0
    ? null
    : new Date(Math.min(...times.map((date) => date.getTime())));
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readUrl(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
