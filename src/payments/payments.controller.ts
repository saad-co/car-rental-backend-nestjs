import { Controller, Get, Query } from "@nestjs/common";
import { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import { PaymentListDto } from "./dto/payment.dto.js";
import { PaymentsService } from "./payments.service.js";

/** Admin payment routes under `/payments`. All need a logged-in admin (global JwtAuthGuard). */
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** `GET /payments`: one page of payments, most recent first. */
  @Get()
  list(@Query() query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    return this.payments.list(query);
  }
}
