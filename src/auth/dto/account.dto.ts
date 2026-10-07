import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

/** Body of `POST /auth/verify-email`. */
export class VerifyEmailDto {
  /** The `token` from the verification link in the welcome email. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  token: string;
}

/** Body of `POST /auth/change-password`. */
export class ChangePasswordDto {
  /** The password the user logs in with now (the temporary one, at first login). */
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  /**
   * The new password: at least 8 characters. The 72-byte limit (bcrypt) is checked by the
   * service, since characters outside English can take more than one byte.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
