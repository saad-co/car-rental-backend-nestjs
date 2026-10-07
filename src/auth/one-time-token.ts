import { createHash, randomBytes } from "node:crypto";

/** A new one-time token: the raw value goes in the link, only the hash is stored. */
export interface OneTimeToken {
  /** Sent to the user (e.g. in an email link). Never stored. */
  token: string;
  /** SHA-256 of the token, stored in the database. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Creates a random single-use token, e.g. for an email verification link.
 *
 * 32 random bytes cannot be guessed. Only the hash is stored, like a password, so someone who
 * can read the database still cannot use the link. Unlike passwords, a fast hash (SHA-256) is
 * enough: the token is long and random, so there is nothing to guess with a dictionary.
 */
export function createOneTimeToken(validForMs: number): OneTimeToken {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + validForMs),
  };
}

/** SHA-256 of a token, as hex. Used to look up a token that comes back from a link. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
