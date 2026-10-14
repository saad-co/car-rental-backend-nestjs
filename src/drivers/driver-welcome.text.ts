/** What goes into the text a newly approved driver receives. */
export interface DriverWelcomeTextInput {
  firstName: string;
  email: string;
  temporaryPassword: string;
  /** Driver login page. */
  loginUrl: string;
}

/**
 * The text a driver receives when their application is approved: where to log in, their email and a temporary
 * password (D52). Receiving it is the proof that the phone is theirs, so there is no separate "confirm your
 * email" step. They must choose their own password at first login (D26, D33).
 */
export function driverWelcomeText(input: DriverWelcomeTextInput): string {
  return [
    `Hi ${input.firstName}, your Gonzo Car driver account is ready.`,
    `Log in at ${input.loginUrl}`,
    `Email: ${input.email}`,
    `Temporary password: ${input.temporaryPassword}`,
    "You will be asked to choose your own password.",
  ].join("\n");
}
