import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes = 256 bits, written as 43 URL-safe characters (the spec asks for 32 or more characters). */
const TOKEN_BYTES = 32;

/** What a real token looks like: lets the public routes turn away junk without touching the database. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new link token (D102): random, not a JWT. Nothing in it says who the driver is, and it can be revoked because the
 * database decides whether it still works. `base64url` uses only letters, digits, `-` and `_`, so it is safe in a URL.
 */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * The only form of a token the database keeps: its SHA-256 as 64 lower-case hex characters. The token is already 256 random
 * bits, so a plain fast hash is enough (a password hash like bcrypt is for short human-chosen secrets). A copy of the
 * database cannot be turned back into working links.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True if `value` has the shape of a token we issue. */
export function looksLikeToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
