import {
  ageFromBirthDate,
  driverAge,
  profileFromApplication,
} from "./driver-profile.js";

describe("ageFromBirthDate", () => {
  it("counts whole years, one fewer until the birthday", () => {
    expect(ageFromBirthDate("1990-06-15", "2026-06-14")).toBe(35);
    expect(ageFromBirthDate("1990-06-15", "2026-06-15")).toBe(36);
    expect(ageFromBirthDate("1990-06-15", "2026-06-16")).toBe(36);
    expect(ageFromBirthDate("1990-12-31", "2026-01-01")).toBe(35);
  });

  it("handles a 29 February birthday in a year without one", () => {
    expect(ageFromBirthDate("1996-02-29", "2026-02-28")).toBe(29);
    expect(ageFromBirthDate("1996-02-29", "2026-03-01")).toBe(30);
  });

  it("is 0 in the first year", () => {
    expect(ageFromBirthDate("2026-01-10", "2026-10-28")).toBe(0);
  });
});

describe("driverAge", () => {
  it("is null without a date of birth", () => {
    expect(driverAge(null)).toBeNull();
  });

  it("uses the Chicago day, not the UTC one", () => {
    // 2026-06-16 03:00 UTC is still the evening of the 15th in Chicago (UTC-5): the birthday has come only in UTC.
    const now = new Date("2026-06-16T03:00:00Z");
    expect(driverAge("1990-06-16", now)).toBe(35);
    expect(driverAge("1990-06-15", now)).toBe(36);
  });
});

describe("profileFromApplication", () => {
  const application = (payload: Record<string, unknown>) => ({
    city: "Chicago",
    zip: "60601",
    payload,
  });

  it("takes street, apt, city, zip and the insurance answer; the website has no middle name, state or date of birth", () => {
    expect(
      profileFromApplication(
        application({
          street: " 100 Test St ",
          apt: "4B",
          has_insurance: "yes",
        }),
      ),
    ).toEqual({
      middleName: null,
      street: "100 Test St",
      apt: "4B",
      city: "Chicago",
      state: null,
      zip: "60601",
      dateOfBirth: null,
      hasInsurance: true,
    });
  });

  it("reads no as false, and anything else (or nothing) as not known", () => {
    expect(
      profileFromApplication(application({ has_insurance: "No" })).hasInsurance,
    ).toBe(false);
    expect(
      profileFromApplication(application({ has_insurance: "maybe" }))
        .hasInsurance,
    ).toBeNull();
    expect(profileFromApplication(application({})).hasInsurance).toBeNull();
  });

  it("leaves out empty answers and anything that is not text, and cuts to the column sizes", () => {
    const profile = profileFromApplication({
      city: "   ",
      zip: null,
      payload: { street: "x".repeat(300), apt: "", has_insurance: 5 },
    });
    expect(profile.street).toHaveLength(200);
    expect(profile.apt).toBeNull();
    expect(profile.city).toBeNull();
    expect(profile.zip).toBeNull();
    expect(profile.hasInsurance).toBeNull();
  });
});
