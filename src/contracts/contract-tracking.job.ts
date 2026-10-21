import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, In, IsNull } from "typeorm";
import { ContractTrackingService } from "./contract-tracking.service.js";
import { Contract, ContractStatus } from "./contract.entity.js";

/** Key of the Postgres advisory lock that lets only one run work at a time. Any fixed number works. */
const LOCK_KEY = 7_302_003;
/** A run looks at this many open contracts (oldest first) and this many signed ones still waiting for their files. */
const OPEN_BATCH = 200;
const FILES_BATCH = 50;

export interface TrackingSummary {
  checked: number;
  changed: number;
  failed: number;
  filesSaved: number;
}

/**
 * The scheduled catch-up of step 4 (D75). firma delivers a webhook only 3 times (now, +5 minutes, +1 hour), so an event our
 * server missed would never come again: this job asks firma about every open contract and files the signed copies. The
 * webhook is the fast path; this is the one that cannot be skipped.
 *
 * Every 5 minutes: (a) `refreshFromFirma` for each contract that is `sent` or `viewed`, (b) `saveDocuments` for each signed
 * contract whose files are not saved yet. A failure on one contract is logged with its id and does not stop the others.
 */
@Injectable()
export class ContractTrackingJob {
  private readonly logger = new Logger(ContractTrackingJob.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tracking: ContractTrackingService,
  ) {}

  /** `waitForCompletion`: a tick never starts while the previous one still runs. */
  @Cron("0 */5 * * * *", { name: "contract-tracking", waitForCompletion: true })
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (
        result &&
        (result.changed > 0 || result.filesSaved > 0 || result.failed > 0)
      ) {
        this.logger.log(
          `Contracts: ${result.checked} checked, ${result.changed} changed, ${result.filesSaved} signed files saved, ${result.failed} failed`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Contract tracking failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** One run. Returns null when another run holds the lock. */
  async run(): Promise<TrackingSummary | null> {
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
        return await this.work();
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      await lockConnection.release();
    }
  }

  private async work(): Promise<TrackingSummary> {
    const contracts = this.dataSource.getRepository(Contract);
    const summary: TrackingSummary = {
      checked: 0,
      changed: 0,
      failed: 0,
      filesSaved: 0,
    };

    const open = await contracts.find({
      where: { status: In([ContractStatus.sent, ContractStatus.viewed]) },
      order: { sentAt: "ASC" },
      take: OPEN_BATCH,
      select: { id: true, status: true },
    });
    for (const contract of open) {
      summary.checked++;
      try {
        const status = await this.tracking.refreshFromFirma(contract.id);
        if (status !== contract.status) summary.changed++;
      } catch (error) {
        // Already logged with the contract id by the service (or by Nest for a missing row); counted, never hidden.
        summary.failed++;
        this.logger.warn(
          `Contract ${contract.id} could not be checked this run: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const waiting = await contracts.find({
      where: { status: ContractStatus.signed, signedPdfKey: IsNull() },
      order: { signedAt: "ASC" },
      take: FILES_BATCH,
      select: { id: true },
    });
    for (const contract of waiting) {
      const outcome = await this.tracking.saveDocuments(contract.id);
      if (outcome === "saved") summary.filesSaved++;
      if (outcome === "failed") summary.failed++;
    }
    return summary;
  }
}
