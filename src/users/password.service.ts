import { Injectable } from "@nestjs/common";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";

/**
 * bcrypt's cost factor: each +1 doubles the time it takes to hash a password.
 * 12 is slow enough to make guessing expensive, fast enough for a login request.
 */
const BCRYPT_COST = 12;

/** bcrypt only reads the first 72 bytes of a password and silently ignores the rest. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Hashes passwords and checks them against stored hashes.
 *
 * Passwords are never stored: only the bcrypt hash is. A hash cannot be turned back
 * into the password, and every hash includes its own random salt, so hashing the same
 * password twice gives two different results.
 *
 * `@Injectable()` marks this class so Nest can create it once and hand that same
 * instance to any class that asks for it in its constructor.
 */
@Injectable()
export class PasswordService {
  /**
   * Turns a plain password into a bcrypt hash that is safe to store.
   * @throws Error if the password is longer than {@link MAX_PASSWORD_BYTES} bytes.
   */
  async hash(password: string): Promise<string> {
    if (this.isTooLong(password)) {
      throw new Error(`Password must be at most ${MAX_PASSWORD_BYTES} bytes.`);
    }
    return bcrypt.hash(password, BCRYPT_COST);
  }

  /**
   * Checks a plain password against a stored hash.
   * Returns false (never throws) for a wrong password, a malformed hash, or a
   * password over the length limit.
   */
  async verify(password: string, passwordHash: string): Promise<boolean> {
    if (this.isTooLong(password)) {
      return false;
    }
    return bcrypt.compare(password, passwordHash);
  }

  /**
   * A random temporary password, e.g. for a new driver's first login. 12 random bytes as
   * base64url: 16 characters of letters, digits, `-` and `_`. The user must replace it at
   * first login (`must_change_password`).
   */
  generate(): string {
    return randomBytes(12).toString("base64url");
  }

  /** Length is counted in bytes, not characters, because that is what bcrypt reads. */
  private isTooLong(password: string): boolean {
    return Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES;
  }
}
