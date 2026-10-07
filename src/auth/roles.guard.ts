import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "../users/user.entity.js";
import type { AuthenticatedRequest } from "./jwt-auth.guard.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { ROLES_KEY } from "./roles.decorator.js";

/** Roles allowed on a route that has no `@Roles(...)`. */
const DEFAULT_ROLES: Role[] = [Role.admin];

/**
 * Second global guard, after JwtAuthGuard: checks the logged-in user's role.
 *
 * JwtAuthGuard answers "who are you?" (401 if unknown); this answers "may you do this?"
 * (403 if not). Routes are admin-only unless `@Roles(...)` says otherwise; `@Public()` routes
 * are skipped, since there is no user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    // A route's own @Roles wins over its controller's; neither means admin-only.
    const allowed =
      this.reflector.getAllAndOverride<Role[] | undefined>(
        ROLES_KEY,
        targets,
      ) ?? DEFAULT_ROLES;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException("You do not have access to this.");
    }
    return true;
  }
}
