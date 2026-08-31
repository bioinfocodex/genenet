import { revComp } from './alignment';

/**
 * Assembling Sanger reads into a contig.
 *
 * Verification already works for one read against a reference. Real
 * verification arrives as six reads that have to be joined first, and the
 * reference may not exist at all -- a construct someone else made, or one whose
 * design file was lost.
 *
 * Two things about Sanger data shape this. The first fifteen or so bases and
 * the last few hundred are unreliable: the polymerase has not settled at the
 * start and the peaks have spread by the end, so an untrimmed read disagrees
 * with its neighbours exactly where it is least trustworthy. And reads come off
 * whichever primer was used, so half of them are reversed; an assembler that
 * only tries one orientation quietly drops them.
 *
 * Disagreements are reported rather than silently voted away. Two reads
 * agreeing on a base and one dissenting is a sequencing error; two against two
 * is a mixed population or a mixed-up tube, and that is worth stopping for.
 */

export interface Read {
  name: string;
  sequence: string;
  /** Phred scores, one per base, when the trace file carried them. */
  quality?: number[];
}

export interface TrimmedRead extends Read {
  /** Bases removed from each end. */
  trimmedStart: number;
  trimmedEnd: number;
}

export interface PlacedRead {
  name: string;
  /** 0-indexed offset of this read's first base within the contig. */
  offset: number;
  /** True when the read was reverse-complemented to fit. */
  flipped: boolean;
  sequence: string;
}

export interface Disagreement {
  /** 1-indexed position in the consensus. */
  position: number;
  /** How many reads call each base. */
  votes: Record<string, number>;
  /** The base the consensus took. */
  called: string;
  /** True when no base has a clear majority: worth a person looking. */
  contested: boolean;
}

export interface Contig {
  consensus: string;
  reads: PlacedRead[];
  /** Reads covering each consensus position. */
  coverage: number[];
  disagreements: Disagreement[];
  /** Positions covered by only one read, where an error cannot be caught. */
  singleCoverage: number;
}

export interface AssembleOptions {
  /** Shortest overlap that counts as a join. */
  minOverlap?: number;
  /** Fraction of the overlap that must match. */
  minIdentity?: number;
  /** Trim bases below this Phred score from each end. */
  qualityCutoff?: number;
}

/**
 * Cut back the unreliable ends.
 *
 * With quality scores this walks in from each end until a window of good bases
 * begins. Without them, the fallback is to trim leading and trailing ambiguity,
 * which is what a trace with no quality file still shows.
 */
export function trimRead(read: Read, cutoff = 20, window = 10): TrimmedRead {
  const seq = read.sequence.toUpperCase();
  const q = read.quality;

  let start = 0;
  let end = seq.length;

  if (q && q.length === seq.length) {
    // Advance until a whole window averages above the cutoff, rather than
    // stopping at the first good base: one lucky peak in a bad region is not
    // the start of usable sequence.
    const mean = (from: number) => {
      let sum = 0;
      const n = Math.min(window, seq.length - from);
      for (let i = 0; i < n; i++) sum += q[from + i];
      return n ? sum / n : 0;
    };
    while (start < seq.length - window && mean(start) < cutoff) start++;
    while (end > start + window && mean(end - window) < cutoff) end--;
    // The window says where the good region begins; it does not say that every
    // base up to there is good. A window straddling the boundary can average
    // above the cutoff while half its bases are still junk, so walk the last
    // few off one at a time.
    while (start < end && q[start] < cutoff) start++;
    while (end > start && q[end - 1] < cutoff) end--;
  } else {
    while (start < end && !'ACGT'.includes(seq[start])) start++;
    while (end > start && !'ACGT'.includes(seq[end - 1])) end--;
  }

  return {
    name: read.name,
    sequence: seq.slice(start, end),
    quality: q?.slice(start, end),
    trimmedStart: start,
    trimmedEnd: seq.length - end,
  };
}

export interface Overlap {
  /** Bases of `a`'s 3' end that overlap `b`'s 5' end. */
  length: number;
  identity: number;
}

/**
 * The best overlap between the end of `a` and the start of `b`.
 *
 * Mismatches are allowed, because two reads of the same DNA disagree at a few
 * positions and an exact-match requirement would refuse to join reads that
 * plainly belong together.
 */
export function findOverlap(
  a: string, b: string, minOverlap = 20, minIdentity = 0.9,
): Overlap | null {
  const max = Math.min(a.length, b.length);
  let best: Overlap | null = null;

  for (let n = max; n >= minOverlap; n--) {
    const tail = a.slice(a.length - n);
    const head = b.slice(0, n);
    let same = 0;
    for (let i = 0; i < n; i++) if (tail[i] === head[i]) same++;
    const identity = same / n;
    if (identity >= minIdentity) {
      // Longest first: the longest qualifying overlap is the real join.
      best = { length: n, identity };
      break;
    }
  }
  return best;
}

/**
 * Join reads into contigs.
 *
 * Greedy: repeatedly take the best remaining overlap and extend. That is enough
 * for the handful of reads a plasmid verification produces, and it is something
 * that can be read and checked, unlike a full overlap-layout-consensus graph.
 */
export function assembleReads(reads: Read[], opts: AssembleOptions = {}): {
  contigs: Contig[];
  unplaced: string[];
} {
  const { minOverlap = 20, minIdentity = 0.9, qualityCutoff = 20 } = opts;

  const trimmed = reads
    .map(r => trimRead(r, qualityCutoff))
    .filter(r => r.sequence.length >= minOverlap);
  if (trimmed.length === 0) return { contigs: [], unplaced: reads.map(r => r.name) };

  // Each read in both orientations; the layout picks whichever fits.
  type Candidate = { name: string; seq: string; flipped: boolean };
  const pool: Candidate[] = trimmed.map(r => ({ name: r.name, seq: r.sequence, flipped: false }));

  const used = new Set<string>();
  const contigs: Contig[] = [];

  while (used.size < pool.length) {
    const seed = pool.find(p => !used.has(p.name));
    if (!seed) break;
    used.add(seed.name);

    let placed: PlacedRead[] = [{ name: seed.name, offset: 0, flipped: false, sequence: seed.seq }];
    let layout = seed.seq;

    let grew = true;
    while (grew) {
      grew = false;
      for (const cand of trimmed) {
        if (used.has(cand.name)) continue;
        for (const flipped of [false, true]) {
          const seq = flipped ? revComp(cand.sequence) : cand.sequence;

          // Extending to the right: the layout's tail meets this read's head.
          const right = findOverlap(layout, seq, minOverlap, minIdentity);
          if (right) {
            placed.push({ name: cand.name, offset: layout.length - right.length, flipped, sequence: seq });
            layout = layout + seq.slice(right.length);
            used.add(cand.name);
            grew = true;
            break;
          }
          // Extending to the left: this read's tail meets the layout's head.
          const left = findOverlap(seq, layout, minOverlap, minIdentity);
          if (left) {
            const shift = seq.length - left.length;
            placed = placed.map(p => ({ ...p, offset: p.offset + shift }));
            placed.push({ name: cand.name, offset: 0, flipped, sequence: seq });
            layout = seq.slice(0, shift) + layout;
            used.add(cand.name);
            grew = true;
            break;
          }
        }
        if (grew) break;
      }
    }

    contigs.push(callConsensus(placed, layout.length));
  }

  // A read that joined nothing is its own contig of one; that is not a failure,
  // but it is worth being able to see.
  const unplaced = reads
    .filter(r => !trimmed.some(t => t.name === r.name))
    .map(r => r.name);

  return { contigs: contigs.sort((a, b) => b.consensus.length - a.consensus.length), unplaced };
}

/** Majority vote per column, with the losers recorded. */
function callConsensus(placed: PlacedRead[], length: number): Contig {
  const consensus: string[] = [];
  const coverage: number[] = [];
  const disagreements: Disagreement[] = [];

  for (let i = 0; i < length; i++) {
    const votes: Record<string, number> = {};
    let depth = 0;
    for (const p of placed) {
      const k = i - p.offset;
      if (k < 0 || k >= p.sequence.length) continue;
      const base = p.sequence[k];
      if (!'ACGT'.includes(base)) continue;
      votes[base] = (votes[base] ?? 0) + 1;
      depth++;
    }
    coverage.push(depth);

    if (depth === 0) { consensus.push('N'); continue; }
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const [called, top] = ranked[0];
    consensus.push(called);

    if (ranked.length > 1) {
      const runnerUp = ranked[1][1];
      disagreements.push({
        position: i + 1,
        votes,
        called,
        // One read disagreeing is one read: Sanger miscalls a base here and
        // there, and a lone dissenter is the expected shape of that. Two reads
        // agreeing on a different base is not an error rate, it is evidence --
        // a mixed population, or two different plasmids in one tube. So is a
        // tie. Those are the cases worth opening the trace for.
        contested: top <= runnerUp || runnerUp >= 2,
      });
    }
  }

  return {
    consensus: consensus.join(''),
    reads: placed.sort((a, b) => a.offset - b.offset),
    coverage,
    disagreements,
    singleCoverage: coverage.filter(c => c === 1).length,
  };
}
