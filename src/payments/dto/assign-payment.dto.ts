import { IsUUID } from "class-validator";

/** Body of `POST /payments/:id/assign`. */
export class AssignPaymentDto {
  /** The driver the payment belongs to. */
  @IsUUID()
  driverId: string;
}
