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

/** `YYYY-MM-DD` that is a real calendar day, or null. */
function calendarDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return real ? value : null;
}

/** `YYYY-MM-DD` that is a real calendar day in the past, or null. */
function birthDate(value: unknown, today: string): string | null {
  const day = calendarDay(value);
  return day !== null && day < today ? day : null;
}

/** A two-letter US state code in upper case, or null. */
function stateCode(value: unknown): string | null {
  const state = text(value, 2)?.toUpperCase() ?? null;
  return state && /^[A-Z]{2}$/.test(state) ? state : null;
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
  return {
    address: text(answer.address, 300),
    licenseNumber: text(answer.license_number, 50),
    licenseState: stateCode(answer.license_state),
    dateOfBirth: birthDate(answer.date_of_birth, today),
  };
}

/**
 * Everything printed on the front of the licence, for the driver page's "Driver data" card (D116; Abulkalam, 2026-11-19).
 * A separate read from the contract's four fields above, so the contract draft is unchanged. Null for anything the AI
 * could not read for sure. Texts are kept as printed (only spaces collapsed); dates are `YYYY-MM-DD`.
 */
export interface LicenceFullDetails {
  /** The holder's name as printed, e.g. "JANE Q DOE". */
  fullName: string | null;
  /** One line: street, city, state and ZIP as printed. */
  address: string | null;
  licenseNumber: string | null;
  /** The issuing state as its two-letter code, e.g. "IL". */
  licenseState: string | null;
  /** The licence class, e.g. "D". */
  licenseClass: string | null;
  dateOfBirth: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  sex: string | null;
  /** As printed, e.g. "5'-08\"". */
  height: string | null;
  /** As printed, e.g. "BRO". */
  eyeColor: string | null;
  /** As printed, e.g. "B" or "NONE". */
  restrictions: string | null;
  /** As printed, e.g. "NONE". */
  endorsements: string | null;
  /** The document discriminator (DD), as printed. */
  documentNumber: string | null;
}

export const LICENCE_FULL_SYSTEM = `You read a photo or scan of the front of a US driver's licence and copy every field exactly as printed.
Rules:
- is_licence: false if the picture is not a driver's licence or ID card, or cannot be read at all.
- full_name: the holder's full name as printed (first, middle, last, in the order shown).
- address: the holder's address on one line: street, city, state and ZIP, e.g. "12 Main St, Springfield, IL 62701".
- license_number: the licence number (DL / LIC NO), with its dashes or spaces as printed.
- license_state: the two-letter code of the state that issued the licence, e.g. "IL".
- license_class: the class (CLASS), e.g. "D".
- date_of_birth, issue_date, expiry_date: the dates (DOB, ISS, EXP) as YYYY-MM-DD. US licences print dates month first (MM/DD/YYYY).
- sex, height, eye_color, restrictions, endorsements: as printed (SEX, HGT, EYES, REST, END), e.g. F, 5'-08", BRO, NONE.
- document_number: the document discriminator (DD), as printed.
- Use null for any field you cannot read with certainty or that is not printed. Never guess, never invent, never complete a cut-off value.`;

/** JSON Schema of the AI's answer to the full read. */
export const LICENCE_FULL_SCHEMA = {
  type: "object",
  properties: {
    is_licence: { type: "boolean" },
    full_name: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    license_number: { type: ["string", "null"] },
    license_state: { type: ["string", "null"] },
    license_class: { type: ["string", "null"] },
    date_of_birth: { type: ["string", "null"] },
    issue_date: { type: ["string", "null"] },
    expiry_date: { type: ["string", "null"] },
    sex: { type: ["string", "null"] },
    height: { type: ["string", "null"] },
    eye_color: { type: ["string", "null"] },
    restrictions: { type: ["string", "null"] },
    endorsements: { type: ["string", "null"] },
    document_number: { type: ["string", "null"] },
  },
  required: [
    "is_licence",
    "full_name",
    "address",
    "license_number",
    "license_state",
    "license_class",
    "date_of_birth",
    "issue_date",
    "expiry_date",
    "sex",
    "height",
    "eye_color",
    "restrictions",
    "endorsements",
    "document_number",
  ],
} as const;

/**
 * The AI's answer to the full read, checked like the contract read: anything malformed becomes null. Length limits are
 * generous guards against a runaway answer, not rules about licences. The issue date may not be after today; the expiry
 * date may be in the past (an expired licence is still shown, as printed).
 * @returns null when the AI says it is not a licence or the answer is not the expected shape.
 */
export function validateFullLicence(
  raw: unknown,
  today: string,
): LicenceFullDetails | null {
  if (typeof raw !== "object" || raw === null) return null;
  const answer = raw as Record<string, unknown>;
  if (answer.is_licence !== true) return null;
  const issued = calendarDay(answer.issue_date);
  return {
    fullName: text(answer.full_name, 200),
    address: text(answer.address, 300),
    licenseNumber: text(answer.license_number, 50),
    licenseState: stateCode(answer.license_state),
    licenseClass: text(answer.license_class, 10),
    dateOfBirth: birthDate(answer.date_of_birth, today),
    issueDate: issued !== null && issued <= today ? issued : null,
    expiryDate: calendarDay(answer.expiry_date),
    sex: text(answer.sex, 10),
    height: text(answer.height, 20),
    eyeColor: text(answer.eye_color, 20),
    restrictions: text(answer.restrictions, 200),
    endorsements: text(answer.endorsements, 200),
    documentNumber: text(answer.document_number, 60),
  };
}
