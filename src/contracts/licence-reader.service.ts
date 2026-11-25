import {
  BadGatewayException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import {
  LlmRateLimitError,
  LlmUnavailableError,
  type LlmJsonClient,
} from "../llm/llm-client.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { isPdf, LicenceError, normaliseImage } from "./contract-licence.js";
import {
  LICENCE_FULL_SCHEMA,
  LICENCE_FULL_SYSTEM,
  LICENCE_SCHEMA,
  LICENCE_SYSTEM,
  LICENCE_USER,
  validateFullLicence,
  validateLicenceDetails,
  type LicenceDetails,
  type LicenceFullDetails,
} from "./licence-extraction.js";
import { fetchLicenceFile } from "./licence-file.js";

/** The AI client used to read licences; null when `LLM_API_KEY` / `LLM_MODEL` are not set. */
export const LICENCE_LLM = Symbol("LICENCE_LLM");

/**
 * Reads the contract's driver details (address, licence number, state, date of birth) from the driver's licence file
 * with the AI (B121, D86). Nothing is saved: the admin sees the values in the draft's Driver details card, can change
 * them, and they are saved with the draft as if typed. The licence goes to the AI provider (D86); only the driver's id
 * is ever logged, never the file or the values.
 */
@Injectable()
export class LicenceReaderService {
  private readonly logger = new Logger(LicenceReaderService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage | null,
    @Inject(LICENCE_LLM)
    private readonly llm: LlmJsonClient | null,
  ) {}

  /**
   * The contract's four driver details (D86).
   * @throws see {@link ask}.
   */
  async read(driverId: string): Promise<LicenceDetails> {
    const answer = await this.ask(driverId, LICENCE_SYSTEM, LICENCE_SCHEMA);
    return this.checked(validateLicenceDetails(answer, this.today()));
  }

  /**
   * Everything on the licence front, for the driver page's "Driver data" card (D116). Nothing is saved either.
   * @throws see {@link ask}.
   */
  async readFull(driverId: string): Promise<LicenceFullDetails> {
    const answer = await this.ask(
      driverId,
      LICENCE_FULL_SYSTEM,
      LICENCE_FULL_SCHEMA,
    );
    return this.checked(validateFullLicence(answer, this.today()));
  }

  /**
   * Sends the driver's licence file to the AI with these instructions and answer schema, and returns its raw answer
   * (still to be checked by the caller).
   * @throws NotFoundException no driver with this id.
   * @throws ServiceUnavailableException the AI or the file storage is not set up.
   * @throws ConflictException no licence on file, or a file that is not a picture or PDF (HEIC, B98).
   * @throws HttpException (429) the AI's rate limit or quota was reached (D118).
   * @throws ServiceUnavailableException the AI is overloaded or down (D118).
   * @throws BadGatewayException the bucket or the AI failed in any other way.
   */
  private async ask(
    driverId: string,
    system: string,
    schema: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      !(await this.dataSource.getRepository(Driver).existsBy({ id: driverId }))
    ) {
      throw new NotFoundException("Driver not found.");
    }
    if (!this.llm) {
      throw new ServiceUnavailableException(
        "Reading the licence with AI is not set up (LLM_API_KEY, LLM_MODEL).",
      );
    }
    const { body } = await fetchLicenceFile(
      this.dataSource.manager,
      this.storage,
      driverId,
      this.logger,
    );

    let file: { mimeType: string; data: Buffer };
    try {
      file = isPdf(body)
        ? { mimeType: "application/pdf", data: body }
        : { mimeType: "image/jpeg", data: await normaliseImage(body) };
    } catch (error) {
      if (error instanceof LicenceError)
        throw new ConflictException(error.message);
      throw error;
    }

    try {
      return await this.llm.generateJson({
        system,
        user: LICENCE_USER,
        schema,
        file,
      });
    } catch (error) {
      this.logger.error(
        `reading the licence of driver ${driverId} with AI failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // D118: say what the admin can do about it. A limit or quota needs credits on the Gemini key; a busy model only
      // needs a moment. Everything else keeps the general text.
      if (error instanceof LlmRateLimitError) {
        throw new HttpException(
          "The AI service's limit has been reached (Gemini free tier). Add credits to the Gemini API key, or try again in a minute.",
          HttpStatus.TOO_MANY_REQUESTS,
          { cause: error },
        );
      }
      if (error instanceof LlmUnavailableError) {
        throw new ServiceUnavailableException(
          "The AI service is busy right now. Try again in a moment.",
          { cause: error },
        );
      }
      throw new BadGatewayException(
        "The AI could not read the licence just now. Try again in a moment.",
      );
    }
  }

  /**
   * The checked answer, or a 409 when the AI found no licence.
   * @throws ConflictException the AI found no readable licence in the file.
   */
  private checked<T>(details: T | null): T {
    if (!details) {
      throw new ConflictException(
        "The AI found no readable driver's licence in the file.",
      );
    }
    return details;
  }

  /** Today's date (UTC) as `YYYY-MM-DD`, for the date checks. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
