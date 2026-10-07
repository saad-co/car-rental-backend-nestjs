import type { Email } from "../mail/mail.service.js";

/** What goes into the welcome email of a newly approved driver. */
export interface DriverWelcomeEmailInput {
  firstName: string;
  email: string;
  temporaryPassword: string;
  /** Link that confirms the email address. */
  verifyUrl: string;
  /** Driver login page. */
  loginUrl: string;
  /** How long the verification link works, for the text (e.g. 48). */
  validForHours: number;
}

/**
 * The email a driver receives when their application is approved: login details, the
 * verification link, and what happens at first login (D26).
 */
export function driverWelcomeEmail(input: DriverWelcomeEmailInput): Email {
  return {
    to: input.email,
    subject: "Your driver account is ready",
    text: [
      `Hi ${input.firstName},`,
      "",
      "Your application has been approved and your driver account is ready.",
      "",
      `Email: ${input.email}`,
      `Temporary password: ${input.temporaryPassword}`,
      "",
      `1. Confirm your email address (this link works for ${input.validForHours} hours):`,
      `   ${input.verifyUrl}`,
      "",
      `2. Log in at ${input.loginUrl} and choose your own password.`,
      "",
      "If you did not apply to drive with us, you can ignore this email.",
    ].join("\n"),
  };
}
