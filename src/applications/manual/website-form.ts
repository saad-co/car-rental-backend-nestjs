/**
 * The answers the gonzocar.com application form offers, and how it stores them (D68). Read on 2026-10-19 from the
 * live site's own script and from eight real applications on staging, so an application typed in by an admin has
 * exactly the shape of one from the website and every admin screen shows both the same way.
 *
 * If the website changes a choice, change it here and in the frontend's `websiteForm.ts` (same lists).
 */

/** Stored as the English text the website shows. */
export const YEARS_DRIVING = [
  "Less than 1 year",
  "1 to 2 years",
  "3 to 5 years",
  "More than 5 years",
] as const;

/** Stored as these codes (short, medium, long term); the website shows words, the database keeps the code. */
export const DURATIONS = ["corto", "mediano", "largo"] as const;

/** The apps the form lists. More than one may be picked; at least one is required. */
export const PLATFORMS = [
  "Uber",
  "Lyft",
  "DoorDash",
  "Postmates",
  "Roadie",
  "Other",
] as const;

export const YES_NO = ["yes", "no"] as const;

/** Violations and accidents in the last 4 years: the form offers 0, 1, 2 and "3+". */
export const COUNTS = ["0", "1", "2", "3+"] as const;

/** The website asks for at least 25 years. */
export const MIN_AGE = 25;
