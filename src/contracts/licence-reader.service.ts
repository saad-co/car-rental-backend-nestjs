import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import type { LlmJsonClient } from "../llm/llm-client.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { isPdf, LicenceError, normaliseImage } from "./contract-licence.js";
import {
  LICENCE_SCHEMA,
  LICENCE_SYSTEM,
  LICENCE_USER,
  validateLicenceDetails,
  type LicenceDetails,
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
   * @throws NotFoundException no driver with this id.
   * @throws ServiceUnavailableException the AI or the file storage is not set up.
   * @throws ConflictException no licence on file, a file that is not a picture or PDF (HEIC, B98), or the AI found no
   *   readable licence in it.
   * @throws BadGatewayException the bucket or the AI failed.
   */
  async read(driverId: string): Promise<LicenceDetails> {
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

    let answer: unknown;
    try {
      answer = await this.llm.generateJson({
        system: LICENCE_SYSTEM,
        user: LICENCE_USER,
        schema: LICENCE_SCHEMA,
        file,
      });
    } catch (error) {
      this.logger.error(
        `reading the licence of driver ${driverId} with AI failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException(
        "The AI could not read the licence just now. Try again, or type the details.",
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const details = validateLicenceDetails(answer, today);
    if (!details) {
      throw new ConflictException(
        "The AI found no readable driver's licence in the file. Type the details.",
      );
    }
    return details;
  }
}
