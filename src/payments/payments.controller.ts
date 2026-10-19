import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { AssignPaymentDto } from "./dto/assign-payment.dto.js";
import { RecordPaymentDto, VoidPaymentDto } from "./dto/record-payment.dto.js";
import { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import {
  AssignPaymentResultDto,
  PaymentDto,
  PaymentListDto,
} from "./dto/payment.dto.js";
import { PaymentsService } from "./payments.service.js";

/** Admin payment routes under `/payments`. All need a logged-in admin (global JwtAuthGuard). */
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** `GET /payments`: one page of payments, most recent first. `?match=review` lists "Needs review". */
  @Get()
  list(@Query() query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    return this.payments.list(query);
  }

  /**
   * `POST /payments/manual`: records a payment an admin received by hand (cash, check, card, or any method) and
   * credits the driver's ledger. `201` the payment (also when the same `requestKey` is sent again); `400` bad
   * amount or date, unknown driver; `409` a possible duplicate (body has `code: "possible_duplicate"` and the
   * payment found; send `confirmDuplicate: true` to record anyway), the key reused, or the reference used before.
   */
  @Post("manual")
  recordManual(
    @Body() body: RecordPaymentDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<PaymentDto> {
    return this.payments.recordManual(body, admin.id);
  }

  /**
   * `POST /payments/:id/void`: voids a payment recorded by hand and reverses its ledger credit. `201` the payment;
   * `404` unknown payment; `409` not a manual payment, or already voided.
   */
  @Post(":id/void")
  voidManual(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: VoidPaymentDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<PaymentDto> {
    return this.payments.voidManual(id, body.reason, admin.id);
  }

  /**
   * `POST /payments/:id/assign`: assigns or re-assigns a payment to a driver and saves the payer's name as
   * that driver's alias (unless another driver already owns it, which the answer reports).
   * `404` unknown payment, `400` unknown driver, `409` a rejected or discrepancy payment.
   */
  @Post(":id/assign")
  @HttpCode(HttpStatus.OK)
  assign(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AssignPaymentDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AssignPaymentResultDto> {
    return this.payments.assign(id, body.driverId, admin.id);
  }
}
