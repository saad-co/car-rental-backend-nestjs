import { randomUUID } from "node:crypto";
import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PasswordService } from "../users/password.service.js";
import { UsersService } from "../users/users.service.js";
import { LoginResponseDto } from "./dto/login.dto.js";

/**
 * Checks credentials and issues access tokens.
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
   * `401` message, so the response never says which of them it was.
   *
   * @throws UnauthorizedException if the credentials are not valid.
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

    // Only the user id goes in the token. The role and active flag are read from the
    // database on every request, so changing them takes effect immediately.
    const accessToken = await this.jwt.signAsync({ sub: user.id });

    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
