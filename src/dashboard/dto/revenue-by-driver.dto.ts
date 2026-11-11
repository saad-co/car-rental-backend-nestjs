import { ApiProperty } from "@nestjs/swagger";
import { DriverStatus } from "../../drivers/driver.entity.js";

/** One driver's revenue: the confirmed payments assigned to them (Dashboard page 2, D93). */
export class DriverRevenueDto {
  driverId: string;
  name: string;
  @ApiProperty({ enum: DriverStatus, enumName: "DriverStatus" })
  status: DriverStatus;
  /** An archived driver is listed too: money received stays revenue (D93). */
  archived: boolean;
  /** Confirmed payments received from them in the filter, in cents. */
  totalCents: number;
  /** How many confirmed payments that is. */
  paymentCount: number;
  /** When the latest of those payments was received. */
  lastPaymentAt: Date;
}

/** A page of drivers, biggest revenue first, with the totals of the whole filter. */
export class RevenueByDriverDto {
  items: DriverRevenueDto[];
  /** How many drivers have at least one payment in the filter. */
  total: number;
  page: number;
  limit: number;
  /** Confirmed payments of every driver in the filter, in cents (the same figure as the collections total). */
  totalCents: number;
  paymentCount: number;
}
