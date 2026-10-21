import { formatCents } from "../common/money.js";
import { contractNumbers } from "./contract-math.js";
import type { ContractValues } from "./contract-template.js";
import { ContractSchedule, type Contract } from "./contract.entity.js";

/** The parts of the company and the driver that the contract prints. */
export interface ContractCompanyValues {
  name: string;
  address: string;
}

export interface ContractDriverValues {
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, `+18722879566`. */
  phone: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-10-13` as `October 13, 2026` (the samples' style). Pure text work: no time zone can shift the day. */
export function formatLongDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${MONTHS[month - 1]} ${date}, ${year}`;
}

/** `1983-04-04` as `04/04/1983`. */
export function formatNumericDate(day: string): string {
  const [year, month, date] = day.split("-");
  return `${month}/${date}/${year}`;
}

/** `+18722879566` as `(872) 287-9566`; anything else is printed as stored. */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

/** The purchase option as the sample prints it: `$9,750`, with cents only when there are some. */
function formatPurchaseOption(cents: number): string {
  return cents % 100 === 0
    ? formatCents(cents).replace(/\.00$/, "")
    : formatCents(cents);
}

/**
 * What a contract cannot be sent without: each label names an empty value. A sample contract has no blanks, so the send is
 * refused until all of them are filled (ours, not the client's).
 */
export function missingForSend(
  contract: Contract,
  company: ContractCompanyValues | null,
  driver: ContractDriverValues,
): string[] {
  const checks: [string, unknown][] = [
    ["Company", company],
    ["Vehicle model", contract.vehicleModel],
    ["Vehicle VIN", contract.vehicleVin],
    ["Vehicle plate", contract.vehiclePlate],
    ["Vehicle plate state", contract.vehiclePlateState],
    ["Purchase option price", contract.purchaseOptionCents],
    ["Driver address", contract.lesseeAddress],
    ["License number", contract.licenseNumber],
    ["License state", contract.licenseState],
    ["Date of birth", contract.dateOfBirth],
    ["Driver email", driver.email],
    ["Driver phone", driver.phone],
  ];
  return checks
    .filter(
      ([, value]) => value === null || value === undefined || value === "",
    )
    .map(([label]) => label);
}

/**
 * Every value printed on the contract, as text. The numbers come from `contractNumbers` (the same function as the form's
 * live summary), so the PDF can never disagree with what the admin saw. Call only after `missingForSend` is empty.
 */
export function buildContractValues(
  contract: Contract,
  company: ContractCompanyValues,
  driver: ContractDriverValues,
): ContractValues {
  const n = contractNumbers(contract);
  return {
    COMPANY_NAME: company.name,
    COMPANY_ADDRESS: company.address,
    // The company's signature is its name, printed before the driver signs (D72).
    LESSOR_SIGNATURE: company.name,
    START_DATE: formatLongDate(contract.startDate),
    END_DATE: formatLongDate(n.endDate),
    TERM_MONTHS: String(contract.termMonths),
    LESSEE_NAME: `${driver.firstName} ${driver.lastName}`,
    LESSEE_ADDRESS: contract.lesseeAddress ?? "",
    LICENSE_NUMBER: contract.licenseNumber ?? "",
    LICENSE_STATE: contract.licenseState ?? "",
    DATE_OF_BIRTH: formatNumericDate(contract.dateOfBirth ?? ""),
    LESSEE_EMAIL: driver.email,
    LESSEE_PHONE: formatPhone(driver.phone),
    VEHICLE_MODEL: contract.vehicleModel ?? "",
    VEHICLE_VIN: contract.vehicleVin ?? "",
    VEHICLE_PLATE: contract.vehiclePlate ?? "",
    VEHICLE_PLATE_STATE: contract.vehiclePlateState ?? "",
    BASE_RATE: formatCents(n.baseCents),
    INSURANCE: formatCents(n.insuranceCents),
    UNLIMITED_MILES: formatCents(n.milesCents),
    MAINTENANCE: formatCents(n.maintenanceCents),
    TAXES: formatCents(n.taxCents),
    TOTAL_RATE: formatCents(contract.totalRateCents),
    PAYMENT_LABEL:
      contract.schedule === ContractSchedule.weekly
        ? "Weekly Payment"
        : "Daily Payment",
    SECURITY_DEPOSIT: formatCents(contract.securityDepositCents),
    DOCUMENTATION_FEE: formatCents(contract.documentationFeeCents),
    INSURANCE_START_FEE: formatCents(contract.insuranceStartFeeCents),
    OTHER_ONE_TIME: formatCents(contract.otherOneTimeCents),
    HOLD_VEHICLE: formatCents(contract.holdVehicleCents),
    ONE_TIME_TOTAL: formatCents(n.oneTimeTotalCents),
    AMOUNT_DUE_AT_PICKUP: formatCents(n.amountDueAtPickupCents),
    EXCESS_MILEAGE: formatCents(contract.excessMileageCents),
    INSURANCE_EXCESS: formatCents(contract.insuranceExcessCents),
    OTHER_RECURRING: formatCents(contract.otherRecurringCents),
    PURCHASE_OPTION: formatPurchaseOption(contract.purchaseOptionCents ?? 0),
  };
}
