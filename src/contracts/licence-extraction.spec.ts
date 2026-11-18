import { describe, expect, it } from "vitest";
import {
  validateFullLicence,
  validateLicenceDetails,
} from "./licence-extraction.js";

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

const fullGood = {
  is_licence: true,
  full_name: " JANE  Q DOE ",
  address: "12 Main St, Springfield, IL 62701",
  license_number: "D123-4567-8901",
  license_state: "il",
  license_class: "D",
  date_of_birth: "1990-04-30",
  issue_date: "2022-01-15",
  expiry_date: "2026-04-30",
  sex: "F",
  height: "5'-08\"",
  eye_color: "BRO",
  restrictions: "B",
  endorsements: "NONE",
  document_number: "X1234567890",
};

describe("validateFullLicence", () => {
  it("keeps every field of a good answer, as printed (spaces collapsed, state upper case)", () => {
    expect(validateFullLicence(fullGood, today)).toEqual({
      fullName: "JANE Q DOE",
      address: "12 Main St, Springfield, IL 62701",
      licenseNumber: "D123-4567-8901",
      licenseState: "IL",
      licenseClass: "D",
      dateOfBirth: "1990-04-30",
      issueDate: "2022-01-15",
      expiryDate: "2026-04-30",
      sex: "F",
      height: "5'-08\"",
      eyeColor: "BRO",
      restrictions: "B",
      endorsements: "NONE",
      documentNumber: "X1234567890",
    });
  });

  it("is null when the AI says it is not a licence, or the answer is not an object", () => {
    expect(validateFullLicence({ ...fullGood, is_licence: false }, today)).toBe(
      null,
    );
    expect(validateFullLicence(null, today)).toBe(null);
  });

  it("keeps an expiry date in the past but refuses an issue date in the future", () => {
    const details = validateFullLicence(
      { ...fullGood, expiry_date: "2020-01-01", issue_date: "2026-11-03" },
      today,
    );
    expect(details?.expiryDate).toBe("2020-01-01");
    expect(details?.issueDate).toBe(null);
    expect(
      validateFullLicence({ ...fullGood, issue_date: today }, today)?.issueDate,
    ).toBe(today);
  });

  it("drops what is malformed or far too long instead of passing it on", () => {
    const details = validateFullLicence(
      {
        ...fullGood,
        license_state: "Illinois",
        expiry_date: "04/30/2026",
        date_of_birth: "1990-02-30",
        license_class: "x".repeat(11),
        full_name: 42,
        restrictions: "",
      },
      today,
    );
    expect(details).toMatchObject({
      licenseState: null,
      expiryDate: null,
      dateOfBirth: null,
      licenseClass: null,
      fullName: null,
      restrictions: null,
    });
  });
});
