import {
  InspectionStatus,
  OPEN_INSPECTION_STATUSES,
  type Inspection,
} from "./inspection.entity.js";

/** The status staff and the driver's page see: the stored one, or `expired` when the link ran out of time. */
export type EffectiveInspectionStatus = InspectionStatus | "expired";

/** True while the driver can still use the link: not submitted, not revoked. */
export function isOpen(status: InspectionStatus): boolean {
  return (OPEN_INSPECTION_STATUSES as readonly InspectionStatus[]).includes(
    status,
  );
}

/**
 * The status as shown (D102: `expired` is worked out, never stored, so no job has to flip a column when the clock passes).
 * An open inspection whose link time has run out is `expired`. `created` never is: no link has been handed out yet, so there is
 * nothing to expire (its stored expiry is the moment it was made).
 */
export function effectiveStatus(
  inspection: Pick<Inspection, "status" | "tokenExpiresAt">,
  now: Date,
): EffectiveInspectionStatus {
  if (
    isOpen(inspection.status) &&
    inspection.status !== InspectionStatus.created &&
    inspection.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return inspection.status;
}

/** How long a submitted inspection may wait for a staff review before it is flagged for attention (spec p. 11). */
export const REVIEW_OVERDUE_HOURS = 24;

/**
 * True when staff should look at this inspection: it was flagged (new damage found), or it was submitted more than 24 hours ago
 * and nobody has reviewed it. Worked out on read, so no job has to flip anything when the clock passes.
 */
export function needsAttention(
  inspection: Pick<Inspection, "status" | "submittedAt">,
  now: Date,
): boolean {
  if (inspection.status === InspectionStatus.flagged) return true;
  return (
    inspection.status === InspectionStatus.submitted &&
    inspection.submittedAt !== null &&
    now.getTime() - inspection.submittedAt.getTime() >
      REVIEW_OVERDUE_HOURS * 3_600_000
  );
}

/** True if the link of this inspection opens the capture page right now (open, link handed out, not run out of time). */
export function linkWorks(
  inspection: Pick<Inspection, "status" | "tokenExpiresAt">,
  now: Date,
): boolean {
  const status = effectiveStatus(inspection, now);
  return (
    status !== "expired" &&
    status !== InspectionStatus.created &&
    isOpen(inspection.status)
  );
}
