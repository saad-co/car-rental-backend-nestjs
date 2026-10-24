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
import { verifyFirmaSignature } from "../firma/verify-firma-signature.js";
import { ContractTrackingService } from "./contract-tracking.service.js";
import { ContractStatus } from "./contract.entity.js";

/** firma wants an answer within 5 seconds: each of our calls to firma gets this much. */
const WEBHOOK_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * `POST /webhooks/firma`: where firma delivers signing events (Module 2 step 4, D75). Public (firma has no login), so the
 * signature IS the login: anything not signed with our webhook secret is refused before the body is parsed.
 *
 * **The webhook is a trigger, not a source of truth.** It only tells us *which* contract to look at; the status is then read
 * from firma itself (`refreshFromFirma`). So a replayed, duplicated, late or forged-but-signed event can change nothing that
 * firma does not say too.
 *
 * firma retries a non-2xx answer 3 times (now, +5 minutes, +1 hour), so a lookup that fails answers 500, and an event that is
 * not ours or not about a signing request answers 200 (nothing to retry).
 */
@Public()
@Controller("webhooks/firma")
export class FirmaWebhookController {
  private readonly logger = new Logger(FirmaWebhookController.name);

  constructor(
    private readonly tracking: ContractTrackingService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-firma-signature") signatureHeader: string | undefined,
    @Headers("x-firma-signature-old") oldSignatureHeader: string | undefined,
  ): Promise<{ result: string }> {
    const secret = this.config.get<string>("FIRMA_WEBHOOK_SECRET");
    if (!secret) {
      this.logger.error(
        "A firma webhook arrived but FIRMA_WEBHOOK_SECRET is not set; it cannot be verified.",
      );
      throw new ServiceUnavailableException("Webhook is not configured.");
    }
    if (!request.rawBody) {
      this.logger.error("The raw request body is not available (rawBody).");
      throw new InternalServerErrorException();
    }

    const check = verifyFirmaSignature({
      secret,
      signatureHeader,
      oldSignatureHeader,
      rawBody: request.rawBody,
    });
    if (!check.valid) {
      this.logger.warn(`firma webhook refused: ${check.reason}`);
      throw new UnauthorizedException("Invalid signature.");
    }

    const { type, firmaId } = readEvent(request.body as unknown);
    if (!type?.startsWith("signing_request.")) {
      return { result: "ignored: not a signing request event" };
    }
    if (!firmaId) return { result: "ignored: no signing request id" };

    const contract = await this.tracking.findByFirmaId(firmaId);
    if (!contract) {
      this.logger.log(`firma ${type}: request ${firmaId} is not one of ours.`);
      return { result: "ignored: unknown signing request" };
    }

    try {
      const status = await this.tracking.refreshFromFirma(contract.id, {
        timeoutMs: WEBHOOK_LOOKUP_TIMEOUT_MS,
      });
      this.logger.log(
        `firma ${type} for contract ${contract.id} (${firmaId}): now ${status}.`,
      );
      // firma makes the files about 20 s after the signing, too late for this answer: save them in the background (D77).
      if (status === ContractStatus.signed) {
        void this.tracking.saveDocumentsSoon(contract.id);
      }
      return { result: `refreshed: ${status}` };
    } catch (error) {
      // The service already logged the reason with the contract id. 500 makes firma try again.
      this.logger.error(
        `firma ${type} for contract ${contract.id} (${firmaId}) could not be applied.`,
      );
      throw error;
    }
  }
}

/** The event's `type` and `data.signing_request.id`, read defensively: the body is only a hint, never trusted. */
function readEvent(body: unknown): { type?: string; firmaId?: string } {
  if (body === null || typeof body !== "object") return {};
  const { type, data } = body as { type?: unknown; data?: unknown };
  const signingRequest =
    data !== null && typeof data === "object"
      ? (data as { signing_request?: unknown }).signing_request
      : undefined;
  const id =
    signingRequest !== null && typeof signingRequest === "object"
      ? (signingRequest as { id?: unknown }).id
      : undefined;
  return {
    type: typeof type === "string" ? type : undefined,
    firmaId: typeof id === "string" && id !== "" ? id : undefined,
  };
}
