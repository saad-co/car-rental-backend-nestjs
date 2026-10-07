import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  MAX_PASSWORD_BYTES,
  PasswordService,
} from "../users/password.service.js";
import { Role } from "../users/user.entity.js";
import { UsersService } from "../users/users.service.js";
import { AuthUserDto, LoginResponseDto } from "./dto/login.dto.js";
import { hashToken } from "./one-time-token.js";

/**
 * Checks credentials and issues access tokens; verifies emails and changes passwords.
 *
 * The token is a JWT (JSON Web Token): a signed string containing the user's id and an
 * expiry time. The server does not store it; it only has to verify the signature.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * A real bcrypt hash of a random password, made once at startup. It is compared against
   * when the email is unknown, so "no such user" takes as long as "wrong password" and a
   * stranger cannot discover which emails exist by timing the responses.
   */
  private dummyHash: string;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  /** Nest calls this once, after the module's providers are created. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash(randomUUID());
  }

  /**
   * Logs a user in.
   *
   * An unknown email, a wrong password and an inactive account all produce the same
   * `401` message, so the response never says which of them it was. Only after the password
   * is proven correct does a driver learn that their email is not confirmed yet (`403`).
   *
   * @throws UnauthorizedException if the credentials are not valid.
   * @throws ForbiddenException if a driver has not confirmed their email yet (D26).
   */
  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.users.findByEmailWithPassword(email);

    const passwordMatches = await this.passwords.verify(
      password,
      user?.passwordHash ?? this.dummyHash,
    );

    if (!user || !passwordMatches || !user.active) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (user.role === Role.driver && !user.emailVerifiedAt) {
      throw new ForbiddenException(
        "Please confirm your email address first, using the link in your welcome email.",
      );
    }

    // Only the user id goes in the token. The role and active flag are read from the
    // database on every request, so changing them takes effect immediately.
    const accessToken = await this.jwt.signAsync({ sub: user.id });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /**
   * Confirms a user's email from the token in their verification link. The link works once.
   *
   * @throws BadRequestException if the token is unknown, already used, or expired.
   */
  async verifyEmail(token: string): Promise<void> {
    const user = await this.users.findByEmailVerificationTokenHash(
      hashToken(token),
    );
    if (!user) {
      throw new BadRequestException(
        "This link is invalid or has already been used.",
      );
    }
    if (
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        "This link has expired. Please contact us for a new one.",
      );
    }
    await this.users.markEmailVerified(user.id);
  }

  /**
   * Replaces the logged-in user's password. Ends the forced change after first login (D26).
   *
   * A wrong current password is `400`, not `401`: the user is logged in, only this form is
   * wrong, and a `401` would make the frontend log them out.
   *
   * @throws BadRequestException if the current password is wrong, the new one equals it, or
   *   the new one is longer than bcrypt can use.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthUserDto> {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user) {
      throw new UnauthorizedException("Invalid or expired access token.");
    }
    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new BadRequestException("Your current password is incorrect.");
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException(
        "Choose a new password different from the current one.",
      );
    }
    if (Buffer.byteLength(newPassword, "utf8") > MAX_PASSWORD_BYTES) {
      throw new BadRequestException(
        `The new password must be at most ${MAX_PASSWORD_BYTES} bytes.`,
      );
    }

    await this.users.setOwnPassword(user.id, newPassword);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: false,
    };
  }
}
