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
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { ContractsService } from "./contracts.service.js";
import {
  ContractCompanyDto,
  ContractDraftDto,
  ContractDto,
  ContractInputDto,
  ContractNumbersDto,
  ContractNumbersInputDto,
} from "./dto/contract.dto.js";

/**
 * Contract drafts (Module 2, D71 and step 2). Admin only (the global guard). The routes live under two prefixes (the
 * driver's and the contract's), so the paths are written in full here.
 */
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

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

  /** `GET /drivers/:driverId/contract-draft`: the driver's draft, or `{ draft: null }`. `404` unknown driver. */
  @Get("drivers/:driverId/contract-draft")
  async getDraft(
    @Param("driverId", ParseUUIDPipe) driverId: string,
  ): Promise<ContractDraftDto> {
    return { draft: await this.contracts.getDraft(driverId) };
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

  /** `DELETE /contracts/:id`: deletes a draft. `404` unknown id or not a draft. */
  @Delete("contracts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.contracts.deleteDraft(id);
  }
}
