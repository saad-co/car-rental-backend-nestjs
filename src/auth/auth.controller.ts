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
import { ChangePasswordDto, VerifyEmailDto } from "./dto/account.dto.js";
import { AuthUserDto, LoginDto, LoginResponseDto } from "./dto/login.dto.js";
import type { AuthenticatedUser } from "./jwt-auth.guard.js";
import { AllowedBeforePasswordChange } from "./password-change.decorator.js";
import { Public } from "./public.decorator.js";
import { Roles } from "./roles.decorator.js";
import { Role } from "../users/user.entity.js";

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
   * `@Roles` opens it to drivers too (routes are admin-only by default), and it works before
   * a forced password change, so the frontend can learn that the change is required.
   */
  @Get("me")
  @Roles(Role.admin, Role.driver)
  @AllowedBeforePasswordChange()
  me(@CurrentUser() user: AuthenticatedUser): AuthUserDto {
    return user;
  }

  /**
   * `POST /auth/verify-email`: confirms the email address from the token in the welcome
   * email's link. Public: the driver cannot log in before this. `204` on success.
   */
  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.auth.verifyEmail(dto.token);
  }

  /**
   * `POST /auth/change-password`: the logged-in user replaces their password. This is the
   * one action allowed while a temporary password must be changed. Returns the updated user.
   */
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.admin, Role.driver)
  @AllowedBeforePasswordChange()
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthUserDto> {
    return this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
