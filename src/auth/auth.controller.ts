import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { CurrentUser } from "./current-user.decorator.js";
import { AuthUserDto, LoginDto, LoginResponseDto } from "./dto/login.dto.js";
import type { AuthenticatedUser } from "./jwt-auth.guard.js";
import { Public } from "./public.decorator.js";

/**
 * Authentication routes. Controllers only receive the request and hand it to a service;
 * the logic itself lives in AuthService.
 *
 * `@Controller("auth")` puts every route in this class under `/auth`.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * `POST /auth/login`: exchanges an email and password for an access token.
   *
   * `@Body()` hands over the request body as a `LoginDto`; Nest validates it first and
   * answers `400` itself if it is invalid. `@HttpCode(200)` is needed because Nest
   * answers `201 Created` to every POST by default, and a login creates nothing.
   */
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto.email, dto.password);
  }

  /**
   * `GET /auth/me`: returns the user the token belongs to. The frontend calls it when the
   * page loads to check that a stored token is still valid and to learn who is logged in.
   *
   * It has no `@Public()`, so JwtAuthGuard requires a valid token before this runs.
   */
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser): AuthUserDto {
    return user;
  }
}
