import { QueryFailedError } from "typeorm";

/** Postgres's error code for "a unique constraint was violated". */
const UNIQUE_VIOLATION = "23505";

/**
 * Tells whether an error means "this value already exists" (a unique constraint was
 * broken, e.g. two users with the same email).
 *
 * The database is what enforces uniqueness, even when two requests arrive at the same
 * instant. Services catch this error, turn it into a friendly HTTP response, and rethrow
 * every other kind of error.
 *
 * @param constraint when given, only a violation of that constraint (or unique index) counts.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as
    { code?: string; constraint?: string } | undefined;
  return (
    driverError?.code === UNIQUE_VIOLATION &&
    (constraint === undefined || driverError.constraint === constraint)
  );
}
