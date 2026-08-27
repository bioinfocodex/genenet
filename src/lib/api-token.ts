import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Token generation and hashing.
 *
 * Separate from api-auth.ts, which imports next/server for NextResponse and so
 * can only be loaded inside Next. These are pure functions over strings and
 * they are the part with the security properties worth testing, so they live
 * where a test can reach them.
 */

export const TOKEN_PREFIX = 'gn_';

/** A new token. The plaintext is returned once and never stored. */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}
