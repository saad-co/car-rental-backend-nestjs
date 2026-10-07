import { SetMetadata } from "@nestjs/common";
import { Role } from "../users/user.entity.js";

/** The metadata key RolesGuard looks for. */
export const ROLES_KEY = "roles";

/**
 * Which roles may call a route (or every route of a controller), e.g. `@Roles(Role.driver)`.
 *
 * Routes without it are **admin-only** (see RolesGuard), so forgetting it can never expose an
 * admin route to drivers. Use it only to open a route to drivers.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
