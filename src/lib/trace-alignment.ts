import { alignPair, revComp } from './alignment';
import { trimRead } from './contig';

/**
 * A sequencing trace laid against the construct it should match.
 *
 * verifyRead answers "where does this read differ from the reference", but on
 * basecalls alone, and basecalls are an opinion. A mismatch at Q12 in a run of
 * small peaks is the basecaller guessing; a mismatch at Q50 under one clean
 * peak is a mutation. The difference is in the trace, which is why every
 * sequence-verification tool shows it -- and why a list of differences without
 * it gets every questionable call re-sequenced "to be sure".
 *
 * So this keeps each aligned column tied to its basecall, its quality, and its
 * place in the chromatogram, and grades each difference by the evidence under
 * it. It also looks for what basecalls hide completely: two overlapping peaks
 * at one position, which is a mixed colony or a heterozygous site, and which
 * the basecaller reports as one confident base.
 */

/** What verification needs from a parsed .ab1 (see formats/ab1). */
export interface TraceRead {
  name: string;
  sequence: string;
  quality: number[];
  /** Order of the four channels in `traces`, e.g. "GATC". */
  baseOrder: string;
  traces: number[][];
  peakLocations: number[];
}

type Base = 'A' | 'C' | 'G' | 'T';
const BASES: Base[] = ['A', 'C', 'G', 'T'];
const PARTNER: Record<Base, Base> = { A: 'T', C: 'G', G: 'C', T: 'A' };

/** A trace turned to read along the reference's top strand. */
export interface OrientedTrace {
  sequence: string;
  quality: number[];
  channels: Record<Base, number[]>;
  /** Trace index of each basecall's peak, ascending. */
  peaks: number[];
  /** Number of trace points. */
  length: number;
}

/**
 * A reverse read is the bottom strand: reverse the bases and complement them,
 * and the trace with them -- mirror it in x and swap each channel for its
 * partner, so a T peak drawn under the reference is the A the read saw.
 */
export function orientTrace(read: TraceRead, reversed: boolean): OrientedTrace {
  const length = Math.max(0, ...read.traces.map(t => t.length));
  const byBase = {} as Record<Base, number[]>;
  for (const b of BASES) {
    const idx = read.baseOrder.toUpperCase().indexOf(b);
    byBase[b] = idx >= 0 && read.traces[idx] ? read.traces[idx] : [];
  }
  const quality = read.quality.length === read.sequence.length ? read.quality : [];
  // Peak locations that do not line up with the basecalls cannot be drawn
  // under them; drop them rather than draw every peak under the wrong base.
  const peaks = read.peakLocations.length === read.sequence.length ? read.peakLocations : [];

  if (!reversed) {
    return { sequence: read.sequence.toUpperCase(), quality, channels: byBase, peaks, length };
  }

  const channels = {} as Record<Base, number[]>;
  for (const b of BASES) channels[b] = [...byBase[PARTNER[b]]].reverse();
  return {
    sequence: revComp(read.sequence),
    quality: [...quality].reverse(),
    channels,
    peaks: peaks.map(p => length - 1 - p).reverse(),
    length,
  };
}

export type ColumnKind = 'match' | 'mismatch' | 'insertion' | 'deletion';

export interface TraceColumn {
  kind: ColumnKind;
  /** 1-based reference position; for an insertion, the base before it. */
  refPos: number;
  /** '-' in an insertion column. */
  ref: string;
  /** '-' in a deletion column. */
  read: string;
  /** Index into the oriented read; null in a deletion column. */
  readIndex: number | null;
  quality: number | null;
  /** Height of the second-tallest channel over the tallest, at this peak. */
  secondaryRatio: number | null;
}

export type Confidence = 'high' | 'low';

export interface TraceDiscrepancy {
  /** Index into `columns`, for scrolling the viewer to it. */
  column: number;
  position: number;
  kind: ColumnKind | 'mixed';
  reference: string;
  read: string;
  quality: number | null;
  confidence: Confidence;
  secondaryRatio: number | null;
}

export interface TraceVerification {
  name: string;
  reversed: boolean;
  identity: number;
  /** 1-based; on a circle the span can run through the origin, so end < start. */
  coverageStart: number;
  coverageEnd: number;
  /** Oriented-read coordinates of the stretch kept after quality trimming. */
  usableStart: number;
  usableEnd: number;
  meanQuality: number | null;
  columns: TraceColumn[];
  discrepancies: TraceDiscrepancy[];
  trace: OrientedTrace;
  /**
   * 'confirmed' when nothing well supported differs, 'differs' when something
   * does, and 'unusable' when too little of the read survived trimming to say.
   */
  verdict: 'confirmed' | 'differs' | 'unusable';
}

export interface TraceOptions {
  /** Trim ends below this Phred score before aligning. */
  trimCutoff?: number;
  /** A difference at or above this quality is treated as real. */
  confidentQuality?: number;
  /** Secondary peak at this fraction of the primary or more reads as mixed. */
  mixedRatio?: number;
  /** Fewer usable bases than this and the read is not judged. */
  minUsable?: number;
}

const DEFAULTS: Required<TraceOptions> = {
  trimCutoff: 20,
  confidentQuality: 30,
  mixedRatio: 0.35,
  minUsable: 50,
};

function secondaryRatio(trace: OrientedTrace, i: number): number | null {
  const p = trace.peaks[i];
  if (p === undefined) return null;
  const heights = BASES.map(b => trace.channels[b][p] ?? 0).sort((x, y) => y - x);
  return heights[0] > 0 ? heights[1] / heights[0] : null;
}

/**
 * Align a trace to a reference and grade what differs.
 *
 * The read is quality-trimmed first, because the ragged first and last fifty
 * bases of any Sanger run are where nearly every spurious difference lives.
 * On a circular reference the read may run through the origin, so the
 * reference is extended by the read's length before aligning and positions are
 * folded back afterwards.
 */
export function verifyTrace(
  reference: string,
  circular: boolean,
  read: TraceRead,
  options: TraceOptions = {},
): TraceVerification {
  const o = { ...DEFAULTS, ...options };
  const ref = reference.toUpperCase().replace(/[^A-Z]/g, '');
  const n = ref.length;

  const quality = read.quality.length === read.sequence.length ? read.quality : undefined;
  const trimmed = trimRead({ name: read.name, sequence: read.sequence, quality }, o.trimCutoff);
  const len = read.sequence.length;

  const empty = (reversed: boolean): TraceVerification => ({
    name: read.name, reversed, identity: 0, coverageStart: 0, coverageEnd: 0,
    usableStart: 0, usableEnd: 0, meanQuality: null, columns: [], discrepancies: [],
    trace: orientTrace(read, reversed), verdict: 'unusable',
  });
  if (!n || trimmed.sequence.length < o.minUsable) return empty(false);

  const target = circular ? ref + ref.slice(0, Math.min(n, trimmed.sequence.length)) : ref;
  const settings = { mode: 'global' as const, freeEndGaps: true };
  const fwd = alignPair(target, trimmed.sequence, settings);
  const rev = alignPair(target, revComp(trimmed.sequence), settings);
  const reversed = rev.score > fwd.score;
  const best = reversed ? rev : fwd;
  const trace = orientTrace(read, reversed);

  // Where the usable stretch sits in the oriented read.
  const usableStart = reversed ? trimmed.trimmedEnd : trimmed.trimmedStart;
  const usableEnd = len - (reversed ? trimmed.trimmedStart : trimmed.trimmedEnd);

  const columns: TraceColumn[] = [];
  let refIdx = best.aStart;               // 0-based in `target`
  let readIdx = usableStart + best.bStart; // 0-based in the oriented read
  const fold = (i: number) => (i % n) + 1;

  for (let k = 0; k < best.alignedA.length; k++) {
    const r = best.alignedA[k];
    const q = best.alignedB[k];
    if (r === '-') {
      columns.push({
        kind: 'insertion', refPos: fold(Math.max(refIdx - 1, 0)), ref: '-', read: q, readIndex: readIdx,
        quality: trace.quality[readIdx] ?? null, secondaryRatio: secondaryRatio(trace, readIdx),
      });
      readIdx++;
    } else if (q === '-') {
      columns.push({ kind: 'deletion', refPos: fold(refIdx), ref: r, read: '-', readIndex: null, quality: null, secondaryRatio: null });
      refIdx++;
    } else {
      columns.push({
        kind: r === q ? 'match' : 'mismatch', refPos: fold(refIdx), ref: r, read: q, readIndex: readIdx,
        quality: trace.quality[readIdx] ?? null, secondaryRatio: secondaryRatio(trace, readIdx),
      });
      refIdx++;
      readIdx++;
    }
  }

  // A deletion has no base of its own, so its evidence is the read either side.
  const flankingQuality = (c: number): number | null => {
    const near = [columns[c - 1], columns[c + 1]].map(x => x?.quality).filter((x): x is number => x != null);
    return near.length ? Math.min(...near) : null;
  };

  const discrepancies: TraceDiscrepancy[] = [];
  columns.forEach((col, c) => {
    const q = col.kind === 'deletion' ? flankingQuality(c) : col.quality;
    if (col.kind !== 'match') {
      discrepancies.push({
        column: c, position: col.refPos, kind: col.kind, reference: col.ref, read: col.read,
        quality: q, secondaryRatio: col.secondaryRatio,
        // Without quality scores there is nothing to grade on, and calling an
        // ungraded difference "low confidence" would invite ignoring it.
        confidence: q == null || q >= o.confidentQuality ? 'high' : 'low',
      });
    } else if (col.secondaryRatio != null && col.secondaryRatio >= o.mixedRatio && (col.quality ?? 0) >= o.trimCutoff) {
      discrepancies.push({
        column: c, position: col.refPos, kind: 'mixed', reference: col.ref, read: col.read,
        quality: col.quality, secondaryRatio: col.secondaryRatio,
        confidence: col.secondaryRatio >= 0.5 ? 'high' : 'low',
      });
    }
  });

  const used = trace.quality.slice(usableStart, usableEnd);
  const aligned = columns.filter(c => c.kind !== 'insertion');
  return {
    name: read.name,
    reversed,
    identity: best.identity,
    coverageStart: aligned[0]?.refPos ?? 0,
    coverageEnd: aligned.at(-1)?.refPos ?? 0,
    usableStart,
    usableEnd,
    meanQuality: used.length ? Math.round(used.reduce((a, b) => a + b, 0) / used.length) : null,
    columns,
    discrepancies,
    trace,
    verdict: discrepancies.some(d => d.confidence === 'high') ? 'differs' : 'confirmed',
  };
}

/**
 * The slice of trace belonging to one basecall: from halfway to the previous
 * peak to halfway to the next. Returned as trace indices, half-open.
 */
export function peakWindow(trace: OrientedTrace, i: number): [number, number] | null {
  const p = trace.peaks;
  if (p[i] === undefined) return null;
  const left = i > 0 ? Math.ceil((p[i - 1] + p[i]) / 2) : Math.max(0, p[i] - Math.round(((p[i + 1] ?? p[i] + 12) - p[i]) / 2));
  const right = i < p.length - 1 ? Math.ceil((p[i] + p[i + 1]) / 2) : Math.min(trace.length, p[i] + Math.round((p[i] - (p[i - 1] ?? p[i] - 12)) / 2));
  return right > left ? [left, right] : null;
}
