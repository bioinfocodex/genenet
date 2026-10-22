import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Telling another system that something happened here.
 *
 * A lab's other software -- a LIMS, a freezer monitor, a Slack channel, a
 * script somebody wrote -- cannot poll this for changes, so the useful
 * direction is outward. The hard parts are not the sending: they are proving
 * the message came from here, and not giving up at the first timeout.
 */

export const EVENTS = [
  'sequence.created',
  'sample.created',
  'sample.used',
  'entry.signed',
  'request.changed',
  'result.recorded',
] as const;

export type EventName = (typeof EVENTS)[number];

export const EVENT_LABELS: Record<EventName, string> = {
  'sequence.created': 'A construct is added',
  'sample.created': 'A sample is registered',
  'sample.used': 'Somebody takes some of a sample',
  'entry.signed': 'A notebook entry is signed',
  'request.changed': 'A request moves',
  'result.recorded': 'Results are recorded',
};

export const isEvent = (s: string): s is EventName => (EVENTS as readonly string[]).includes(s);

export interface Delivery {
  id: string;
  event: EventName;
  /** When it happened here, not when it is being sent. */
  at: string;
  /** The record it is about. */
  subject: { kind: string; id: string; label: string };
  /** Whatever else is worth saying, which differs by event. */
  data: Record<string, unknown>;
}

// ─── Proving it came from here ───────────────────────────────────────────────

/**
 * The signature header, in the shape GitHub and Stripe both use.
 *
 * `t=<unix seconds>,v1=<hex hmac>` over "<t>.<body>". The timestamp is inside
 * the signed string rather than beside it, which is the whole point: a
 * signature over the body alone can be replayed for ever, because it stays
 * valid no matter when it arrives.
 */
export function sign(body: string, secret: string, at = Date.now()): string {
  const t = Math.floor(at / 1000);
  const mac = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  return `t=${t},v1=${mac}`;
}

export interface VerifyResult {
  ok: boolean;
  why?: string;
}

/** How old a signature may be. Five minutes, which is what everybody uses. */
export const MAX_SIGNATURE_AGE_S = 300;

/**
 * Check a signature the way a receiver should.
 *
 * Exported so the test endpoint here can use the same code a recipient would,
 * and so the documentation can point at something real rather than describing
 * an algorithm somebody then implements slightly differently.
 */
export function verify(body: string, header: string, secret: string, now = Date.now()): VerifyResult {
  const parts = new Map(
    header.split(',').map(p => p.trim().split('=', 2) as [string, string]).filter(p => p.length === 2),
  );
  const t = Number(parts.get('t'));
  const given = parts.get('v1');
  if (!Number.isFinite(t) || !given) return { ok: false, why: 'The signature header is not in the expected form.' };

  const age = Math.floor(now / 1000) - t;
  if (Math.abs(age) > MAX_SIGNATURE_AGE_S) {
    return { ok: false, why: `The signature is ${Math.abs(age)} seconds ${age > 0 ? 'old' : 'in the future'}; more than ${MAX_SIGNATURE_AGE_S} is refused.` };
  }

  const expected = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  /*
   * Constant time, and length-checked first because timingSafeEqual throws on
   * a length mismatch -- which would itself leak the length through an
   * exception rather than a comparison.
   */
  if (given.length !== expected.length) return { ok: false, why: 'The signature does not match.' };
  const same = timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
  return same ? { ok: true } : { ok: false, why: 'The signature does not match.' };
}

// ─── Not giving up at the first timeout ──────────────────────────────────────

/** How many times a delivery is tried in total, the first attempt included. */
export const MAX_ATTEMPTS = 6;

/**
 * How long to wait before trying again.
 *
 * Doubling from ten seconds, so six attempts span about five minutes and then
 * stop. Jitter is a tenth either way, deterministic from the delivery's own
 * id rather than random: a hundred deliveries to one endpoint that went down
 * must not all come back at the same instant, and a retry schedule that
 * cannot be reproduced cannot be reasoned about afterwards.
 */
export function retryDelay(attempt: number, seed = ''): number {
  if (attempt < 1) return 0;
  const base = 10_000 * Math.pow(2, attempt - 1);
  const jitter = (hash(seed + attempt) % 2001) / 10000 - 0.1;    // -0.1 .. +0.1
  return Math.round(base * (1 + jitter));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export type Outcome =
  | { kind: 'delivered'; status: number }
  | { kind: 'retry'; status?: number; why: string; inMs: number }
  | { kind: 'failed'; status?: number; why: string };

/**
 * What to do about a response.
 *
 * 2xx is delivered. 4xx is not retried -- the endpoint understood and refused,
 * and sending it again fifty times is how a webhook becomes a denial of
 * service against somebody who has already said no. The exception is 429,
 * which means "not now" rather than "no".
 */
export function outcomeOf(
  response: { status: number } | { error: string },
  attempt: number,
  seed = '',
): Outcome {
  const last = attempt >= MAX_ATTEMPTS;

  if ('error' in response) {
    return last
      ? { kind: 'failed', why: response.error }
      : { kind: 'retry', why: response.error, inMs: retryDelay(attempt, seed) };
  }

  const { status } = response;
  if (status >= 200 && status < 300) return { kind: 'delivered', status };

  if (status >= 400 && status < 500 && status !== 429) {
    return { kind: 'failed', status, why: `The endpoint answered ${status}, which is a refusal rather than a hiccup.` };
  }

  const why = status === 429
    ? 'The endpoint asked to be left alone for a while.'
    : `The endpoint answered ${status}.`;
  return last ? { kind: 'failed', status, why } : { kind: 'retry', status, why, inMs: retryDelay(attempt, seed) };
}

// ─── Where a delivery goes ───────────────────────────────────────────────────

/**
 * Whether a URL is one this will post to.
 *
 * Refuses anything that is not http or https, and refuses addresses inside
 * the machine or the private network. A webhook URL is supplied by a person
 * and fetched by the server, which is the exact shape of a server-side request
 * forgery: an endpoint of http://169.254.169.254/ or http://localhost:5432/
 * turns "tell my system about new samples" into "read the cloud metadata
 * service for me".
 */
export function problemWithUrl(raw: string, opts: { allowLocal?: boolean } = {}): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That is not a URL.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'A webhook has to be an http or https address.';
  }
  if (opts.allowLocal) return null;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'That address is on this machine.';
  }
  if (host === '::1' || host === '0.0.0.0') return 'That address is on this machine.';

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return 'That address is on this machine or this network.';
    if (a === 192 && b === 168) return 'That address is on this network.';
    if (a === 172 && b >= 16 && b <= 31) return 'That address is on this network.';
    // The cloud metadata service, which is the one that actually gets stolen.
    if (a === 169 && b === 254) return 'That address is the machine\'s own metadata service.';
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return 'That address is on this network.';
  }
  return null;
}

/** A sample payload, for the page that explains what will arrive. */
export function examplePayload(event: EventName): Delivery {
  return {
    id: 'whd_example',
    event,
    at: new Date('2026-10-21T09:30:00.000Z').toISOString(),
    subject: { kind: 'sample', id: 'cmp…', label: 'PLA-001' },
    data: { name: 'pEGFP-N1 midiprep', by: 'Dr Jane Smith' },
  };
}
