import { BadRequestException } from "@nestjs/common";
import { addDays, chicagoDate, isCalendarDate } from "./chicago-date.js";

/**
 * Checks that a day typed by an admin (`YYYY-MM-DD`) is a real day, today or at most `maxDaysBack` days before it, in
 * Chicago: never in the future, never long ago. Used for the day a manual ledger entry or a manual payment belongs
 * to, so a typo (2025 instead of 2026) is refused instead of landing in the wrong week.
 * @throws BadRequestException otherwise.
 */
export function assertRecentDay(day: string, maxDaysBack: number): void {
  if (!isCalendarDate(day)) {
    throw new BadRequestException("The date is not a real calendar day.");
  }
  const today = chicagoDate(new Date());
  if (day > today) {
    throw new BadRequestException("The date cannot be in the future.");
  }
  if (day < addDays(today, -maxDaysBack)) {
    throw new BadRequestException(
      `The date can be at most ${maxDaysBack} days back.`,
    );
  }
}
