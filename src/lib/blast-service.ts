import 'server-only';
import {
  BLAST_URL, putParams, statusParams, resultParams, readSubmission, readStatus,
  parseReport, pace, noteContact, emptyPace, nextPollIn, problemsWith,
  type BlastRequest, type BlastReport, type Caller, type JobState, type PaceRecord,
} from './blast';

/**
 * The half of remote BLAST that touches the network.
 *
 * Runs on the server, for the same reasons the accession fetch does: a lab
 * install may sit on a network with no route out, and a failed fetch should be
 * one clear sentence rather than a CORS error in a console nobody has open.
 *
 * There is a second reason here that does not apply there. NCBI's limits are
 * per caller, and from NCBI's side the caller is this institution's address,
 * not the person at the keyboard. Ten scientists each politely waiting a
 * minute between their own polls would together contact the server ten times
 * a minute. The pacing has to be in one place that all of them pass through,
 * and that place is this module.
 */

const UA = 'GeneNet/1.0 (lab notebook; +https://bioinfocodex.com)';
const TIMEOUT_MS = 60_000;

/**
 * Who NCBI should contact about a misbehaving client.
 *
 * An address NCBI can reach is the price of the service. An install that has
 * not set one still works -- NCBI does not reject the request -- but it is
 * then anonymous, and anonymous is what gets blocked first.
 */
function caller(): Caller {
  return {
    tool: 'genenet',
    email: process.env.NCBI_CONTACT_EMAIL ?? 'unset@example.invalid',
  };
}

/*
 * One pacing record for the process.
 *
 * In memory rather than in the database, for the reason the login limiter
 * gives: there is one server, and the state is cheap to rebuild. Losing it on
 * restart means the first search after a restart is not paced against the one
 * before it, which costs at most a single early contact.
 */
let record: PaceRecord = emptyPace();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Claim the next slot before waiting for it, and say how long the wait is.
 *
 * The order matters, and getting it wrong is the one way this module can fail
 * at its own job. Two requests arriving together both read the record, both
 * see the same ten-second gap, both sleep ten seconds, and both reach NCBI in
 * the same instant -- politely, and simultaneously. Writing the contact time
 * first, before any await, means the second caller reads a last-contact that
 * has not happened yet and waits a further ten seconds for it.
 */
function reserve(contact: { kind: 'submit' } | { kind: 'poll'; rid: string }) {
  const now = Date.now();
  const verdict = pace(record, contact, now);
  if (verdict.refuse) return verdict;
  record = noteContact(record, contact, now + verdict.waitMs);
  return verdict;
}

async function ask(params: URLSearchParams, method: 'GET' | 'POST'): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = method === 'POST'
      ? await fetch(BLAST_URL, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: controller.signal,
        })
      : await fetch(`${BLAST_URL}?${params}`, {
          headers: { 'User-Agent': UA },
          signal: controller.signal,
        });
    if (!res.ok) throw new Error(`NCBI answered ${res.status}.`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface StartedSearch {
  ok: true;
  rid: string;
  /** NCBI's estimate of the wait, in seconds. */
  estimateSec: number;
  /** When to ask for the result, in milliseconds from now. */
  pollInMs: number;
}
export interface Refused {
  ok: false;
  error: string;
}

export async function startSearch(req: BlastRequest): Promise<StartedSearch | Refused> {
  const problems = problemsWith(req);
  if (problems.length) return { ok: false, error: problems.join(' ') };

  const verdict = reserve({ kind: 'submit' });
  if (verdict.refuse) return { ok: false, error: verdict.refuse };
  /*
   * Waited out here rather than handed back to the browser. The ten-second
   * gap is short enough to hold a request open for, and a client told to come
   * back in eight seconds is a client that may not, which would leave the
   * next person's search contacting NCBI too soon.
   */
  if (verdict.waitMs > 0) await sleep(verdict.waitMs);

  let body: string;
  try {
    // POST, because a query of several kilobases does not fit in a URL.
    body = await ask(putParams(req, caller()), 'POST');
  } catch (e) {
    return { ok: false, error: reachError(e) };
  }

  const submitted = readSubmission(body);
  if ('error' in submitted) return { ok: false, error: submitted.error };

  return {
    ok: true,
    rid: submitted.rid,
    estimateSec: submitted.estimateSec,
    pollInMs: nextPollIn(0, submitted.estimateSec),
  };
}

export interface SearchPending {
  ok: true;
  state: 'waiting';
  /** When to ask again, in milliseconds from now. */
  pollInMs: number;
}
export interface SearchFound {
  ok: true;
  state: 'ready';
  report: BlastReport;
}
export interface SearchEmpty {
  ok: true;
  state: 'no-hits';
}
export interface SearchStopped {
  ok: false;
  state: Extract<JobState, 'failed' | 'expired'>;
  error: string;
}

export type Collected = SearchPending | SearchFound | SearchEmpty | SearchStopped;

/**
 * Ask whether a search has finished, and collect it if it has.
 *
 * Status and report are two requests, and both are paced. Asking for the
 * report without checking the status first would be one request rather than
 * two -- but an unfinished search answers that request with an HTML waiting
 * page, which is a thing this code would then have to recognise from the
 * inside of a JSON parse failure. The status call says so in one field.
 */
export async function collect(rid: string): Promise<Collected> {
  const now = Date.now();
  const verdict = pace(record, { kind: 'poll', rid }, now);
  if (verdict.waitMs > 0) {
    // Not waited out: a minute is far too long to hold a request open, and
    // the caller has somewhere useful to put the number. Nothing is claimed
    // either, because no contact is about to be made.
    return { ok: true, state: 'waiting', pollInMs: verdict.waitMs };
  }
  // Claimed before the request goes, not after it comes back.
  record = noteContact(record, { kind: 'poll', rid }, now);

  let body: string;
  try {
    body = await ask(statusParams(rid, caller()), 'GET');
  } catch (e) {
    return { ok: false, state: 'failed', error: reachError(e) };
  }

  const status = readStatus(body);
  if (status.state === 'waiting') {
    return { ok: true, state: 'waiting', pollInMs: nextPollIn(1, 0) };
  }
  if (status.state === 'failed' || status.state === 'expired') {
    return { ok: false, state: status.state, error: status.message ?? 'The search did not finish.' };
  }
  if (status.state === 'no-hits') return { ok: true, state: 'no-hits' };

  // Ready, with hits. Collecting the report is another contact with the
  // server, so it is paced like any other.
  const next = reserve({ kind: 'poll', rid: `${rid}:report` });
  if (next.waitMs > 0) await sleep(next.waitMs);

  let json: string;
  try {
    json = await ask(resultParams(rid, caller()), 'GET');
  } catch (e) {
    return { ok: false, state: 'failed', error: reachError(e) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, state: 'failed', error: 'NCBI returned something that is not the report.' };
  }
  const report = parseReport(parsed);
  if ('error' in report) return { ok: false, state: 'failed', error: report.error };

  return { ok: true, state: 'ready', report };
}

function reachError(e: unknown): string {
  if (e instanceof Error && e.name === 'AbortError') {
    return 'NCBI did not answer within a minute.';
  }
  const why = e instanceof Error ? e.message : String(e);
  return `Could not reach NCBI: ${why}`;
}
