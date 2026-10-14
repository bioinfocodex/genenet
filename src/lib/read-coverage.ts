import type { TraceVerification } from './trace-alignment';

/**
 * Several reads over one construct, taken together.
 *
 * One read is evidence about the stretch it covers; a construct is confirmed
 * by the set. What matters is where the set leaves gaps, where it rests on a
 * single read, and -- most of all -- what each difference looks like across
 * every read that covers it. A mismatch one read reports and another
 * contradicts at Q50 is a read error; the same change in two reads, one from
 * each strand, is in the plasmid.
 */

/** Calls at or above this quality count as clear evidence either way. */
export const CONFIDENT = 30;

export interface ReadInput {
  name: string;
  verification: TraceVerification;
}

export interface Call {
  read: string;
  /** Base the read calls; '-' for a deletion. */
  base: string;
  quality: number | null;
  /** Column in that read's verification, for jumping its trace there. */
  column: number;
  reversed: boolean;
  /** True when the trace shows a strong second peak here. */
  mixed: boolean;
}

/**
 * - confirmed: two or more reads make the same change and none clearly reads
 *   the reference base -- this is in the plasmid.
 * - contradicted: a read reports a change that another read clearly does not
 *   see -- most likely a read error.
 * - single: only one read covers it -- needs another read to settle.
 * - contested: reads clearly disagree with each other, which is what a mixed
 *   colony or a mixed prep looks like.
 */
export type Agreement = 'confirmed' | 'contradicted' | 'single' | 'contested';

export interface Disagreement {
  /** 1-based reference position. */
  position: number;
  reference: string;
  calls: Call[];
  agreement: Agreement;
  /** The change, as the reads that report it call it. */
  change: string;
}

export interface Span {
  read: string;
  start: number;
  end: number;
  reversed: boolean;
  verdict: TraceVerification['verdict'];
}

export interface Coverage {
  length: number;
  /** Reads with a base (or a deletion) at each position, index = position - 1. */
  depth: number[];
  spans: Span[];
  covered: number;
  /** Positions resting on one read only. */
  singleRead: number;
  /** Positions read from both strands. */
  bothStrands: number;
  /** Stretches no read covers, 1-based inclusive. */
  gaps: { start: number; end: number }[];
  disagreements: Disagreement[];
}

const confident = (q: number | null) => q == null || q >= CONFIDENT;

/**
 * Decide what the calls at one position, taken together, say.
 *
 * Mixed peaks, or reads naming different changes, are contested outright.
 * Otherwise it comes down to clear calls on each side: a change two reads
 * make with nothing clearly against it is confirmed; one read's change that a
 * clear reference call contradicts is a read error -- unless that one read is
 * itself clear and only one read stands against it, which is a draw, and a
 * draw at one position is what a mixed template looks like.
 */
export function classify(calls: Call[], reference: string): Agreement {
  const alt = calls.filter(c => c.base !== reference);
  const altConf = alt.filter(c => confident(c.quality));
  const refConf = calls.filter(c => c.base === reference && confident(c.quality));
  if (calls.some(c => c.mixed)) return 'contested';
  if (new Set(alt.map(c => c.base)).size > 1) return 'contested';
  if (calls.length <= 1) return 'single';
  if (alt.length >= 2 && refConf.length === 0) return 'confirmed';
  if (refConf.length > 0) {
    if (altConf.length === 0) return 'contradicted';
    return altConf.length === 1 && refConf.length >= 2 ? 'contradicted' : 'contested';
  }
  return 'single';
}

export function coverageOf(referenceLength: number, reads: ReadInput[]): Coverage {
  const n = referenceLength;
  const depth = new Array<number>(n).fill(0);
  const forward = new Array<boolean>(n).fill(false);
  const reverse = new Array<boolean>(n).fill(false);
  const refAt = new Map<number, string>();
  const callsAt = new Map<number, Call[]>();
  /** Per read: its call at each position, and bases it inserts after each. */
  const perRead: { name: string; reversed: boolean; at: Map<number, Call>; inserted: Map<number, { bases: string; column: number; quality: number | null }> }[] = [];
  const spans: Span[] = [];

  for (const { name, verification: v } of reads) {
    if (v.verdict === 'unusable' || !v.columns.length) continue;
    spans.push({ read: name, start: v.coverageStart, end: v.coverageEnd, reversed: v.reversed, verdict: v.verdict });
    const mixedCols = new Set(v.discrepancies.filter(d => d.kind === 'mixed').map(d => d.column));
    const at = new Map<number, Call>();
    const inserted = new Map<number, { bases: string; column: number; quality: number | null }>();

    v.columns.forEach((c, column) => {
      const p = c.refPos;
      if (p < 1 || p > n) return;
      if (c.kind === 'insertion') {
        const prev = inserted.get(p);
        inserted.set(p, {
          bases: (prev?.bases ?? '') + c.read,
          column: prev?.column ?? column,
          quality: prev ? Math.min(prev.quality ?? 99, c.quality ?? 99) : c.quality,
        });
        return;
      }
      refAt.set(p, c.ref);
      depth[p - 1]++;
      (v.reversed ? reverse : forward)[p - 1] = true;
      const call: Call = { read: name, base: c.read, quality: c.quality, column, reversed: v.reversed, mixed: mixedCols.has(column) };
      at.set(p, call);
      const list = callsAt.get(p) ?? [];
      list.push(call);
      callsAt.set(p, list);
    });
    perRead.push({ name, reversed: v.reversed, at, inserted });
  }

  const disagreements: Disagreement[] = [];

  // Substitutions, deletions and mixed peaks: positions where any read's call
  // is not the reference base or shows a second peak.
  for (const [p, calls] of callsAt) {
    const ref = refAt.get(p) ?? '?';
    if (!calls.some(c => c.base !== ref || c.mixed)) continue;
    const alts = [...new Set(calls.filter(c => c.base !== ref).map(c => c.base))];
    disagreements.push({
      position: p, reference: ref, calls, agreement: classify(calls, ref),
      change: alts.length ? `${ref}${p}${alts.join('/')}` : `${ref}${p} mixed peak`,
    });
  }

  // Insertions: after a position, every read spanning the join either inserts
  // something or nothing ('').
  const insertionSites = new Set(perRead.flatMap(r => [...r.inserted.keys()]));
  for (const p of insertionSites) {
    const calls: Call[] = [];
    for (const r of perRead) {
      const ins = r.inserted.get(p);
      const before = r.at.get(p);
      const after = r.at.get(p + 1);
      if (ins) calls.push({ read: r.name, base: ins.bases, quality: ins.quality, column: ins.column, reversed: r.reversed, mixed: false });
      else if (before && after) {
        // Spans the join without inserting: evidence for the reference, as
        // strong as the weaker of the two bases either side.
        const q = before.quality == null || after.quality == null ? null : Math.min(before.quality, after.quality);
        calls.push({ read: r.name, base: '', quality: q, column: before.column, reversed: r.reversed, mixed: false });
      }
    }
    const alts = [...new Set(calls.filter(c => c.base).map(c => c.base))];
    disagreements.push({
      position: p, reference: '', calls, agreement: classify(calls, ''),
      change: `${p}_${p + 1}ins${alts.join('/')}`,
    });
  }
  disagreements.sort((a, b) => a.position - b.position || a.reference.length - b.reference.length);

  let covered = 0, singleRead = 0, bothStrands = 0;
  const gaps: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (depth[i] > 0) covered++;
    if (depth[i] === 1) singleRead++;
    if (forward[i] && reverse[i]) bothStrands++;
    if (depth[i] === 0) {
      const last = gaps.at(-1);
      if (last && last.end === i) last.end = i + 1;
      else gaps.push({ start: i + 1, end: i + 1 });
    }
  }

  return { length: n, depth, spans, covered, singleRead, bothStrands, gaps, disagreements };
}

/**
 * The differences that stand in the way of calling the construct confirmed:
 * anything not explained as a read error. Single-read differences count only
 * when the call is clear; a weak call on its own is not evidence.
 */
export function unresolved(c: Coverage): Disagreement[] {
  return c.disagreements.filter(d =>
    d.agreement === 'confirmed' || d.agreement === 'contested'
    || (d.agreement === 'single' && d.calls.some(x => x.base !== d.reference && confident(x.quality))),
  );
}
