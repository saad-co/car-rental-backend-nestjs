import { describe, expect, it } from "vitest";
import { validateLicenceDetails } from "./licence-extraction.js";

const today = "2026-11-02";
const good = {
  is_licence: true,
  address: "  12 Main St,\n Springfield, IL 62701 ",
  license_number: "A123-4567-8901",
  license_state: "il",
  date_of_birth: "1990-04-30",
};

describe("validateLicenceDetails", () => {
  it("keeps a good answer, tidied (spaces collapsed, state upper case)", () => {
    expect(validateLicenceDetails(good, today)).toEqual({
      address: "12 Main St, Springfield, IL 62701",
      licenseNumber: "A123-4567-8901",
      licenseState: "IL",
      dateOfBirth: "1990-04-30",
    });
  });

  it("is null when the AI says it is not a licence, or the answer is not an object", () => {
    expect(validateLicenceDetails({ ...good, is_licence: false }, today)).toBe(
      null,
    );
    expect(validateLicenceDetails("nope", today)).toBe(null);
  });

  it("drops what is malformed instead of passing it on", () => {
    expect(
      validateLicenceDetails(
        {
          ...good,
          license_state: "Illinois",
          date_of_birth: "02/30/1990",
          license_number: "x".repeat(51),
          address: "",
        },
        today,
      ),
    ).toEqual({
      address: null,
      licenseNumber: null,
      licenseState: null,
      dateOfBirth: null,
    });
  });

  it("refuses a date that does not exist or is not in the past", () => {
    const dob = (date_of_birth: string) =>
      validateLicenceDetails({ ...good, date_of_birth }, today)?.dateOfBirth;
    expect(dob("1990-02-30")).toBe(null);
    expect(dob("2026-11-02")).toBe(null);
    expect(dob("1990-02-28")).toBe("1990-02-28");
  });
});
