import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing, extracted from actions/auth.ts so that signing can
 * re-authenticate. A 'use server' file may only export async functions, so
 * these could not be shared from where they were.
 *
 * scrypt with a per-user random salt, compared in constant time. Unchanged
 * from the original implementation apart from where it lives.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  // A malformed stored value must be a failed comparison, not a thrown
  // exception: timingSafeEqual throws when the lengths differ.
  if (!salt || !hash) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  const actual = scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
