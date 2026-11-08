import { ApplicationDocumentOrigin } from "../applications/documents/application-document.entity.js";

/** What is in a driver's contract slot right now, as far as the filing decision needs. */
export interface SlotState {
  origin: ApplicationDocumentOrigin;
  /** The firma contract the file is a copy of; null for an admin upload (or once the link was cleared). */
  contractId: string | null;
  /** When that contract was signed, if the slot's file is a firma copy and its contract is known. */
  contractSignedAt: Date | null;
}

export type FilingDecision = "file" | "already" | "kept-upload" | "kept-newer";

/**
 * Decides whether a signed firma contract goes into the driver's contract slot (D90, step 2). Pure.
 *
 * - Empty slot: file it.
 * - The slot already holds this contract's copy: nothing to do.
 * - The slot holds an admin upload: **never overwritten**. An admin chose that file (for example the client's paper copy).
 * - The slot holds a copy of another firma contract: the newer signing wins; a copy whose contract is unknown (the link
 *   was cleared) is replaced.
 */
export function decideFiling(
  slot: SlotState | null,
  contract: { id: string; signedAt: Date },
): FilingDecision {
  if (!slot) return "file";
  if (slot.contractId === contract.id) return "already";
  if (slot.origin !== ApplicationDocumentOrigin.firma) return "kept-upload";
  if (
    slot.contractSignedAt !== null &&
    slot.contractSignedAt.getTime() >= contract.signedAt.getTime()
  ) {
    return "kept-newer";
  }
  return "file";
}
