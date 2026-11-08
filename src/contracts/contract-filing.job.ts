import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ContractFilingService } from "./contract-filing.service.js";

/** Key of the Postgres advisory lock that lets only one run work at a time. Any fixed number works. */
const LOCK_KEY = 7_302_004;

export interface FilingSummary {
  filed: number;
  failed: number;
}

/**
 * Files the signed PDFs of firma contracts in the drivers' contract slots (D90, step 2). Every 5 minutes, 30 seconds after
 * the tracking job (which saves the signed files in the first place), so a contract signed and saved shows on the driver's
 * Documents card within about 5 minutes. It also files the contracts that were signed before this existed. Anything that
 * failed is tried again on the next run.
 */
@Injectable()
export class ContractFilingJob {
  private readonly logger = new Logger(ContractFilingJob.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly filing: ContractFilingService,
  ) {}

  /** `waitForCompletion`: a tick never starts while the previous one still runs. */
  @Cron("30 */5 * * * *", { name: "contract-filing", waitForCompletion: true })
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (result && (result.filed > 0 || result.failed > 0)) {
        this.logger.log(
          `Contract copies: ${result.filed} filed, ${result.failed} failed`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Filing signed contracts failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** One run. Returns null when another run holds the lock. */
  async run(): Promise<FilingSummary | null> {
    // An advisory lock belongs to one database connection, so take, use and release it on the same one.
    const lockConnection = this.dataSource.createQueryRunner();
    await lockConnection.connect();
    try {
      const [{ locked }] = (await lockConnection.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [LOCK_KEY],
      )) as [{ locked: boolean }];
      if (!locked) return null;
      try {
        return await this.filing.fileSignedContracts();
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      await lockConnection.release();
    }
  }
}
