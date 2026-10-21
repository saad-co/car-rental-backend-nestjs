import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Driver } from "../drivers/driver.entity.js";
import { ContractCompany } from "./contract-company.entity.js";
import { contractNumbers, type ContractMathInput } from "./contract-math.js";
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
 */
@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private readonly contracts: Repository<Contract>,
    @InjectRepository(Driver)
    private readonly drivers: Repository<Driver>,
    @InjectRepository(ContractCompany)
    private readonly companies: Repository<ContractCompany>,
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
   * The driver's draft, or null when there is none.
   * @throws NotFoundException no driver with this id.
   */
  async getDraft(driverId: string): Promise<ContractDto | null> {
    await this.assertDriverExists(driverId);
    const draft = await this.contracts.findOneBy({
      driverId,
      status: ContractStatus.draft,
    });
    return draft ? this.toDto(draft) : null;
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
