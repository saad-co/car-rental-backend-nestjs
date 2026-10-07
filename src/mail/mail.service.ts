import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";

/** One plain-text email. */
export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends emails. `MAIL_MODE=smtp` sends through the configured SMTP server (Gmail for now,
 * B18); `MAIL_MODE=log` only prints them to the console, for local development.
 *
 * Callers do not know which mode is on, so the same code runs locally and in production.
 * A failed send throws: the caller decides what that means (never silently ignored).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  /** The SMTP connection settings; null in log mode. */
  private readonly transporter: Transporter | null;

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>("MAIL_FROM");

    if (config.getOrThrow<string>("MAIL_MODE") === "smtp") {
      const port = config.getOrThrow<number>("SMTP_PORT");
      this.transporter = nodemailer.createTransport({
        host: config.getOrThrow<string>("SMTP_HOST"),
        port,
        // Port 465 is encrypted from the first byte; 587 upgrades to TLS after connecting.
        secure: port === 465,
        auth: {
          user: config.getOrThrow<string>("SMTP_USER"),
          pass: config.getOrThrow<string>("SMTP_PASSWORD"),
        },
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        "MAIL_MODE=log: emails are printed here and NOT sent. Local development only.",
      );
    }
  }

  /**
   * Sends one email, or prints it in log mode.
   * @throws Error if the SMTP server refuses it or cannot be reached.
   */
  async send(email: Email): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `Email (not sent, MAIL_MODE=log)\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}`,
      );
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...email });
    this.logger.log(`Email sent to ${email.to}: ${email.subject}`);
  }
}
