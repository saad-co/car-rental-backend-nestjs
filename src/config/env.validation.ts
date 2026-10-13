import { plainToInstance } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from "class-validator";

// Describes the environment variables the app needs. Each decorator is a validation rule,
// the same class-validator decorators you used for DTOs in Express.
class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 5000; // default when PORT is not set

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\//, {
    message: "DATABASE_URL must start with postgresql://",
  })
  DATABASE_URL!: string;

  /** Secret used to sign login tokens. Anyone who knows it can forge tokens. */
  @IsString()
  @MinLength(32, { message: "JWT_SECRET must be at least 32 characters" })
  JWT_SECRET!: string;

  /** How long a login token stays valid, in seconds (default 8 hours). */
  @IsInt()
  @Min(60)
  JWT_EXPIRES_IN_SECONDS: number = 28800;

  /**
   * Comma-separated list of web addresses (origins) whose pages may call this API from
   * a browser, e.g. "http://localhost:5173,https://gonzocar.com".
   */
  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS: string = "http://localhost:5173";

  /**
   * Base address of the web app, used to build links in emails (e.g. the driver's email
   * verification link). No trailing slash.
   */
  @IsUrl({ require_tld: false, require_protocol: true })
  WEB_APP_URL!: string;

  /**
   * How emails go out. `smtp`: really sent (SMTP_* below). `log`: printed to the console and
   * not sent, for local development only, since the console then shows temporary passwords.
   * No default on purpose: every environment must choose.
   */
  @IsIn(["log", "smtp"])
  MAIL_MODE!: "log" | "smtp";

  /** Sender shown in emails, e.g. `Car Rental <name@gmail.com>`. With Gmail, the account's own address. */
  @IsString()
  @IsNotEmpty()
  MAIL_FROM!: string;

  /** SMTP server, e.g. `smtp.gmail.com`. Required when MAIL_MODE is `smtp`. */
  @ValidateIf((env: EnvironmentVariables) => env.MAIL_MODE === "smtp")
  @IsString()
  @IsNotEmpty()
  SMTP_HOST?: string;

  /** 465 (TLS from the start, used for Gmail) or 587 (STARTTLS). */
  @ValidateIf((env: EnvironmentVariables) => env.MAIL_MODE === "smtp")
  @IsInt()
  SMTP_PORT?: number;

  /** SMTP login; for Gmail, the Gmail address. */
  @ValidateIf((env: EnvironmentVariables) => env.MAIL_MODE === "smtp")
  @IsEmail()
  SMTP_USER?: string;

  /** SMTP password; for Gmail, an App Password (never the account password). */
  @ValidateIf((env: EnvironmentVariables) => env.MAIL_MODE === "smtp")
  @IsString()
  @IsNotEmpty()
  SMTP_PASSWORD?: string;

  /**
   * Payment-email intake on or off (spec rule 6). Text, not a boolean: with implicit conversion
   * Boolean("false") would be true. Off by default, so no environment starts reading the real inbox
   * by accident. The IMAP_* and LLM_* settings below are required only when it is "true".
   */
  @IsIn(["true", "false"])
  EMAIL_INTAKE_ENABLED: "true" | "false" = "false";

  /** IMAP server of the payment mailbox (`imap.gmail.com`, D38). */
  @ValidateIf(intakeEnabled)
  @IsString()
  @IsNotEmpty()
  IMAP_HOST?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  IMAP_PORT: number = 993;

  /** The payment mailbox address, `gonzobilling@gmail.com`. */
  @ValidateIf(intakeEnabled)
  @IsEmail()
  IMAP_USER?: string;

  /** A Google App Password for that mailbox, never the account password. */
  @ValidateIf(intakeEnabled)
  @IsString()
  @IsNotEmpty()
  IMAP_PASSWORD?: string;

  /** The only mail server whose `Authentication-Results` header is trusted (`mx.google.com`). */
  @ValidateIf(intakeEnabled)
  @IsString()
  @IsNotEmpty()
  IMAP_TRUSTED_SERVER?: string;

  /**
   * Go-live point (B33): the first run processes only emails with a UID ABOVE this number, never the
   * inbox's whole history. Needed only while no email is stored yet; after that the highest stored
   * UID is the cursor. Empty: the first run stops with an error instead of guessing.
   * Text of digits, not a number: implicit conversion would turn an empty value into 0, the whole history.
   */
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.IMAP_START_AFTER_UID !== undefined && env.IMAP_START_AFTER_UID !== "",
  )
  @Matches(/^\d+$/, { message: "IMAP_START_AFTER_UID must be a whole number" })
  IMAP_START_AFTER_UID?: string;

  /** Key for the LLM that reads payment emails. The free Gemini key is approved for real emails (D46). */
  @ValidateIf(intakeEnabled)
  @IsString()
  @IsNotEmpty()
  LLM_API_KEY?: string;

  /** Exact model name, e.g. `gemini-3.5-flash-lite`, never a moving `-latest` alias. */
  @ValidateIf(intakeEnabled)
  @IsString()
  @IsNotEmpty()
  LLM_MODEL?: string;
}

/** True when payment-email intake is switched on. */
function intakeEnabled(env: EnvironmentVariables): boolean {
  return env.EMAIL_INTAKE_ENABLED === "true";
}

// Runs once at startup (ConfigModule calls it). If anything is missing or wrong the app
// refuses to start and says exactly which variable is the problem, instead of failing
// later with a confusing error.
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true, // env values are strings; this turns "5000" into 5000
  });

  const errors = validateSync(validated);
  if (errors.length > 0) {
    const problems = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(", ")}`,
      )
      .join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${problems}`);
  }
  return validated;
}
