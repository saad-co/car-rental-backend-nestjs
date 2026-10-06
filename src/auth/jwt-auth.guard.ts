import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { Role } from "../users/user.entity.js";
import { UsersService } from "../users/users.service.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

/** The logged-in user, as attached to the request by the guard. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

/** An Express request that has passed through the guard. */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Protects every route: a request needs a valid `Authorization: Bearer <token>` header
 * unless the route is marked `@Public()`.
 *
 * A guard runs after Nest has found which route will handle the request, so it knows
 * the route's metadata (like `@Public()`), which plain Express middleware cannot.
 * Registered globally in AuthModule, so new routes are protected automatically.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  /** Returns true to let the request through, or throws 401 to stop it. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing access token.");
    }

    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      userId = payload.sub;
    } catch (error) {
      // Log the real reason (expired, bad signature, ...) for us; tell the client nothing.
      this.logger.debug(
        `Rejected token: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException("Invalid or expired access token.");
    }

    // The role and active flag come from the database, not the token, so deactivating
    // a user or changing their role takes effect on their very next request.
    const user = await this.users.findById(userId);
    if (!user || !user.active) {
      throw new UnauthorizedException("Invalid or expired access token.");
    }

    request.user = { id: user.id, email: user.email, role: user.role };
    return true;
  }

  /** Reads the token from an `Authorization: Bearer <token>` header. */
  private extractBearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    return scheme === "Bearer" ? token : undefined;
  }
}
