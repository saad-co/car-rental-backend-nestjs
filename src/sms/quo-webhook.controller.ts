import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { Public } from "../auth/public.decorator.js";
import { AttachmentDownloader } from "./attachments/attachment-downloader.js";
import { verifyQuoSignature } from "./quo/verify-quo-signature.js";
import { parseQuoMessageEvent } from "./quo/quo-webhook-event.js";
import { SmsService } from "./sms.service.js";

/**
 * `POST /webhooks/quo`: where Quo delivers text events (D50). Public (Quo has no login), so the signature IS
 * the login: anything not signed with our webhook secret is refused before the body is even parsed.
 *
 * Quo retries on any non-2xx answer for about a day, so a processing error answers 500 (Quo tries again) and
 * a skipped event (other number, unknown contact) answers 200 (nothing to retry).
 */
@Public()
@Controller("webhooks/quo")
export class QuoWebhookController {
  private readonly logger = new Logger(QuoWebhookController.name);

  constructor(
    private readonly sms: SmsService,
    private readonly attachments: AttachmentDownloader,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("webhook-id") webhookId: string | undefined,
    @Headers("webhook-timestamp") timestamp: string | undefined,
    @Headers("webhook-signature") signatureHeader: string | undefined,
  ): Promise<{ result: string }> {
    const secret = this.config.get<string>("QUO_WEBHOOK_SECRET");
    if (!secret) {
      this.logger.error(
        "A Quo webhook arrived but QUO_WEBHOOK_SECRET is not set; it cannot be verified.",
      );
      throw new ServiceUnavailableException("Webhook is not configured.");
    }
    if (!request.rawBody) {
      this.logger.error("The raw request body is not available (rawBody).");
      throw new InternalServerErrorException();
    }

    const check = verifyQuoSignature({
      secret,
      webhookId,
      timestamp,
      signatureHeader,
      rawBody: request.rawBody,
    });
    if (!check.valid) {
      this.logger.warn(`Quo webhook refused: ${check.reason}`);
      throw new UnauthorizedException("Invalid signature.");
    }

    try {
      const event = parseQuoMessageEvent(request.body as unknown);
      if (!event) return { result: "ignored: not a message event" };
      const result = await this.sms.applyWebhookEvent(event);
      this.logger.log(`Quo ${event.type}: ${result}`);
      // New files are copied right away, without making Quo wait for its answer.
      if (event.message.media.length > 0) this.attachments.runInBackground();
      return { result };
    } catch (error) {
      this.logger.error(
        `Quo webhook ${webhookId ?? ""} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
