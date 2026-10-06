import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { Role } from "../../users/user.entity.js";

/**
 * Body of `POST /auth/login`.
 *
 * A DTO (data transfer object) is a class describing what a request must look like.
 * The decorators are validation rules; Nest rejects the request with `400` before any
 * of our code runs if a rule fails (this is Nest's version of validation middleware).
 */
export class LoginDto {
  /** The account's email address. */
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** The account's password, in plain text (it only travels over HTTPS in production). */
  @IsString()
  @IsNotEmpty()
  password: string;
}

/** The logged-in user as sent back to the client. Never includes the password hash. */
export class AuthUserDto {
  id: string;
  email: string;
  role: Role;
}

/** Response of a successful login. */
export class LoginResponseDto {
  /** Signed token the client sends back on every request as `Authorization: Bearer <token>`. */
  accessToken: string;
  user: AuthUserDto;
}
