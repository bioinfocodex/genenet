/**
 * Asking NCBI what a sequence is.
 *
 * The library search here is BLAST-shaped but library-sized: it answers "have
 * we made this before" against the lab's own records. The other question --
 * "what is this" -- cannot be answered from the lab's records at all, and is
 * the one asked of an unexpected band, a construct from a collaborator, or a
 * region nobody annotated.
 *
 * NCBI publishes a plain HTTP interface for it: a search is submitted, a
 * request id comes back, and the result is collected later. That shape is the
 * whole design constraint. There is no synchronous call to make: a search
 * takes from twenty seconds to several minutes, the id lives for 24 hours, and
 * NCBI asks callers to wait at least ten seconds between contacts and to poll
 * a single id no more than once a minute. A client that ignores that is moved
 * to a slower queue and then blocked -- for everyone at the institution, not
 * just the person who wrote it.
 *
 * Everything here is pure: the request parameters, the replies, the pacing
 * arithmetic. The fetching lives in blast-service.ts, which is server-only.
 *
 * Source for the parameters and the limits:
 * https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html
 * https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html
 */

export const BLAST_URL = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';

/**
 * NCBI's published limits, named rather than inlined.
 *
 * These are not tuning knobs. Lowering any of them is asking to be throttled,
 * and the throttle lands on the institution's address.
 */
export const LIMITS = {
  /** At least this long between any two contacts with the server. */
  contactGapMs: 10_000,
  /** At least this long between two polls of the same request id. */
  pollGapMs: 60_000,
  /** More than this in 24 hours and NCBI moves the caller to a slow queue. */
  searchesPerDay: 100,
  /** A request id is kept for 24 hours and then forgotten. */
  ridLifetimeMs: 24 * 60 * 60 * 1000,
} as const;

// ─── What is being asked ─────────────────────────────────────────────────────

export type BlastProgram = 'megablast' | 'blastn' | 'blastp' | 'blastx';

export interface ProgramInfo {
  id: BlastProgram;
  label: string;
  /** What this program is for, in the terms the question is asked in. */
  about: string;
  /** Nucleotide or protein query. */
  query: 'dna' | 'protein';
  /** Shortest query that can match: the program's word size. */
  wordSize: number;
  databases: BlastDatabase[];
}

export type BlastDatabase = 'core_nt' | 'refseq_select_rna' | 'nr' | 'swissprot' | 'pdbaa';

export const DATABASES: Record<BlastDatabase, string> = {
  /*
   * core_nt, not nt. NCBI replaced the old nt with core_nt in 2024 -- the same
   * collection with the bulk WGS and TSA records removed. A search against nt
   * still runs, but it is the superseded name and a lab reading its own notes
   * in a year should see the one NCBI will still recognise.
   */
  core_nt: 'core nucleotide (core_nt)',
  refseq_select_rna: 'RefSeq Select RNA — one transcript per gene',
  nr: 'non-redundant protein (nr)',
  swissprot: 'UniProtKB/Swiss-Prot — reviewed proteins only',
  pdbaa: 'PDB — proteins with a solved structure',
};

export const PROGRAMS: ProgramInfo[] = [
  {
    id: 'megablast',
    label: 'megablast',
    about: 'Nearly identical sequences. What a cloned insert or a sequencing read should be matched with.',
    query: 'dna',
    wordSize: 28,
    databases: ['core_nt', 'refseq_select_rna'],
  },
  {
    id: 'blastn',
    label: 'blastn',
    about: 'Related sequences across species, and short queries megablast cannot see.',
    query: 'dna',
    wordSize: 11,
    databases: ['core_nt', 'refseq_select_rna'],
  },
  {
    id: 'blastx',
    label: 'blastx',
    about: 'Translates the query in six frames and searches proteins. What an unannotated ORF is for.',
    query: 'dna',
    wordSize: 3,
    databases: ['nr', 'swissprot', 'pdbaa'],
  },
  {
    id: 'blastp',
    label: 'blastp',
    about: 'A protein against proteins.',
    query: 'protein',
    wordSize: 3,
    databases: ['nr', 'swissprot', 'pdbaa'],
  },
];

export const programInfo = (id: BlastProgram) =>
  PROGRAMS.find(p => p.id === id) ?? PROGRAMS[0];

export interface BlastRequest {
  /** Bases or residues. Not FASTA: the header is added where it is needed. */
  query: string;
  program: BlastProgram;
  database: BlastDatabase;
  /** Hits worse than this are not reported. NCBI's default is 10. */
  expect?: number;
  /** How many hits to bring back. NCBI's default is 100. */
  hitlistSize?: number;
  /** A name for the query, carried into the report. */
  title?: string;
}

/** NCBI asks every caller to identify itself and to give a contact address. */
export interface Caller {
  tool: string;
  email: string;
}

/**
 * What a search cannot answer before it is sent.
 *
 * Returned as plain sentences rather than codes: every one of these is a thing
 * the person can fix, and the fix is the message.
 */
export function problemsWith(req: BlastRequest): string[] {
  const info = programInfo(req.program);
  const q = cleanQuery(req.query, info.query);
  const out: string[] = [];

  if (q.length === 0) {
    out.push(info.query === 'dna'
      ? 'Nothing to search: the selection has no A, C, G or T in it.'
      : 'Nothing to search: the selection has no amino acids in it.');
    return out;
  }

  /*
   * A query shorter than the word size cannot be found at all: BLAST seeds on
   * exact words and there is no word to seed on. megablast's 28 is the one
   * that catches people out -- a 20 bp primer megablasted comes back empty and
   * looks like "not in the database" rather than "not asked properly".
   */
  if (q.length < info.wordSize) {
    out.push(
      `${q.length} ${info.query === 'dna' ? 'bases' : 'residues'} is shorter than ${info.label}'s word size of `
      + `${info.wordSize}, so nothing can match it.`
      + (req.program === 'megablast' ? ' Use blastn for a query this short.' : ''),
    );
  }

  if (!info.databases.includes(req.database)) {
    out.push(`${info.label} cannot search ${DATABASES[req.database]}.`);
  }

  if (req.expect !== undefined && !(req.expect > 0)) {
    out.push('The expect threshold has to be greater than nought.');
  }

  return out;
}

/**
 * What is worth saying about a search that will still run.
 *
 * Separate from `problemsWith`: a warning must never stop a search, because
 * the person may know exactly what they are doing, and a short query against
 * blastn is a legitimate if noisy thing to ask.
 */
export function warningsFor(req: BlastRequest): string[] {
  const info = programInfo(req.program);
  const q = cleanQuery(req.query, info.query);
  const out: string[] = [];

  /*
   * Under about 20 bases an exact word of 11 occurs by chance all over a
   * database of this size, so the hits are real matches to nothing in
   * particular. NCBI's own short-query adjustment exists for this and is not
   * on by default through this interface.
   */
  if (info.query === 'dna' && q.length >= info.wordSize && q.length < 20) {
    out.push(`A ${q.length} bp query is short enough that chance matches will outnumber real ones.`);
  }
  if (q.length > 10_000) {
    out.push(`${q.length.toLocaleString()} bases is a long query; this search will take several minutes.`);
  }
  return out;
}

/** Bases or residues only, upper case; everything else dropped. */
export function cleanQuery(raw: string, kind: 'dna' | 'protein'): string {
  const s = raw.toUpperCase();
  return kind === 'dna'
    // Ambiguity codes are kept: an N in a read is information, and BLAST
    // handles them. Only characters that are not sequence are dropped.
    ? s.replace(/[^ACGTURYKMSWBDHVN]/g, '')
    : s.replace(/[^ACDEFGHIKLMNPQRSTVWYBXZU*]/g, '');
}

/** The parameters that submit a search. */
export function putParams(req: BlastRequest, caller: Caller): URLSearchParams {
  const info = programInfo(req.program);
  const q = cleanQuery(req.query, info.query);
  const p = new URLSearchParams({
    CMD: 'Put',
    // megablast is not a PROGRAM of its own: it is blastn with a switch.
    PROGRAM: req.program === 'megablast' ? 'blastn' : req.program,
    DATABASE: req.database,
    QUERY: req.title ? `>${req.title.replace(/[\r\n]+/g, ' ')}\n${q}` : q,
    HITLIST_SIZE: String(req.hitlistSize ?? 50),
    EXPECT: String(req.expect ?? 10),
    // Asked for at submission as well as at collection: NCBI formats the
    // report when the search finishes, and a report asked for late can be
    // slower to come back.
    FORMAT_TYPE: 'JSON2_S',
    tool: caller.tool,
    email: caller.email,
  });
  if (req.program === 'megablast') p.set('MEGABLAST', 'on');
  return p;
}

/** The parameters that ask whether a search has finished. */
export function statusParams(rid: string, caller: Caller): URLSearchParams {
  return new URLSearchParams({
    CMD: 'Get', FORMAT_OBJECT: 'SearchInfo', RID: rid,
    tool: caller.tool, email: caller.email,
  });
}

/** The parameters that collect a finished search. */
export function resultParams(rid: string, caller: Caller): URLSearchParams {
  return new URLSearchParams({
    CMD: 'Get', RID: rid, FORMAT_TYPE: 'JSON2_S',
    tool: caller.tool, email: caller.email,
  });
}

// ─── What comes back ─────────────────────────────────────────────────────────

/**
 * NCBI answers both submission and status in an HTML page, with the machine-
 * readable part in a comment block:
 *
 *   <!--QBlastInfoBegin
 *       RID = DHKHG3VA016
 *       RTOE = 30
 *   QBlastInfoEnd
 *   -->
 *
 * Read with a line-wise scan rather than one expression, because the block
 * holds different keys at different stages and a regular expression per key
 * would silently return nothing the first time NCBI adds a line.
 */
export function readQBlastInfo(body: string): Record<string, string> {
  const start = body.indexOf('QBlastInfoBegin');
  if (start === -1) return {};
  const end = body.indexOf('QBlastInfoEnd', start);
  const block = body.slice(start + 'QBlastInfoBegin'.length, end === -1 ? undefined : end);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const at = line.indexOf('=');
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    if (key) out[key] = line.slice(at + 1).trim();
  }
  return out;
}

export interface Submitted {
  rid: string;
  /** NCBI's own estimate of the wait, in seconds. */
  estimateSec: number;
}

/**
 * The request id, from the page that submission returns.
 *
 * A submission that NCBI refuses still comes back as 200 with an HTML page and
 * no id in it, so the absence of a RID is the error condition rather than the
 * status code.
 */
export function readSubmission(body: string): Submitted | { error: string } {
  const info = readQBlastInfo(body);
  if (!info.RID) {
    const msg = readNcbiMessage(body);
    return { error: msg ?? 'NCBI accepted the request but returned no job id.' };
  }
  const rtoe = Number(info.RTOE);
  return { rid: info.RID, estimateSec: Number.isFinite(rtoe) && rtoe > 0 ? rtoe : 30 };
}

export type JobState =
  /** Still running. */
  | 'waiting'
  /** Finished, with hits to collect. */
  | 'ready'
  /** Finished, and nothing matched. */
  | 'no-hits'
  /** NCBI could not run it. */
  | 'failed'
  /** The id is not one NCBI knows: expired, or never existed. */
  | 'expired';

export interface JobStatus {
  state: JobState;
  message?: string;
}

export function readStatus(body: string): JobStatus {
  const info = readQBlastInfo(body);
  switch (info.Status) {
    case 'WAITING':
      return { state: 'waiting' };
    case 'READY':
      /*
       * ThereAreHits is the only way to tell "finished with nothing" from
       * "finished with something" without fetching the whole report, and the
       * difference matters: no hits is an answer, and treating it as a failure
       * would have the panel report a problem where there is none.
       *
       * Read as an explicit no rather than as the absence of a yes. If the
       * field ever stops being sent, the cost of this reading is one wasted
       * request for a report with nothing in it, which the panel says plainly;
       * the cost of the other reading is announcing that nothing matched, on
       * the strength of a field that was not there.
       */
      return info.ThereAreHits === 'no'
        ? { state: 'no-hits' }
        : { state: 'ready' };
    case 'FAILED':
      return { state: 'failed', message: readNcbiMessage(body) ?? 'NCBI reported the search as failed.' };
    case 'UNKNOWN':
      return {
        state: 'expired',
        message: 'NCBI no longer has this search. Results are kept for 24 hours.',
      };
    default:
      // No status line at all. Not an assumption worth making either way:
      // reported as still running so the caller polls rather than concluding.
      return { state: 'waiting' };
  }
}

/** The human-readable complaint NCBI puts in its error pages, where there is one. */
function readNcbiMessage(body: string): string | null {
  const m = /<p class="(?:error|warning)[^"]*"[^>]*>([\s\S]{0,400}?)<\/p>/i.exec(body)
    ?? /class="?error"?[^>]*>([\s\S]{0,400}?)</i.exec(body)
    ?? /Message ID#\d+\s*(.{0,200})/i.exec(body);
  if (!m) return null;
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

// ─── The hits ────────────────────────────────────────────────────────────────

export interface Hsp {
  bitScore: number;
  evalue: number;
  /** Matching residues in the aligned region. */
  identity: number;
  alignLen: number;
  gaps: number;
  queryFrom: number;
  queryTo: number;
  hitFrom: number;
  hitTo: number;
  /** -1 when the alignment is to the hit's minus strand. */
  hitStrand: 1 | -1;
}

export interface BlastHit {
  accession: string;
  /** The description line, as the record carries it. */
  title: string;
  /** Scientific name, where the record has one. */
  organism?: string;
  taxid?: number;
  /** Length of the subject sequence. */
  length: number;
  hsps: Hsp[];
  /** Best (lowest) expect value across the alignments. */
  evalue: number;
  bitScore: number;
  /** Per cent identity of the best alignment. */
  identity: number;
  /**
   * Per cent of the query covered, over all alignments to this subject.
   *
   * The union of the aligned stretches, not the best one and not their sum.
   * A gene matching across three exons covers more of the query than any one
   * exon does, and less than the three added together, because they overlap at
   * the edges often enough to matter.
   */
  coverage: number;
}

export interface BlastReport {
  program: string;
  database: string;
  queryLength: number;
  hits: BlastHit[];
}

/**
 * Read the JSON2_S report.
 *
 * Defensive throughout, and deliberately so: this is the one place in the
 * application where the shape of the data is somebody else's to change, and a
 * report that half-parses into a confident-looking table of wrong numbers
 * would be worse than one that refuses.
 */
export function parseReport(raw: unknown): BlastReport | { error: string } {
  const root = raw as Record<string, unknown> | null;
  const outputs = root && (root.BlastOutput2 as unknown);
  const first = Array.isArray(outputs) ? outputs[0] : outputs;
  const report = (first as Record<string, unknown> | undefined)?.report as Record<string, unknown> | undefined;
  if (!report) return { error: 'NCBI returned a report in a shape this version does not recognise.' };

  const results = report.results as Record<string, unknown> | undefined;
  const search = results?.search as Record<string, unknown> | undefined;
  if (!search) return { error: 'The report has no search results in it.' };

  const queryLength = num(search.query_len) ?? 0;
  const rawHits = Array.isArray(search.hits) ? search.hits : [];

  const hits: BlastHit[] = [];
  for (const h of rawHits) {
    const hit = h as Record<string, unknown>;
    const descs = Array.isArray(hit.description) ? hit.description : [];
    const d = (descs[0] ?? {}) as Record<string, unknown>;
    const hsps = readHsps(hit.hsps);
    if (hsps.length === 0) continue;

    const best = hsps.reduce((a, b) => (b.bitScore > a.bitScore ? b : a));
    hits.push({
      accession: str(d.accession) ?? str(d.id) ?? '(no accession)',
      title: str(d.title) ?? str(d.sciname) ?? '(untitled record)',
      organism: str(d.sciname) ?? undefined,
      taxid: num(d.taxid) ?? undefined,
      length: num(hit.len) ?? 0,
      hsps,
      evalue: Math.min(...hsps.map(x => x.evalue)),
      bitScore: best.bitScore,
      identity: best.alignLen > 0 ? round2((best.identity / best.alignLen) * 100) : 0,
      coverage: queryLength > 0 ? round2((coveredBases(hsps) / queryLength) * 100) : 0,
    });
  }

  return {
    program: str(report.program) ?? '',
    database: str((report.search_target as Record<string, unknown> | undefined)?.db) ?? '',
    queryLength,
    hits,
  };
}

function readHsps(raw: unknown): Hsp[] {
  if (!Array.isArray(raw)) return [];
  const out: Hsp[] = [];
  for (const r of raw) {
    const h = r as Record<string, unknown>;
    const queryFrom = num(h.query_from), queryTo = num(h.query_to);
    const hitFrom = num(h.hit_from), hitTo = num(h.hit_to);
    if (queryFrom === null || queryTo === null || hitFrom === null || hitTo === null) continue;
    out.push({
      bitScore: num(h.bit_score) ?? 0,
      evalue: num(h.evalue) ?? Infinity,
      identity: num(h.identity) ?? 0,
      alignLen: num(h.align_len) ?? 0,
      gaps: num(h.gaps) ?? 0,
      queryFrom, queryTo, hitFrom, hitTo,
      /*
       * The direction NCBI names, where it names one, and otherwise the
       * direction its coordinates imply: a minus-strand alignment is reported
       * with hit_from greater than hit_to.
       *
       * The coordinates themselves are left as they came. They are what the
       * record's own numbering says, and silently swapping them to make the
       * pair ascending would lose the only thing that distinguishes an
       * inverted match from an ordinary one.
       */
      hitStrand: readStrand(h.hit_strand) ?? (hitTo >= hitFrom ? 1 : -1),
    });
  }
  return out;
}

/** Bases of the query covered by at least one alignment. */
export function coveredBases(hsps: Hsp[]): number {
  const spans = hsps
    .map(h => [Math.min(h.queryFrom, h.queryTo), Math.max(h.queryFrom, h.queryTo)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let from = -1, to = -1;
  for (const [s, e] of spans) {
    if (from === -1) { from = s; to = e; continue; }
    // Touching counts as overlapping: 10-20 and 21-30 cover 10-30 with no gap.
    if (s <= to + 1) to = Math.max(to, e);
    else { total += to - from + 1; from = s; to = e; }
  }
  if (from !== -1) total += to - from + 1;
  return total;
}

/** NCBI writes a strand as "Plus" or "Minus". Anything else is not an answer. */
function readStrand(v: unknown): 1 | -1 | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase();
  return s === 'plus' ? 1 : s === 'minus' ? -1 : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Pacing ──────────────────────────────────────────────────────────────────

export interface PaceRecord {
  /** When the server was last contacted at all, for any reason. */
  lastContactAt: number;
  /** When each request id was last polled. */
  lastPollAt: Record<string, number>;
  /** When each search was submitted, for the daily count. */
  submittedAt: number[];
}

export const emptyPace = (): PaceRecord => ({ lastContactAt: 0, lastPollAt: {}, submittedAt: [] });

export interface PaceVerdict {
  /** Milliseconds to wait before making this contact. Nought means now. */
  waitMs: number;
  /** Set when the contact must not be made at all today. */
  refuse?: string;
}

/**
 * How long to wait before contacting NCBI.
 *
 * Both limits are checked, and the longer wins: a poll of a request id last
 * seen fifty seconds ago waits ten more, even if the server itself was
 * contacted a minute ago for something else.
 */
export function pace(
  record: PaceRecord,
  contact: { kind: 'submit' } | { kind: 'poll'; rid: string },
  now: number,
): PaceVerdict {
  const sinceContact = now - record.lastContactAt;
  let waitMs = Math.max(0, LIMITS.contactGapMs - sinceContact);

  if (contact.kind === 'poll') {
    const last = record.lastPollAt[contact.rid] ?? 0;
    waitMs = Math.max(waitMs, Math.max(0, LIMITS.pollGapMs - (now - last)));
  } else {
    const today = record.submittedAt.filter(t => now - t < LIMITS.ridLifetimeMs);
    if (today.length >= LIMITS.searchesPerDay) {
      return {
        waitMs: 0,
        refuse:
          `${LIMITS.searchesPerDay} searches have gone to NCBI from this server in the last 24 hours, `
          + 'which is the point at which NCBI starts throttling or blocking a caller. '
          + 'Run these locally with BLAST+ instead, or wait for the count to fall.',
      };
    }
  }

  return { waitMs };
}

/** Record that a contact was made, so the next one is paced against it. */
export function noteContact(
  record: PaceRecord,
  contact: { kind: 'submit' } | { kind: 'poll'; rid: string },
  now: number,
): PaceRecord {
  /*
   * Request ids older than NCBI keeps them are dropped along the way.
   *
   * Without that this map is append-only: one entry per search per day, for as
   * long as the server runs, and the pacing record is the one piece of state
   * here that nothing else ever clears. An id NCBI has forgotten cannot be
   * polled again anyway, so there is nothing to pace against.
   */
  const lastPollAt: Record<string, number> = {};
  for (const [id, at] of Object.entries(record.lastPollAt)) {
    if (now - at < LIMITS.ridLifetimeMs) lastPollAt[id] = at;
  }

  const next: PaceRecord = {
    lastContactAt: now,
    lastPollAt,
    submittedAt: record.submittedAt.filter(t => now - t < LIMITS.ridLifetimeMs),
  };
  if (contact.kind === 'poll') next.lastPollAt[contact.rid] = now;
  else next.submittedAt.push(now);
  return next;
}

/**
 * How long to leave it before asking again.
 *
 * NCBI's own estimate first, then a minute: the estimate is usually close for
 * the first wait and useless afterwards, since a search that has overrun it
 * will not say by how much.
 */
export function nextPollIn(attempt: number, estimateSec: number): number {
  if (attempt === 0) return Math.max(LIMITS.contactGapMs, Math.min(estimateSec, 120) * 1000);
  return LIMITS.pollGapMs;
}
