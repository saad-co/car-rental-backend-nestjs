import { SetMetadata } from "@nestjs/common";

/** The metadata key RolesGuard looks for. */
export const ALLOWED_BEFORE_PASSWORD_CHANGE_KEY = "allowedBeforePasswordChange";

/**
 * Marks a route as usable by a user who must still replace their temporary password
 * (`mustChangePassword`). Every other route answers them `403` until they do (D26).
 * Only `GET /auth/me` and `POST /auth/change-password` need it.
 */
export const AllowedBeforePasswordChange = () =>
  SetMetadata(ALLOWED_BEFORE_PASSWORD_CHANGE_KEY, true);
