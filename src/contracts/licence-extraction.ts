/**
 * Reading the contract's driver details from a picture of the driver's licence with the AI (B121, D86). Pure: the
 * instructions, the answer's schema, and the checks every answer goes through before the admin sees it.
 */

/** What the contract's Driver details card is filled with. Null for anything the AI could not read for sure. */
export interface LicenceDetails {
  /** One line: street, city, state and ZIP as printed, e.g. "12 Main St, Springfield, IL 62701". */
  address: string | null;
  licenseNumber: string | null;
  /** The issuing state as its two-letter code, e.g. "IL". */
  licenseState: string | null;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null;
}

export const LICENCE_SYSTEM = `You read a photo or scan of a US driver's licence and copy four fields exactly as printed.
Rules:
- is_licence: false if the picture is not a driver's licence or ID card, or cannot be read at all.
- address: the holder's address on one line: street, city, state and ZIP, e.g. "12 Main St, Springfield, IL 62701".
- license_number: the licence number (DL / LIC NO), with its dashes or spaces as printed.
- license_state: the two-letter code of the state that issued the licence, e.g. "IL".
- date_of_birth: the date of birth (DOB) as YYYY-MM-DD. US licences print it month first (MM/DD/YYYY).
- Use null for any field you cannot read with certainty. Never guess, never invent, never complete a cut-off value.`;

export const LICENCE_USER = "Read this driver's licence.";

/** JSON Schema of the AI's answer. */
export const LICENCE_SCHEMA = {
  type: "object",
  properties: {
    is_licence: { type: "boolean" },
    address: { type: ["string", "null"] },
    license_number: { type: ["string", "null"] },
    license_state: { type: ["string", "null"] },
    date_of_birth: { type: ["string", "null"] },
  },
  required: [
    "is_licence",
    "address",
    "license_number",
    "license_state",
    "date_of_birth",
  ],
} as const;

/** A text of at most `max` characters after collapsing spaces, or null (empty, not text, or too long to be right). */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned !== "" && cleaned.length <= max ? cleaned : null;
}

/** `YYYY-MM-DD` that is a real calendar day in the past, or null. */
function birthDate(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return real && value < today ? value : null;
}

/**
 * The AI's answer, checked: anything malformed becomes null rather than reaching the contract. Lengths are the contract
 * fields' own limits (address 300, licence number 50).
 * @returns null when the AI says it is not a licence or the answer is not the expected shape.
 */
export function validateLicenceDetails(
  raw: unknown,
  today: string,
): LicenceDetails | null {
  if (typeof raw !== "object" || raw === null) return null;
  const answer = raw as Record<string, unknown>;
  if (answer.is_licence !== true) return null;
  const state = text(answer.license_state, 2)?.toUpperCase() ?? null;
  return {
    address: text(answer.address, 300),
    licenseNumber: text(answer.license_number, 50),
    licenseState: state && /^[A-Z]{2}$/.test(state) ? state : null,
    dateOfBirth: birthDate(answer.date_of_birth, today),
  };
}
