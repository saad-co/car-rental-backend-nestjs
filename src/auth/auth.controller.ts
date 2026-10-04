import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { LoginDto, LoginResponseDto } from "./dto/login.dto.js";

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
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto.email, dto.password);
  }
}
