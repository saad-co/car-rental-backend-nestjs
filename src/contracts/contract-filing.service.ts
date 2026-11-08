import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  ApplicationDocumentOrigin,
  ApplicationDocumentStatus,
} from "../applications/documents/application-document.entity.js";
import { driverDocumentStorageKey } from "../applications/documents/upload-file.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import {
  decideFiling,
  type FilingDecision,
  type SlotState,
} from "./contract-filing.js";
import { Contract, ContractStatus } from "./contract.entity.js";

/** What one try at filing a contract came to. `skipped`: nothing to file (not signed, no saved PDF, or no bucket). */
export type FilingOutcome = FilingDecision | "filed" | "skipped";

/** How many signed contracts one sweep files at most. */
const SWEEP_BATCH = 50;

/**
 * Files the signed PDF of a firma contract in the driver's contract slot (D90, step 2), so the driver page has one place
 * for "the current signed contract" whether it came from firma or from the client's PDF.
 *
 * **A copy, never the same file.** The slot gets its own object (`drivers/<driverId>/contract-<uuid>.pdf`);
 * `contracts/<id>/signed.pdf` stays where the contract page reads it, so replacing the slot can never break that page.
 * The rules are in `decideFiling`: an admin upload is never overwritten, a newer signing replaces an older firma copy.
 */
@Injectable()
export class ContractFilingService {
  private readonly logger = new Logger(ContractFilingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    /** Null when there is no bucket: nothing can be filed. */
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
  ) {}

  /**
   * Files one signed contract. Safe to repeat (a contract already filed is left alone) and safe against a second caller at
   * the same moment (the slot row is locked while it is decided).
   *
   * The new object is written first and the row switched to it afterwards; the replaced object is removed last (a failed
   * removal is logged, not thrown: the new file is already live). If the database part fails, the new object is removed again.
   *
   * @throws when the bucket or the database fails, so the caller can log it with the contract id and try again later.
   */
  async fileContract(contractId: string): Promise<FilingOutcome> {
    const storage = this.storage;
    if (!storage) return "skipped";
    const contract = await this.dataSource
      .getRepository(Contract)
      .findOneBy({ id: contractId });
    if (
      !contract ||
      contract.status !== ContractStatus.signed ||
      !contract.signedPdfKey ||
      !contract.signedAt
    ) {
      return "skipped";
    }
    const target = { id: contract.id, signedAt: contract.signedAt };

    // A cheap look first, so a contract that will not be filed never downloads its PDF.
    const first = decideFiling(
      await this.slotState(this.dataSource.manager, contract.driverId),
      target,
    );
    if (first !== "file") return this.keep(first, contract.id);

    const body = await storage.get(contract.signedPdfKey);
    const key = driverDocumentStorageKey(
      contract.driverId,
      ApplicationDocumentKind.contract,
      randomUUID(),
      "pdf",
    );
    await storage.put(key, body, "application/pdf");

    let result: { decision: FilingDecision; oldKey: string | null };
    try {
      result = await this.dataSource.transaction(async (manager) => {
        // Lock the slot's row (if there is one) so a second filing or an admin upload waits here and then sees this result.
        const existing = await manager.findOne(ApplicationDocument, {
          where: {
            driverId: contract.driverId,
            kind: ApplicationDocumentKind.contract,
          },
          lock: { mode: "pessimistic_write" },
        });
        const again = decideFiling(
          await this.slotState(manager, contract.driverId),
          target,
        );
        if (again !== "file") return { decision: again, oldKey: null };
        const values = {
          origin: ApplicationDocumentOrigin.firma,
          contractId: contract.id,
          sourcePath: null,
          status: ApplicationDocumentStatus.stored,
          storageKey: key,
          sizeBytes: body.length,
          contentType: "application/pdf",
          uploadedById: null,
          attempts: 0,
          lastError: null,
        };
        if (existing) {
          await manager.update(ApplicationDocument, existing.id, values);
          return { decision: "file", oldKey: existing.storageKey };
        }
        await manager.insert(ApplicationDocument, {
          driverId: contract.driverId,
          applicationId: null,
          kind: ApplicationDocumentKind.contract,
          ...values,
        });
        return { decision: "file", oldKey: null };
      });
    } catch (error) {
      await this.removeQuietly(key, "the new copy after a failed save");
      throw error;
    }

    if (result.decision !== "file") {
      // Someone filled the slot while the PDF was being copied: the copy is not needed.
      await this.removeQuietly(key, "the unused copy");
      return this.keep(result.decision, contract.id);
    }
    if (result.oldKey) {
      await this.removeQuietly(result.oldKey, "the replaced copy");
    }
    this.logger.log(
      `Contract ${contract.id}: signed PDF filed in the contract slot of driver ${contract.driverId}.`,
    );
    return "filed";
  }

  /**
   * One sweep: files every signed contract with a saved PDF that would actually be filed (the SQL leaves out contracts
   * whose driver slot holds an admin upload, this contract's copy or a newer one, so a settled contract is never
   * looked at again and cannot starve the others). A failure on one contract is logged with its id and does not stop the rest.
   */
  async fileSignedContracts(): Promise<{ filed: number; failed: number }> {
    if (!this.storage) return { filed: 0, failed: 0 };
    const waiting = (await this.dataSource.query(
      `SELECT c.id FROM contracts c
       WHERE c.status = 'signed' AND c.signed_pdf_key IS NOT NULL AND c.signed_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM application_documents d
           LEFT JOIN contracts k ON k.id = d.contract_id
           WHERE d.driver_id = c.driver_id AND d.kind = 'contract'
             AND (d.origin <> 'firma' OR d.contract_id = c.id OR k.signed_at >= c.signed_at))
       ORDER BY c.signed_at
       LIMIT $1`,
      [SWEEP_BATCH],
    )) as { id: string }[];

    const summary = { filed: 0, failed: 0 };
    for (const { id } of waiting) {
      try {
        if ((await this.fileContract(id)) === "filed") summary.filed++;
      } catch (error) {
        summary.failed++;
        this.logger.error(
          `Contract ${id}: filing the signed PDF in the driver's contract slot failed; the next run tries again: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return summary;
  }

  /** The driver's contract slot as `decideFiling` needs it, or null when it is empty. */
  private async slotState(
    manager: EntityManager,
    driverId: string,
  ): Promise<SlotState | null> {
    const slot = await manager.findOne(ApplicationDocument, {
      where: { driverId, kind: ApplicationDocumentKind.contract },
      relations: { contract: true },
    });
    if (!slot) return null;
    return {
      origin: slot.origin,
      contractId: slot.contractId,
      contractSignedAt: slot.contract?.signedAt ?? null,
    };
  }

  /** Reports a decision that left the slot alone. An admin's file being kept is expected, so it is only logged quietly. */
  private keep(decision: FilingDecision, contractId: string): FilingOutcome {
    if (decision === "kept-upload") {
      this.logger.debug(
        `Contract ${contractId}: not filed, the driver's contract slot holds a file an admin uploaded.`,
      );
    }
    return decision;
  }

  /** Removes one object; a failure is logged with its reason and never thrown (nothing depends on it any more). */
  private async removeQuietly(key: string, what: string): Promise<void> {
    try {
      await this.storage?.delete(key);
    } catch (error) {
      this.logger.error(
        `Could not remove ${what} (${key}); it is left in the bucket.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
