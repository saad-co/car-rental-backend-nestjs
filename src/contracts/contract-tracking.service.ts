import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { DriversService } from "../drivers/drivers.service.js";
import {
  FIRMA_CLIENT,
  FirmaError,
  type FirmaClient,
  type FirmaLookupOptions,
} from "../firma/firma-client.js";
import {
  FILE_LINK_SECONDS,
  type FileStorage,
} from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { isEndState, nextContractStatus } from "./contract-status.js";
import { Contract, ContractStatus } from "./contract.entity.js";
import { ContractDocumentsDto } from "./dto/contract.dto.js";

/** What one try at saving a contract's signed files came to. */
export type DocumentsOutcome = "saved" | "not-ready" | "failed" | "skipped";

/**
 * Follows a sent contract through firma and files the signed copy (Module 2 step 4, D75).
 *
 * **One function decides the status: `refreshFromFirma`.** It asks firma, the authority, for the signing request and applies
 * what it says. A webhook is only a trigger for it (its body is never believed) and a scheduled job runs it for every open
 * contract, so a duplicate, late, replayed or lost webhook is harmless and there is no event table to keep.
 *
 * Saving the files is separate (`saveDocuments`) because firma needs about 20 seconds after the signing to make them, and a
 * download can fail; it is retried by the job and a failure is recorded on the contract for the admin to see.
 */
@Injectable()
export class ContractTrackingService {
  private readonly logger = new Logger(ContractTrackingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    /** Null when `FIRMA_API_KEY` is not set: nothing can be tracked. */
    @Inject(FIRMA_CLIENT) private readonly firma: FirmaClient | null,
    /** Null when there is no bucket: nothing can be saved. */
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
    private readonly drivers: DriversService,
  ) {}

  /** The contract that belongs to a firma signing request, or null (the webhook may name a request that is not ours). */
  async findByFirmaId(firmaSigningRequestId: string): Promise<Contract | null> {
    return this.dataSource
      .getRepository(Contract)
      .findOneBy({ firmaSigningRequestId });
  }

  /**
   * Asks firma where the contract's signing request is and applies the answer. Nothing changes (and nothing is written)
   * when the contract is already at an end state or firma has nothing new. When the answer is "signed", the driver's
   * "Contract signed" step is ticked in the same transaction.
   *
   * firma is asked *before* the transaction, so the row lock is held only for the write. Two callers at the same moment
   * (webhook and job) both ask; the second waits at the lock, finds the contract already moved and writes nothing.
   *
   * @returns the contract's status after this call.
   * @throws NotFoundException no contract with this id, or it was never sent.
   * @throws FirmaError firma cannot be asked (no key, refused, no answer). Logged with the contract id, never swallowed.
   */
  async refreshFromFirma(
    contractId: string,
    options?: FirmaLookupOptions,
  ): Promise<ContractStatus> {
    const contract = await this.dataSource
      .getRepository(Contract)
      .findOneBy({ id: contractId });
    if (!contract?.firmaSigningRequestId) {
      throw new NotFoundException("Contract not found, or it was not sent.");
    }
    // An end state never changes, so there is nothing to ask.
    if (isEndState(contract.status)) return contract.status;
    if (!this.firma) {
      throw new FirmaError("Tracking is not set up (FIRMA_API_KEY).");
    }

    const firmaId = contract.firmaSigningRequestId;
    let state;
    try {
      state = await this.firma.getSigningRequest(firmaId, options);
    } catch (error) {
      this.logger.error(
        `Could not read firma request ${firmaId} for contract ${contractId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Contract, {
        where: { id: contractId },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked) throw new NotFoundException("Contract not found.");
      const next = nextContractStatus(locked.status, state);
      if (next === locked.status) return locked.status;

      // The time of the event as firma reports it; the driver "opened" it at `viewedAt`, every end state at `endedAt`.
      const at =
        (next === ContractStatus.viewed ? state.viewedAt : state.endedAt) ??
        new Date();
      const changes: Partial<Contract> = { status: next, statusUpdatedAt: at };
      if (next === ContractStatus.signed) changes.signedAt = at;
      await manager.update(Contract, contractId, changes);
      if (next === ContractStatus.signed) {
        await this.drivers.recordContractSigned(manager, locked.driverId, at);
      }
      this.logger.log(
        `Contract ${contractId} (firma ${firmaId}): ${locked.status} -> ${next}.`,
      );
      return next;
    });
  }

  /**
   * Copies the signed PDF and the certificate from firma into our bucket (`contracts/<id>/signed.pdf` and
   * `certificate.pdf`), so no record depends on firma (D70). Does nothing for a contract that is not signed, whose files
   * are already saved, or when there is no bucket.
   *
   * "Not ready" is not an error: firma gives no links until it has made the files (about 20 seconds after the signing).
   * A real failure (download broke, firma refused, not a PDF) is saved in `documents_error`, which the contract page
   * shows, and logged; the next run tries again. This never throws, so one bad contract cannot stop the others.
   */
  async saveDocuments(contractId: string): Promise<DocumentsOutcome> {
    const storage = this.storage;
    if (!storage || !this.firma) return "skipped";
    const contract = await this.dataSource
      .getRepository(Contract)
      .findOneBy({ id: contractId });
    if (
      !contract?.firmaSigningRequestId ||
      contract.status !== ContractStatus.signed ||
      contract.signedPdfKey !== null
    ) {
      return "skipped";
    }

    try {
      const state = await this.firma.getSigningRequest(
        contract.firmaSigningRequestId,
      );
      if (!state.signedPdfUrl || !state.certificateUrl) return "not-ready";
      const signed = await this.firma.download(state.signedPdfUrl);
      const certificate = await this.firma.download(state.certificateUrl);
      for (const [name, file] of [
        ["signed PDF", signed],
        ["certificate", certificate],
      ] as const) {
        if (file.body.subarray(0, 5).toString("latin1") !== "%PDF-") {
          throw new FirmaError(`firma's ${name} is not a PDF file.`);
        }
      }
      const signedKey = `contracts/${contractId}/signed.pdf`;
      const certificateKey = `contracts/${contractId}/certificate.pdf`;
      await storage.put(signedKey, signed.body, "application/pdf");
      await storage.put(certificateKey, certificate.body, "application/pdf");
      await this.dataSource.getRepository(Contract).update(contractId, {
        signedPdfKey: signedKey,
        certificateKey,
        documentsError: null,
      });
      this.logger.log(`Contract ${contractId}: signed files saved.`);
      return "saved";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Contract ${contractId}: saving the signed files failed: ${reason}`,
      );
      await this.dataSource
        .getRepository(Contract)
        .update(contractId, { documentsError: reason });
      return "failed";
    }
  }

  /**
   * Short-lived links to a signed contract's files, minted for this request and never stored. Both are null until the
   * files are saved (or when there is no bucket).
   * @throws NotFoundException no contract with this id.
   */
  async getDocuments(contractId: string): Promise<ContractDocumentsDto> {
    const contract = await this.dataSource
      .getRepository(Contract)
      .findOneBy({ id: contractId });
    if (!contract) throw new NotFoundException("Contract not found.");
    const storage = this.storage;
    if (!storage || !contract.signedPdfKey || !contract.certificateKey) {
      return { signedPdfUrl: null, certificateUrl: null };
    }
    return {
      signedPdfUrl: await storage.presignGet(
        contract.signedPdfKey,
        FILE_LINK_SECONDS,
      ),
      certificateUrl: await storage.presignGet(
        contract.certificateKey,
        FILE_LINK_SECONDS,
      ),
    };
  }
}
