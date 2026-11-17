import { FuelLevel } from "./inspection.entity.js";

/** The fuel gauge in eighths: empty is 0, full is 8. */
const EIGHTHS: Record<FuelLevel, number> = {
  [FuelLevel.empty]: 0,
  [FuelLevel.oneEighth]: 1,
  [FuelLevel.oneQuarter]: 2,
  [FuelLevel.threeEighths]: 3,
  [FuelLevel.half]: 4,
  [FuelLevel.fiveEighths]: 5,
  [FuelLevel.threeQuarters]: 6,
  [FuelLevel.sevenEighths]: 7,
  [FuelLevel.full]: 8,
};

/** Miles driven between a check-in and its check-out; null when either reading is missing. Can be negative (a typo): shown as is. */
export function milesDriven(
  checkIn: number | null,
  checkOut: number | null,
): number | null {
  return checkIn === null || checkOut === null ? null : checkOut - checkIn;
}

/** Fuel change in eighths of a tank, check-out minus check-in (negative = less fuel back than taken); null when a level is missing. */
export function fuelChangeEighths(
  checkIn: FuelLevel | null,
  checkOut: FuelLevel | null,
): number | null {
  return checkIn === null || checkOut === null
    ? null
    : EIGHTHS[checkOut] - EIGHTHS[checkIn];
}
