import { AliasType } from "../../aliases/normalize-alias.js";
import { AliasSource } from "../../aliases/payment-alias.entity.js";
import { DriverLeftReason, DriverStatus } from "../driver.entity.js";

/** One payment alias of a driver: a name, handle or company they pay from, under a payment method. */
export class DriverAliasDto {
  /** Needed to remove it (`DELETE /drivers/:id/aliases/:aliasId`). */
  id: string;
  type: AliasType;
  /** As entered or as the provider wrote it. */
  value: string;
  /** Imported from the old system, learned from a confident AI match, or entered by an admin. */
  source: AliasSource;
}

/**
 * The three onboarding steps (D56): when each was ticked; null while not done. A driver is `active` only when all
 * three are set.
 */
export class DriverOnboardingDto {
  contractSignedAt: Date | null;
  depositPaidAt: Date | null;
  /** The deposit amount in cents typed when the step was ticked (D82); null if not recorded (ticked before this existed). */
  depositPaidCents: number | null;
  vehicleAssignedAt: Date | null;
}

/** A driver as the admin screens see it. Used by both the list and the detail endpoint. */
export class DriverDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, e.g. `+13125550123`. */
  phone: string;
  /** `onboarding` until all three steps are done, then `active`; `inactive` when the driver left (D56). */
  status: DriverStatus;
  onboarding: DriverOnboardingDto;
  /** When the driver was created (when onboarding was started on the approved application, D80). */
  createdAt: Date;
  /** When an admin archived the driver (D80); null = not archived. */
  archivedAt: Date | null;
  /** How the driver left (D81); null if not inactive, or deactivated before reasons existed ("reason not recorded"). */
  leftReason: DriverLeftReason | null;
  /** When the reason was noted; null with no reason. */
  leftAt: Date | null;
  /** When an admin sent the driver to collections (D81); null = not in collections. */
  sentToCollectionsAt: Date | null;
  /** Every payment alias of the driver, grouped by payment method then by value. Empty if none yet. */
  aliases: DriverAliasDto[];
  /** Number of payments assigned to this driver. */
  paymentCount: number;
  /** When the driver's most recent payment happened; null if none. */
  lastPaymentAt: Date | null;
  /** Ledger balance in cents: credits minus debits (D60). Negative = the driver owes money; 0 with no entries. */
  balanceCents: number;
}

/** One page of drivers, newest first. */
export class DriverListDto {
  items: DriverDto[];
  /** Number of drivers matching the filter, across all pages. */
  total: number;
  page: number;
  limit: number;
}
