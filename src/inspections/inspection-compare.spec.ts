import { fuelChangeEighths, milesDriven } from "./inspection-compare.js";
import { FuelLevel } from "./inspection.entity.js";

describe("milesDriven", () => {
  it("is check-out minus check-in", () => {
    expect(milesDriven(84_000, 85_001)).toBe(1001);
  });
  it("is null when a reading is missing", () => {
    expect(milesDriven(null, 5)).toBeNull();
    expect(milesDriven(5, null)).toBeNull();
  });
  it("shows a lower check-out reading as negative, not hidden", () => {
    expect(milesDriven(100, 90)).toBe(-10);
  });
});

describe("fuelChangeEighths", () => {
  it("counts eighths of a tank", () => {
    expect(fuelChangeEighths(FuelLevel.full, FuelLevel.half)).toBe(-4);
    expect(fuelChangeEighths(FuelLevel.empty, FuelLevel.full)).toBe(8);
    expect(fuelChangeEighths(FuelLevel.oneQuarter, FuelLevel.oneQuarter)).toBe(
      0,
    );
  });
  it("is null when a level is missing", () => {
    expect(fuelChangeEighths(null, FuelLevel.half)).toBeNull();
  });
});
