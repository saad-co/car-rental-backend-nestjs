import { SetMetadata } from "@nestjs/common";

/** The metadata key the auth guard looks for. */
export const IS_PUBLIC_KEY = "isPublic";

/**
 * Marks a route (or a whole controller) as open to everyone, so it needs no login token.
 *
 * Every other route requires a valid token (see JwtAuthGuard). A decorator like this one
 * just attaches a value to the route; the guard reads it at request time.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
