import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SmsService } from "../sms/sms.service.js";
import { Application } from "./application.entity.js";

/**
 * The text staff get when the website submits a new application (D53): the applicant's name and a link, nothing
 * else (an SMS is not a safe place for more personal data).
 */
export function applicationAlertText(input: {
  firstName: string;
  lastName: string;
  link: string;
}): string {
  return [
    `New driver application: ${input.firstName} ${input.lastName}`,
    `Review it: ${input.link}`,
  ].join("\n");
}

/**
 * Tells staff by text that a new application arrived (D53). The recipient is `APPLICATION_ALERT_PHONE`; with it
 * empty nothing happens. The text follows SMS_MODE (`live` sends, `dry_run` only saves it).
 *
 * It must never get in the way of the website's submission, so it runs after the application is saved, is not
 * waited for, and never throws. What happened is written on the application (`alertedAt` when really sent,
 * `alertError` in plain words when Quo refused, for example its daily limit), so the admin pages can show it.
 */
@Injectable()
export class ApplicationAlertService {
  private readonly logger = new Logger(ApplicationAlertService.name);
  private readonly phone: string | null;
  private readonly webAppUrl: string;

  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    private readonly sms: SmsService,
    config: ConfigService,
  ) {
    this.phone = config.get<string>("APPLICATION_ALERT_PHONE") || null;
    this.webAppUrl = config.getOrThrow<string>("WEB_APP_URL");
  }

  /** Starts the alert without waiting for it. Never throws. */
  notifyInBackground(application: Application): void {
    this.notify(application).catch((error: unknown) =>
      this.logger.error(
        `Alert for application ${application.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /** Sends the alert and records the outcome on the application. */
  async notify(application: Application): Promise<void> {
    if (!this.phone) return;

    const result = await this.sms.sendAlert(
      this.phone,
      applicationAlertText({
        firstName: application.firstName,
        lastName: application.lastName,
        link: `${this.webAppUrl}/admin/applications/${application.id}`,
      }),
    );
    await this.applications.update(application.id, {
      alertedAt: result.sent ? new Date() : null,
      alertError: result.reason,
    });
    if (result.reason)
      this.logger.warn(
        `Alert for application ${application.id} not sent: ${result.reason}`,
      );
  }
}
