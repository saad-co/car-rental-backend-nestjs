import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { ApiBadRequestResponse } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { ContractTrackingService } from "./contract-tracking.service.js";
import { ContractsService } from "./contracts.service.js";
import {
  ContractCompanyDto,
  ContractCurrentDto,
  ContractDocumentsDto,
  ContractDto,
  ContractInputDto,
  ContractMissingDto,
  ContractNumbersDto,
  ContractNumbersInputDto,
} from "./dto/contract.dto.js";

/**
 * Contract drafts (Module 2, D71 and step 2). Admin only (the global guard). The routes live under two prefixes (the
 * driver's and the contract's), so the paths are written in full here.
 */
@Controller()
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly tracking: ContractTrackingService,
  ) {}

  /** `POST /contracts/calculate`: the numbers for some inputs, nothing saved. `400` bad inputs. */
  @Post("contracts/calculate")
  @HttpCode(HttpStatus.OK)
  calculate(@Body() body: ContractNumbersInputDto): ContractNumbersDto {
    return this.contracts.calculate(body);
  }

  /** `GET /contracts/companies`: the fixed list of companies a contract's Lessor is chosen from (not paginated: five rows). */
  @Get("contracts/companies")
  listCompanies(): Promise<ContractCompanyDto[]> {
    return this.contracts.listCompanies();
  }

  /** `GET /drivers/:driverId/contract`: the open draft or else the contract sent last, or `{ contract: null }`. `404` unknown driver. */
  @Get("drivers/:driverId/contract")
  async getCurrent(
    @Param("driverId", ParseUUIDPipe) driverId: string,
  ): Promise<ContractCurrentDto> {
    return { contract: await this.contracts.getCurrent(driverId) };
  }

  /** `POST /drivers/:driverId/contracts`: starts the draft. `400` bad inputs or unknown company; `404` unknown driver; `409` a draft exists. */
  @Post("drivers/:driverId/contracts")
  createDraft(
    @Param("driverId", ParseUUIDPipe) driverId: string,
    @Body() body: ContractInputDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ContractDto> {
    return this.contracts.createDraft(driverId, body, admin.id);
  }

  /** `PUT /contracts/:id`: replaces every input of a draft. `400` bad inputs or unknown company; `404` unknown id or not a draft. */
  @Put("contracts/:id")
  updateDraft(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ContractInputDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ContractDto> {
    return this.contracts.updateDraft(id, body, admin.id);
  }

  /**
   * `POST /contracts/:id/send`: sends the draft to the driver to sign (firma) and freezes it. `400` values still empty
   * (`missing`); `404` unknown id; `409` already sent, or not an Illinois company; `502` firma refused; `503` no firma key.
   */
  @Post("contracts/:id/send")
  @HttpCode(HttpStatus.OK)
  @ApiBadRequestResponse({ type: ContractMissingDto })
  send(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ContractDto> {
    return this.contracts.sendForSigning(id, admin.id);
  }

  /**
   * `GET /contracts/:id/documents`: short-lived links to the signed contract and its certificate (D75), minted for this
   * request and never stored. Both are null until the files are saved. `404` unknown id.
   */
  @Get("contracts/:id/documents")
  getDocuments(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ContractDocumentsDto> {
    return this.tracking.getDocuments(id);
  }

  /** `DELETE /contracts/:id`: deletes a draft. `404` unknown id or not a draft. */
  @Delete("contracts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.contracts.deleteDraft(id);
  }
}
