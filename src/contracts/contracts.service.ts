import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Driver } from "../drivers/driver.entity.js";
import {
  FIRMA_CLIENT,
  FirmaError,
  type FirmaClient,
} from "../firma/firma-client.js";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  ApplicationDocumentStatus,
} from "../applications/documents/application-document.entity.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { ContractCompany } from "./contract-company.entity.js";
import { contractNumbers, type ContractMathInput } from "./contract-math.js";
import { LicenceError, placeLicence } from "./contract-licence.js";
import {
  buildAnchors,
  loadTemplate,
  templateFor,
  type ContractTemplate,
} from "./contract-template.js";
import { buildContractValues, missingForSend } from "./contract-values.js";
import {
  Contract,
  type ContractSchedule,
  ContractStatus,
} from "./contract.entity.js";
import {
  ContractCompanyDto,
  ContractDto,
  ContractInputDto,
  ContractNumbersDto,
  ContractNumbersInputDto,
} from "./dto/contract.dto.js";

/** The numbers a contract is calculated from (the inputs of the maths, plus the schedule). */
type NumberColumns = ContractMathInput & { schedule: ContractSchedule };

/** The step 2 details of a contract: each is empty (`null`) until typed. */
interface DetailColumns {
  companyId: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehiclePlate: string | null;
  vehiclePlateState: string | null;
  purchaseOptionCents: number | null;
  lesseeAddress: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  dateOfBirth: string | null;
}

/** Everything the admin types for a contract as a plain object. */
type InputColumns = NumberColumns & DetailColumns;

/**
 * Contract drafts (Module 2 step 1, D71): the admin types the inputs, the numbers are calculated by `contract-math.ts`
 * and never stored. A driver has at most one draft (a database index); a draft is not a record yet, so it may be deleted.
 * Sending (step 3, D74) freezes the contract: it can no longer be changed or deleted.
 */
@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contracts: Repository<Contract>,
    @InjectRepository(Driver)
    private readonly drivers: Repository<Driver>,
    @InjectRepository(ContractCompany)
    private readonly companies: Repository<ContractCompany>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    /** Null when `FIRMA_API_KEY` is not set: sending then answers 503. */
    @Inject(FIRMA_CLIENT)
    private readonly firma: FirmaClient | null,
    /** Our private bucket; null when `S3_*` is not set: sending then answers 503 (the licence is read from it). */
    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage | null,
  ) {}

  /** The calculated numbers for some inputs, without saving anything (the page calls this while the admin types). */
  calculate(input: ContractNumbersInputDto): ContractNumbersDto {
    return contractNumbers(input);
  }

  /** The fixed list of companies a contract's Lessor is chosen from (five rows: no pagination), by name then address. */
  async listCompanies(): Promise<ContractCompanyDto[]> {
    const rows = await this.companies.find({
      order: { name: "ASC", address: "ASC" },
    });
    return rows.map(({ id, name, address }) => ({ id, name, address }));
  }

  /**
   * The driver's current contract: the open draft, or else the one sent most recently; null when there is none.
   * @throws NotFoundException no driver with this id.
   */
  async getCurrent(driverId: string): Promise<ContractDto | null> {
    await this.assertDriverExists(driverId);
    const draft = await this.contracts.findOneBy({
      driverId,
      status: ContractStatus.draft,
    });
    if (draft) return this.toDto(draft);
    const [latest] = await this.contracts.find({
      where: { driverId },
      order: { createdAt: "DESC" },
      take: 1,
    });
    return latest ? this.toDto(latest) : null;
  }

  /**
   * Starts the driver's draft.
   * @throws NotFoundException no driver with this id.
   * @throws BadRequestException the company is not in the list.
   * @throws ConflictException the driver already has a draft (also when two requests arrive at the same instant: the
   *   database index decides).
   */
  async createDraft(
    driverId: string,
    input: ContractInputDto,
    adminId: string,
  ): Promise<ContractDto> {
    await this.assertDriverExists(driverId);
    await this.assertCompanyExists(input.companyId);
    try {
      const saved = await this.contracts.save(
        this.contracts.create({
          ...this.inputColumns(input),
          driverId,
          status: ContractStatus.draft,
          createdById: adminId,
          updatedById: adminId,
        }),
      );
      return this.toDto(saved);
    } catch (error) {
      if (isUniqueViolation(error, "contracts_one_draft_per_driver")) {
        throw new ConflictException(
          "This driver already has a contract draft. Open it instead.",
        );
      }
      throw error;
    }
  }

  /**
   * Replaces every input of a draft.
   * @throws NotFoundException no contract with this id, or it is not a draft.
   * @throws BadRequestException the company is not in the list.
   */
  async updateDraft(
    id: string,
    input: ContractInputDto,
    adminId: string,
  ): Promise<ContractDto> {
    const draft = await this.findDraft(id);
    await this.assertCompanyExists(input.companyId);
    Object.assign(draft, this.inputColumns(input), { updatedById: adminId });
    return this.toDto(await this.contracts.save(draft));
  }

  /**
   * Deletes a draft (a draft is not a record yet).
   * @throws NotFoundException no contract with this id, or it is not a draft.
   */
  async deleteDraft(id: string): Promise<void> {
    const result = await this.contracts.delete({
      id,
      status: ContractStatus.draft,
    });
    if (!result.affected) throw new NotFoundException("Draft not found.");
  }

  /**
   * Sends a draft to the driver for signing through firma (step 3, D74) and freezes it. The whole thing runs in one
   * transaction that holds a lock on the contract's row, so two clicks at once make one envelope: the second waits, then
   * finds the contract already sent. If firma refuses, nothing is saved and the contract stays a draft.
   * @throws ServiceUnavailableException no firma key is set.
   * @throws NotFoundException no contract with this id.
   * @throws ConflictException it is not a draft any more, or its company's state has no contract yet.
   * @throws BadRequestException values are still empty (`missing` lists them).
   * @throws BadGatewayException firma refused or did not answer (its own message is passed on).
   */
  async sendForSigning(id: string, adminId: string): Promise<ContractDto> {
    const firma = this.firma;
    if (!firma) {
      throw new ServiceUnavailableException(
        "Signing is not set up (FIRMA_API_KEY).",
      );
    }
    const sent = await this.dataSource.transaction(async (manager) => {
      const contract = await manager.findOne(Contract, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!contract) throw new NotFoundException("Contract not found.");
      if (contract.status !== ContractStatus.draft) {
        throw new ConflictException(
          "This contract has already been sent for signing.",
        );
      }
      const company = contract.companyId
        ? await manager.findOneBy(ContractCompany, { id: contract.companyId })
        : null;
      const template = company ? templateFor(company.state) : undefined;
      if (company && !template) {
        throw new ConflictException(
          `There is no contract for ${company.state} yet.`,
        );
      }
      const driver = await manager.findOneByOrFail(Driver, {
        id: contract.driverId,
      });
      const missing = missingForSend(contract, company, driver);
      if (missing.length > 0 || !company || !template) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Fill in before sending: ${missing.join(", ")}.`,
          missing,
        });
      }

      const values = buildContractValues(contract, company, driver);
      const licence = await this.drawLicence(manager, driver.id, template);
      let firmaId: string;
      try {
        ({ signingRequestId: firmaId } = await firma.createAndSend({
          name: `Vehicle Lease Agreement - ${company.name}`,
          pdf: licence.pdf,
          recipient: {
            firstName: driver.firstName,
            lastName: driver.lastName,
            email: driver.email,
          },
          anchors: buildAnchors(values, template),
        }));
      } catch (error) {
        if (error instanceof FirmaError) {
          // The message carries firma's own reason and never the key or the values (it is safe to log and to show).
          this.logger.error(
            `firma did not send contract ${id}: ${error.message}`,
          );
          throw new BadGatewayException(error.message);
        }
        throw error;
      }

      try {
        await manager.update(Contract, id, {
          status: ContractStatus.sent,
          sentAt: new Date(),
          sentById: adminId,
          firmaSigningRequestId: firmaId,
          sentValues: {
            template: template.file,
            recipientName: `${driver.firstName} ${driver.lastName}`,
            recipientEmail: driver.email,
            values: { ...values },
            licenseDocumentId: licence.documentId,
          },
        });
      } catch (error) {
        // firma already has the envelope: say which one, so it can be cancelled by hand. Never swallowed.
        this.logger.error(
          `firma request ${firmaId} was created for contract ${id}, but saving the contract failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
      return manager.findOneByOrFail(Contract, { id });
    });
    this.logger.log(
      `Contract ${id} sent for signing (firma ${sent.firmaSigningRequestId}) by admin ${adminId}.`,
    );
    return this.toDto(sent);
  }

  /**
   * The template PDF with the driver's licence drawn on its last page (D76): the licence file is the one on the driver's
   * application (the first step of a driver's life, D26). Nothing here is ever logged or put in a message but the driver's id.
   * @throws ServiceUnavailableException no file storage is set up.
   * @throws ConflictException the application has no stored licence file, or it cannot be read as a picture or PDF.
   * @throws BadGatewayException the bucket could not give the file.
   */
  private async drawLicence(
    manager: EntityManager,
    driverId: string,
    template: ContractTemplate,
  ): Promise<{ pdf: Buffer; documentId: string }> {
    const storage = this.storage;
    if (!storage) {
      throw new ServiceUnavailableException(
        "File storage is not set up (S3_*): the driver's licence is read from it.",
      );
    }
    const document = await manager.findOne(ApplicationDocument, {
      where: {
        kind: ApplicationDocumentKind.license,
        status: ApplicationDocumentStatus.stored,
        application: { driverId },
      },
    });
    if (!document?.storageKey) {
      throw new ConflictException(
        "The driver's licence is not on file: add it to the application first.",
      );
    }
    let body: Buffer;
    try {
      body = await storage.get(document.storageKey);
    } catch (error) {
      this.logger.error(
        `could not read the licence file of driver ${driverId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException(
        "The driver's licence file could not be read from storage.",
      );
    }
    try {
      return {
        pdf: await placeLicence(
          loadTemplate(template.file),
          { body },
          template.licenceSlot,
        ),
        documentId: document.id,
      };
    } catch (error) {
      if (error instanceof LicenceError)
        throw new ConflictException(error.message);
      throw error;
    }
  }

  private async findDraft(id: string): Promise<Contract> {
    const draft = await this.contracts.findOneBy({
      id,
      status: ContractStatus.draft,
    });
    if (!draft) throw new NotFoundException("Draft not found.");
    return draft;
  }

  private async assertDriverExists(driverId: string): Promise<void> {
    const exists = await this.drivers.existsBy({ id: driverId });
    if (!exists) throw new NotFoundException("Driver not found.");
  }

  /** A company id, when there is one, must be a row of the list. */
  private async assertCompanyExists(companyId?: string | null): Promise<void> {
    if (!companyId) return;
    if (!(await this.companies.existsBy({ id: companyId }))) {
      throw new BadRequestException("Choose a company from the list.");
    }
  }

  /**
   * The typed fields of a request or a saved row, picked one by one so nothing else (an id, a status) can ride along. A
   * detail that is missing is empty (`null`), so a PUT without it clears it.
   */
  private inputColumns(
    input: NumberColumns & Partial<DetailColumns>,
  ): InputColumns {
    return {
      schedule: input.schedule,
      totalRateCents: input.totalRateCents,
      startDate: input.startDate,
      termMonths: input.termMonths,
      securityDepositCents: input.securityDepositCents,
      documentationFeeCents: input.documentationFeeCents,
      insuranceStartFeeCents: input.insuranceStartFeeCents,
      otherOneTimeCents: input.otherOneTimeCents,
      holdVehicleCents: input.holdVehicleCents,
      excessMileageCents: input.excessMileageCents,
      insuranceExcessCents: input.insuranceExcessCents,
      otherRecurringCents: input.otherRecurringCents,
      companyId: input.companyId ?? null,
      vehicleModel: input.vehicleModel ?? null,
      vehicleVin: input.vehicleVin ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      vehiclePlateState: input.vehiclePlateState ?? null,
      purchaseOptionCents: input.purchaseOptionCents ?? null,
      lesseeAddress: input.lesseeAddress ?? null,
      licenseNumber: input.licenseNumber ?? null,
      licenseState: input.licenseState ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
    };
  }

  private toDto(row: Contract): ContractDto {
    const inputs = this.inputColumns(row);
    return {
      ...inputs,
      id: row.id,
      driverId: row.driverId,
      status: row.status,
      numbers: contractNumbers(inputs),
      sentAt: row.sentAt,
      sentValues: row.sentValues,
      statusUpdatedAt: row.statusUpdatedAt,
      signedAt: row.signedAt,
      documentsSaved: row.signedPdfKey !== null && row.certificateKey !== null,
      documentsError: row.documentsError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
