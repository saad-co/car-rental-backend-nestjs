import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MatchingService } from "../matching/matching.service.js";
import { EmailIntakeService } from "./email-intake.service.js";

/** What `syncNewMessages()` says when intake is off: nothing runs, not even matching. */
const SWITCHED_OFF = "email intake is switched off";

/**
 * Every 3 minutes (D40): read new payment emails, then match the new payments to drivers (D48). It only says
 * "look now"; the work and the safety rules are in `EmailIntakeService` and `MatchingService`. The two steps
 * fail separately: a matching problem never stops emails being stored, and a stopped intake run still lets
 * the payments it already stored be matched.
 */
@Injectable()
export class EmailIntakeScheduler {
  private readonly logger = new Logger(EmailIntakeScheduler.name);

  constructor(
    private readonly intake: EmailIntakeService,
    private readonly matching: MatchingService,
  ) {}

  /** Second 0 of every third minute. `waitForCompletion`: a tick never starts while the previous one runs. */
  @Cron("0 */3 * * * *", { name: "email-intake", waitForCompletion: true })
  async tick(): Promise<void> {
    let switchedOff = false;
    try {
      const result = await this.intake.syncNewMessages();
      if (result.ran && result.stored > 0) {
        this.logger.log(`Email intake stored ${result.stored} email(s)`);
      } else if (!result.ran) {
        switchedOff = result.reason === SWITCHED_OFF;
        if (!switchedOff) {
          this.logger.warn(`Email intake did not run: ${result.reason}`);
        }
      }
    } catch (error) {
      // Logged, never hidden: the run stopped and the next tick retries from the same email.
      this.logError("Email intake run failed", error);
    }
    if (switchedOff) return;

    try {
      const matched = await this.matching.matchPending();
      if (matched.assigned + matched.review > 0) {
        this.logger.log(
          `Matching: ${matched.assigned} assigned, ${matched.review} need review`,
        );
      }
    } catch (error) {
      // A rate limit or database problem: the remaining payments are matched on the next tick.
      this.logError("Payment matching failed", error);
    }
  }

  private logError(what: string, error: unknown): void {
    this.logger.error(
      `${what}: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
