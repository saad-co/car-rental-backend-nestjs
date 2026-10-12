import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { EmailIntakeService } from "./email-intake.service.js";

/**
 * Triggers `syncNewMessages()` every 3 minutes (D40). It only says "look now"; all the work and the
 * safety rules are in `EmailIntakeService`. When intake is switched off, each tick returns at once.
 */
@Injectable()
export class EmailIntakeScheduler {
  private readonly logger = new Logger(EmailIntakeScheduler.name);

  constructor(private readonly intake: EmailIntakeService) {}

  /** Second 0 of every third minute. `waitForCompletion`: a tick never starts while the previous one runs. */
  @Cron("0 */3 * * * *", { name: "email-intake", waitForCompletion: true })
  async tick(): Promise<void> {
    try {
      const result = await this.intake.syncNewMessages();
      if (result.ran && result.stored > 0) {
        this.logger.log(`Email intake stored ${result.stored} email(s)`);
      } else if (
        !result.ran &&
        result.reason !== "email intake is switched off"
      ) {
        this.logger.warn(`Email intake did not run: ${result.reason}`);
      }
    } catch (error) {
      // Logged, never hidden: the run stopped and the next tick retries from the same email.
      this.logger.error(
        `Email intake run failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
