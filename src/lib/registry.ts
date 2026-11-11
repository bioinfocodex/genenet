/**
 * Issuing codes without handing the same one to two people.
 *
 * A code is read off the records that already exist and then written: read
 * every STR-nnn, take the highest, add one, create. Two people registering a
 * strain in the same second both read the same highest number and both try to
 * create STR-004. The column is unique, so the second one fails -- and what
 * the second person saw was the Prisma error, in full, where the confirmation
 * should have been, with the record they had just typed gone.
 *
 * Three registrations at once, measured against a real database, produced two
 * records and one of those errors.
 *
 * Read-then-write cannot be made safe by reading more carefully. What makes it
 * safe is noticing the collision and trying again: the database has already
 * decided who won, and the loser's code is simply the next one. The retry is
 * bounded, because a loop that never gives up is a worse failure than the one
 * it replaces.
 */

/** How many times to re-read and try again before giving up. */
export const MAX_CODE_ATTEMPTS = 8;

/**
 * True when this error is the database refusing a duplicate.
 *
 * Prisma reports it as P2002 with the offending columns in `meta.target`.
 * Matching on the code rather than the message keeps this working when the
 * message is translated or reworded, and the target is checked so that a
 * clash on some other unique column is not mistaken for a code clash and
 * retried forever.
 */
export function isUniqueViolation(e: unknown, field?: string): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return false;
  if (!field) return true;

  const target = err.meta?.target;
  const names = Array.isArray(target) ? target.map(String)
    : typeof target === 'string' ? [target]
    : [];
  // An empty target means the driver did not say which column. Treating that
  // as a match is the safe way round: the retry is bounded, and the
  // alternative is showing somebody a raw database error.
  return names.length === 0 || names.includes(field);
}

/**
 * Run a write that depends on a freshly-read code, retrying if it loses.
 *
 * `attempt` is given the attempt number so it can re-read: the point of
 * retrying is that the code is computed again from what is there now, not
 * that the same doomed write is repeated.
 */
export async function withCodeRetry<T>(
  attempt: (tryNumber: number) => Promise<T>,
  options: { field?: string; max?: number } = {},
): Promise<T> {
  const max = options.max ?? MAX_CODE_ATTEMPTS;
  let last: unknown;
  for (let i = 0; i < max; i++) {
    try {
      return await attempt(i);
    } catch (e) {
      if (!isUniqueViolation(e, options.field)) throw e;
      last = e;
    }
  }
  throw new RegistryBusyError(max, last);
}

/**
 * Given up after too many collisions.
 *
 * Carries a sentence worth showing somebody, because the thing it replaces is
 * a Prisma stack trace in a form field.
 */
export class RegistryBusyError extends Error {
  readonly attempts: number;
  readonly cause: unknown;
  constructor(attempts: number, cause?: unknown) {
    super('Several records were registered at once and this one could not get a code. Try saving again.');
    this.name = 'RegistryBusyError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

/**
 * A sentence for a failed write, in place of whatever the driver said.
 *
 * Every action in this codebase ends in `catch (e) { return { error:
 * e.message } }`, which is fine for the errors it throws on purpose and
 * unreadable for the ones the database throws.
 */
export function describeWriteError(e: unknown, what = 'record'): string {
  if (e instanceof RegistryBusyError) return e.message;
  if (isUniqueViolation(e)) {
    const target = (e as { meta?: { target?: unknown } }).meta?.target;
    const names = Array.isArray(target) ? target.map(String) : [];
    if (names.includes('code')) {
      return `Another ${what} was registered at the same moment and took that code. Try saving again.`;
    }
    return names.length
      ? `A ${what} with that ${names.join(' and ')} already exists.`
      : `A ${what} with those details already exists.`;
  }
  return e instanceof Error ? e.message : `Could not save the ${what}.`;
}
