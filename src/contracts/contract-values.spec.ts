import { VALUE_KEYS } from "./contract-template.js";
import {
  buildContractValues,
  formatLongDate,
  formatNumericDate,
  formatPhone,
  missingForSend,
} from "./contract-values.js";
import { Contract, ContractSchedule } from "./contract.entity.js";

const company = {
  name: "Ashwood Holdings LLC",
  address: "114 E Everett St Ste 176, Dixon IL 61021",
};
const driver = {
  firstName: "Jesus",
  lastName: "Test",
  email: "driver@test.test",
  phone: "+18722879566",
};

/** The client's Ashwood sample, with made-up personal data: $409 weekly, 18 months from 2026-10-13. */
function contract(over: Partial<Contract> = {}): Contract {
  return Object.assign(new Contract(), {
    schedule: ContractSchedule.weekly,
    totalRateCents: 40_900,
    startDate: "2026-10-13",
    termMonths: 18,
    securityDepositCents: 20_000,
    documentationFeeCents: 0,
    insuranceStartFeeCents: 0,
    otherOneTimeCents: 0,
    holdVehicleCents: 0,
    excessMileageCents: 0,
    insuranceExcessCents: 0,
    otherRecurringCents: 0,
    companyId: "company-1",
    vehicleModel: "Toyota Camry Hybrid",
    vehicleVin: "1HGCM82633A004352",
    vehiclePlate: "AB12345",
    vehiclePlateState: "IL",
    purchaseOptionCents: 975_000,
    lesseeAddress: "1 Test Ave, Apt 2 Chicago IL 60601",
    licenseNumber: "T123-4567-8901",
    licenseState: "IL",
    dateOfBirth: "1983-04-04",
    ...over,
  });
}

describe("formatting", () => {
  it("writes dates as the samples do", () => {
    expect(formatLongDate("2026-10-13")).toBe("October 13, 2026");
    expect(formatLongDate("2028-01-05")).toBe("January 5, 2028");
    expect(formatNumericDate("1983-04-04")).toBe("04/04/1983");
  });

  it("writes a US phone as (872) 287-9566 and leaves anything else alone", () => {
    expect(formatPhone("+18722879566")).toBe("(872) 287-9566");
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("buildContractValues", () => {
  const values = buildContractValues(contract(), company, driver);

  it("gives the Ashwood sample's rate lines for a $409 total", () => {
    expect(values).toMatchObject({
      TOTAL_RATE: "$409.00",
      BASE_RATE: "$171.78",
      INSURANCE: "$122.70",
      UNLIMITED_MILES: "$53.17",
      MAINTENANCE: "$40.90",
      TAXES: "$20.45",
      SECURITY_DEPOSIT: "$200.00",
      ONE_TIME_TOTAL: "$200.00",
      AMOUNT_DUE_AT_PICKUP: "$609.00",
    });
  });

  it("prints the term, the dates and the parties", () => {
    expect(values).toMatchObject({
      TERM_MONTHS: "18",
      START_DATE: "October 13, 2026",
      END_DATE: "April 13, 2028",
      COMPANY_NAME: "Ashwood Holdings LLC",
      COMPANY_ADDRESS: "114 E Everett St Ste 176, Dixon IL 61021",
      LESSEE_NAME: "Jesus Test",
      LESSEE_EMAIL: "driver@test.test",
      LESSEE_PHONE: "(872) 287-9566",
      DATE_OF_BIRTH: "04/04/1983",
    });
  });

  it("prints the company's name as its signature (D72)", () => {
    expect(values.LESSOR_SIGNATURE).toBe("Ashwood Holdings LLC");
  });

  it("labels the payment by the schedule", () => {
    expect(values.PAYMENT_LABEL).toBe("Weekly Payment");
    const daily = buildContractValues(
      contract({ schedule: ContractSchedule.daily, totalRateCents: 6_100 }),
      company,
      driver,
    );
    expect(daily.PAYMENT_LABEL).toBe("Daily Payment");
    expect(daily.TOTAL_RATE).toBe("$61.00");
  });

  it("prints the purchase option as the sample does: whole dollars without cents", () => {
    expect(values.PURCHASE_OPTION).toBe("$9,750");
    const odd = buildContractValues(
      contract({ purchaseOptionCents: 975_050 }),
      company,
      driver,
    );
    expect(odd.PURCHASE_OPTION).toBe("$9,750.50");
  });

  it("has a value for every marker and no empty one", () => {
    expect(Object.keys(values).sort()).toEqual([...VALUE_KEYS].sort());
    for (const [key, value] of Object.entries(values)) {
      expect(value, key).not.toBe("");
    }
  });
});

describe("missingForSend", () => {
  it("is empty for a complete contract", () => {
    expect(missingForSend(contract(), company, driver)).toEqual([]);
  });

  it.each([
    ["Vehicle model", { vehicleModel: null }],
    ["Vehicle VIN", { vehicleVin: null }],
    ["Vehicle plate", { vehiclePlate: null }],
    ["Vehicle plate state", { vehiclePlateState: null }],
    ["Purchase option price", { purchaseOptionCents: null }],
    ["Driver address", { lesseeAddress: null }],
    ["License number", { licenseNumber: null }],
    ["License state", { licenseState: null }],
    ["Date of birth", { dateOfBirth: null }],
  ])("names %s when it is empty", (label, over) => {
    expect(missingForSend(contract(over), company, driver)).toEqual([label]);
  });

  it("names the company, and a purchase option of 0 counts as filled", () => {
    expect(missingForSend(contract(), null, driver)).toEqual(["Company"]);
    expect(
      missingForSend(contract({ purchaseOptionCents: 0 }), company, driver),
    ).toEqual([]);
  });

  it("names the driver's email and phone when they are empty", () => {
    expect(
      missingForSend(contract(), company, { ...driver, email: "", phone: "" }),
    ).toEqual(["Driver email", "Driver phone"]);
  });

  it("lists everything missing at once, in form order", () => {
    expect(
      missingForSend(
        contract({ vehicleVin: null, dateOfBirth: null }),
        null,
        driver,
      ),
    ).toEqual(["Company", "Vehicle VIN", "Date of birth"]);
  });
});
