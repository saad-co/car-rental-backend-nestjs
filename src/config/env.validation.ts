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
