import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";

/**
 * Everything about logging in.
 *
 * - `imports` — `UsersModule` exports UsersService and PasswordService, which AuthService
 *   needs. `JwtModule` provides JwtService; it is configured with the secret and token
 *   lifetime from the validated environment, so tokens are signed with `JWT_SECRET` and
 *   expire after `JWT_EXPIRES_IN_SECONDS`.
 * - `controllers` — the classes that define routes.
 * - `providers` — the classes Nest creates and injects.
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: {
          expiresIn: config.getOrThrow<number>("JWT_EXPIRES_IN_SECONDS"),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Registering the guard under APP_GUARD makes it run on every route in the app.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
