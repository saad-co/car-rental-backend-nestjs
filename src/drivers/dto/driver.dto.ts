import { AliasType } from "../../aliases/normalize-alias.js";
import { AliasSource } from "../../aliases/payment-alias.entity.js";
import { DriverStatus } from "../driver.entity.js";

/** One payment alias of a driver: a name, handle or company they pay from, under a payment method. */
export class DriverAliasDto {
  type: AliasType;
  /** As entered or as the provider wrote it. */
  value: string;
  /** Imported from the old system, learned from a confident AI match, or entered by an admin. */
  source: AliasSource;
}

/** A driver as the admin screens see it. Used by both the list and the detail endpoint. */
export class DriverDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, e.g. `+13125550123`. */
  phone: string;
  status: DriverStatus;
  /** When the driver was created (the application's approval). */
  createdAt: Date;
  /** Every payment alias of the driver, grouped by payment method then by value. Empty if none yet. */
  aliases: DriverAliasDto[];
  /** Number of payments assigned to this driver. */
  paymentCount: number;
  /** When the driver's most recent payment happened; null if none. */
  lastPaymentAt: Date | null;
}

/** One page of drivers, newest first. */
export class DriverListDto {
  items: DriverDto[];
  /** Number of drivers matching the filter, across all pages. */
  total: number;
  page: number;
  limit: number;
}
