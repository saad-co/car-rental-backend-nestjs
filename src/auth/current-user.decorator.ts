import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from "./jwt-auth.guard.js";

/**
 * Parameter decorator that hands a route the logged-in user: write
 * `me(@CurrentUser() user: AuthenticatedUser)` instead of digging through the request.
 *
 * It reads `request.user`, which JwtAuthGuard sets after checking the token, so it can
 * only be used on routes that are not `@Public()`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
