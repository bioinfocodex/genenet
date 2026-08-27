import 'server-only';

/**
 * Failure-counting rate limiter for the endpoints anyone can reach.
 *
 * GeneNet runs as one server on a lab machine, so this lives in process memory
 * rather than Redis. That is the right trade here: there is exactly one server,
 * the state is cheap to rebuild, and losing it on restart only means an
 * attacker gets their allowance back -- which a restart also gives them with
 * any external store, unless the counters are persisted, which is not worth a
 * dependency for a LAN tool.
 *
 * Only failures count. A busy lab logging in all morning must never be
 * throttled; someone guessing must be. Lockout doubles each time a bucket is
 * exhausted, so a script hits minutes of waiting within a few rounds while a
 * person who mistyped their password twice notices nothing.
 */

interface Bucket {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
  lockoutLevel: number;
  lastSeenAt: number;
}

const buckets = new Map<string, Bucket>();

/** Drop buckets nobody has touched for an hour, so memory cannot creep. */
const IDLE_MS = 60 * 60 * 1000;
let sweeper: NodeJS.Timeout | undefined;
function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const [k, b] of buckets) {
      if (b.lastSeenAt < cutoff && b.lockedUntil < Date.now()) buckets.delete(k);
    }
  }, 10 * 60 * 1000);
  sweeper.unref?.();
}

export interface RateLimitPolicy {
  /** Failures allowed inside the window before a lockout starts. */
  limit: number;
  /** How long the failures are remembered. */
  windowMs: number;
  /** First lockout; doubles on each subsequent exhaustion, up to maxLockoutMs. */
  lockoutMs: number;
  maxLockoutMs?: number;
}

export const POLICIES = {
  /** The connection code is five digits: 90,000 possibilities. Be strict. */
  connectionCode: { limit: 5, windowMs: 10 * 60_000, lockoutMs: 60_000, maxLockoutMs: 60 * 60_000 },
  /** An invite code creates an account, so it is the highest-value guess. */
  inviteCode: { limit: 5, windowMs: 15 * 60_000, lockoutMs: 2 * 60_000, maxLockoutMs: 60 * 60_000 },
  /** Passwords: generous enough for a mistyped one, tight enough for a script. */
  login: { limit: 8, windowMs: 15 * 60_000, lockoutMs: 60_000, maxLockoutMs: 30 * 60_000 },
} satisfies Record<string, RateLimitPolicy>;

export interface RateLimitState {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

/** Is this caller allowed another attempt right now? Does not count anything. */
export function checkLimit(key: string, policy: RateLimitPolicy): RateLimitState {
  startSweeper();
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) return { allowed: true, retryAfterMs: 0, remaining: policy.limit };

  b.lastSeenAt = now;

  if (b.lockedUntil > now) {
    return { allowed: false, retryAfterMs: b.lockedUntil - now, remaining: 0 };
  }
  // Window expired: the slate is clean, but the lockout level is remembered so
  // a patient attacker does not get the short first lockout every time.
  if (now - b.firstFailureAt > policy.windowMs) {
    b.failures = 0;
    b.firstFailureAt = now;
  }
  return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, policy.limit - b.failures) };
}

/** Count a failed attempt, and lock the caller out if that exhausts the bucket. */
export function recordFailure(key: string, policy: RateLimitPolicy): RateLimitState {
  startSweeper();
  const now = Date.now();
  const b = buckets.get(key) ?? {
    failures: 0, firstFailureAt: now, lockedUntil: 0, lockoutLevel: 0, lastSeenAt: now,
  };

  if (now - b.firstFailureAt > policy.windowMs && b.lockedUntil < now) {
    b.failures = 0;
    b.firstFailureAt = now;
  }

  b.failures += 1;
  b.lastSeenAt = now;

  if (b.failures >= policy.limit) {
    const max = policy.maxLockoutMs ?? policy.lockoutMs * 16;
    const duration = Math.min(policy.lockoutMs * 2 ** b.lockoutLevel, max);
    b.lockedUntil = now + duration;
    b.lockoutLevel += 1;
    b.failures = 0;
    b.firstFailureAt = now;
    buckets.set(key, b);
    return { allowed: false, retryAfterMs: duration, remaining: 0 };
  }

  buckets.set(key, b);
  return { allowed: true, retryAfterMs: 0, remaining: policy.limit - b.failures };
}

/** A correct answer clears the record for that caller. */
export function recordSuccess(key: string) {
  buckets.delete(key);
}

/**
 * A fixed pause on every rejected attempt.
 *
 * Rate limits cap how many guesses fit in a window; this caps how fast they
 * arrive inside it, which matters because a five-digit code is small enough
 * that even a few hundred fast attempts are worth denying. Fixed rather than
 * proportional to anything secret, so it leaks nothing.
 */
export function failureDelay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 400));
}

/** Human-readable wait, for a message that tells someone what to do. */
export function describeWait(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs} second${secs === 1 ? '' : 's'}`;
  const mins = Math.ceil(secs / 60);
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

/**
 * Best-effort caller identity.
 *
 * On a LAN install there is usually no proxy, so this is the socket address.
 * x-forwarded-for is honoured for setups behind one, taking the first entry.
 * A spoofable header is not a security boundary on its own -- it is a bucket
 * key, and the worst case is an attacker rotating it to get fresh allowances,
 * which is why the codes themselves also had to stop being guessable.
 */
export function clientKey(headers: Headers, action: string): string {
  const fwd = headers.get('x-forwarded-for');
  const ip =
    (fwd ? fwd.split(',')[0].trim() : '') ||
    headers.get('x-real-ip') ||
    'unknown';
  return `${action}:${ip}`;
}

/** One line per rejected attempt, so a burst is visible in the server log. */
export function logAttempt(action: string, key: string, outcome: 'failed' | 'locked') {
  const who = key.slice(action.length + 1);
  console.warn(`[genenet] ${action} ${outcome} from ${who} at ${new Date().toISOString()}`);
}
