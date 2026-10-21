import type { FirmaRequestState } from "../firma/firma-client.js";
import { ContractStatus } from "./contract.entity.js";

/** The four states a contract stays in for good. */
const END_STATES: ReadonlySet<ContractStatus> = new Set([
  ContractStatus.signed,
  ContractStatus.declined,
  ContractStatus.expired,
  ContractStatus.cancelled,
]);

export function isEndState(status: ContractStatus): boolean {
  return END_STATES.has(status);
}

/** The order a contract moves through: draft, sent, viewed, then any end state (all at the same, last level). */
function rank(status: ContractStatus): number {
  if (isEndState(status)) return 3;
  return { draft: 0, sent: 1, viewed: 2 }[
    status as "draft" | "sent" | "viewed"
  ];
}

/** What firma's answer means for us, before the rules below decide whether the contract may move there. */
function firmaTarget(firma: FirmaRequestState): ContractStatus {
  switch (firma.status) {
    case "finished":
      return ContractStatus.signed; // the driver is the only signer (D72)
    case "declined":
      return ContractStatus.declined;
    case "cancelled":
      return ContractStatus.cancelled;
    case "expired":
      return ContractStatus.expired;
    case "sent":
      return firma.viewedAt ? ContractStatus.viewed : ContractStatus.sent;
  }
}

/**
 * The status a contract has after firma reported (D75). Pure, so the rules can be tested without a database:
 * - a contract only moves forward (draft, sent, viewed, then an end state); an answer that points backwards (firma shows
 *   no viewing, but we saw one) changes nothing;
 * - an end state never changes: a signed contract cannot become expired, and a late or repeated event cannot undo it;
 * - `viewed` never replaces an end state, and a draft never moves (it has no firma request).
 */
export function nextContractStatus(
  current: ContractStatus,
  firma: FirmaRequestState,
): ContractStatus {
  if (current === ContractStatus.draft || isEndState(current)) return current;
  const target = firmaTarget(firma);
  return rank(target) > rank(current) ? target : current;
}
