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
  /** The application this driver came from (D84), for the link between the two pages; null for imported drivers. */
  applicationId: string | null;
  /** The time of day rent is due, Chicago time as `HH:MM` (24 hours), or null = not set (D92). */
  rentDueTime: string | null;
  /** Marked "On Payment Plan" by staff (D92): left out of the Should Be Deactivated list while true. */
  onPaymentPlan: boolean;
  /** The driver texted STOP: no text of any kind is sent to them until they text START (spec section 8). */
  smsOptedOut: boolean;
  /** Staff switch: the weekly driver gets the "payment due in 48 hours" text (Fleet revisions section 6). */
  upcomingRemindersEnabled: boolean;
  /** Staff switch: the driver gets balance reminders (Fleet revisions section 6). */
  balanceRemindersEnabled: boolean;
}

/**
 * The driver's profile (D85). Sensitive (date of birth, address): sent on the detail only, never in a list, and never
 * logged.
 */
export class DriverProfileDto {
  middleName: string | null;
  street: string | null;
  /** Apartment or unit. */
  apt: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** `YYYY-MM-DD`; null = not known. */
  dateOfBirth: string | null;
  /** Whole years today (Chicago day), worked out from the date of birth and never stored; null without a date of birth. */
  age: number | null;
  /** Current auto insurance; null = not known. */
  hasInsurance: boolean | null;
}

/** One driver with the profile: the answer of `GET /drivers/:id` and of every change to a driver. */
export class DriverDetailDto extends DriverDto {
  profile: DriverProfileDto;
}

/** One page of drivers, newest first. */
export class DriverListDto {
  items: DriverDto[];
  /** Number of drivers matching the filter, across all pages. */
  total: number;
  page: number;
  limit: number;
}
