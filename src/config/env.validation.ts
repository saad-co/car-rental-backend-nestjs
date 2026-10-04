import { plainToInstance } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
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
