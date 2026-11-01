import { chicagoDate } from "../common/chicago-date.js";
import type { Driver } from "./driver.entity.js";

/** The profile columns of a driver (D85): what an application holds that the driver row now keeps. */
export type DriverProfileFields = Pick<
  Driver,
  | "middleName"
  | "street"
  | "apt"
  | "city"
  | "state"
  | "zip"
  | "dateOfBirth"
  | "hasInsurance"
>;

/** An empty profile: nothing known. */
export const EMPTY_PROFILE: DriverProfileFields = {
  middleName: null,
  street: null,
  apt: null,
  city: null,
  state: null,
  zip: null,
  dateOfBirth: null,
  hasInsurance: null,
};

/** A text answer of the website form, trimmed and cut to the column size; empty or not text = null. */
function answer(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text.slice(0, maxLength);
}

/**
 * What an application's answers give the driver created from it (D85). The website form has street, apartment, city,
 * ZIP and "do you have auto insurance now" (yes / no); it has no middle name, state or date of birth (it asks the age,
 * which goes stale), so those stay empty until an admin fills them in. The same mapping is in the migration's backfill.
 */
export function profileFromApplication(application: {
  city: string | null;
  zip: string | null;
  payload: Record<string, unknown>;
}): DriverProfileFields {
  const insurance = answer(
    application.payload.has_insurance,
    10,
  )?.toLowerCase();
  return {
    ...EMPTY_PROFILE,
    street: answer(application.payload.street, 200),
    apt: answer(application.payload.apt, 50),
    city: answer(application.city, 100),
    zip: answer(application.zip, 10),
    hasInsurance:
      insurance === "yes" ? true : insurance === "no" ? false : null,
  };
}

/** Whole years between a birth date and a day, both `YYYY-MM-DD` (one fewer until the birthday has come). */
export function ageFromBirthDate(birthDate: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = today.split("-").map(Number);
  const birthdayPassed =
    month > birthMonth || (month === birthMonth && day >= birthDay);
  return year - birthYear - (birthdayPassed ? 0 : 1);
}

/** The driver's age today (Chicago day, spec rule 4); null when the date of birth is not known. */
export function driverAge(
  dateOfBirth: string | null,
  now: Date = new Date(),
): number | null {
  return dateOfBirth === null
    ? null
    : ageFromBirthDate(dateOfBirth, chicagoDate(now));
}
