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
  /**
   * Distance to the nearest end of a read covering this position.
   *
   * The single most useful thing to know about a disagreement. Untrimmed reads
   * carry miscalls in their first and last few dozen bases, so a conflict there
   * is a trimming artefact; the same conflict in the middle of every read
   * covering it is evidence about the DNA.
   */
  fromReadEnd: number;
}

/**
 * How close to a read's end still counts as its unreliable zone.
 *
 * Sanger reads are conventionally untrustworthy for the first fifteen to twenty
 * bases and again once the peaks spread. Thirty is a deliberately generous
 * reading of that, because calling a real conflict an artefact is the worse
 * mistake of the two.
 */
export const END_ZONE = 30;

export interface Contig {
  consensus: string;
  reads: PlacedRead[];
  /** Reads covering each consensus position. */
  coverage: number[];
  disagreements: Disagreement[];
  /** Positions covered by only one read, where an error cannot be caught. */
  singleCoverage: number;
  /**
   * Contested positions in the interior of every read covering them.
   *
   * Separated from the total because these are the ones that mean something. A
   * contig whose only conflicts sit in the untrimmed ends is a trimming
   * problem; one with conflicts in the middle may be two different plasmids.
   */
  interiorConflicts: Disagreement[];
  /** Contested positions inside a read's unreliable end zone. */
  endZoneConflicts: number;
}

export interface AssembleOptions {
  /** Shortest overlap that counts as a join. */
  minOverlap?: number;
  /** Fraction of the overlap that must match. */
  minIdentity?: number;
  /** Trim bases below this Phred score from each end. */
  qualityCutoff?: number;
  /**
   * Untrimmed bases tolerated on the inside of a join.
   *
   * Reads that arrive without quality scores keep whatever miscalls sit at
   * their ends; this is how much of that a join may carry before the reads are
   * treated as unrelated.
   */
  maxOverhang?: number;
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
  /** Length of the shared region. */
  length: number;
  identity: number;
  /** Where the shared region starts in `a`. */
  aStart: number;
  /** Where it starts in `b`. */
  bStart: number;
  /** Offset of `b` relative to `a`: negative means `b` starts to the left. */
  offset: number;
}

/**
 * Longest run of bases the two reads share, wherever it sits.
 *
 * The obvious implementation compares a's suffix against b's prefix, and it is
 * wrong for the input this actually gets. A read that has not been quality-
 * trimmed carries miscalled bases at both ends — and they are miscalled A, C, G
 * and T, not N, so nothing short of quality scores identifies them. The shared
 * region therefore ends a few dozen bases before a's end and starts a few dozen
 * bases into b, and a strict suffix-prefix test finds nothing at all. Four reads
 * tiling a plasmid come back as four separate contigs, which looks like reads
 * from different templates rather than like a trimming problem.
 *
 * So: slide b along a, and at each offset take the best-scoring local segment
 * (Kadane, +1 per match and -3 per mismatch, which lets a run absorb the odd
 * miscall without letting it absorb unrelated sequence). A join is accepted when
 * the segment is long enough, agrees well enough, and the unmatched tails on the
 * *inside* of the join are short — that last condition is what makes it a
 * dovetail rather than two reads that happen to share a stretch in the middle.
 */
export function findOverlap(
  a: string, b: string, minOverlap = 20, minIdentity = 0.9, maxOverhang = 60,
): Overlap | null {
  let best: Overlap | null = null;

  for (let offset = -(b.length - 1); offset < a.length; offset++) {
    const from = Math.max(0, offset);
    const to = Math.min(a.length, offset + b.length);
    if (to - from < minOverlap) continue;

    // Kadane over the aligned span: the best contiguous stretch of agreement.
    let score = 0, bestScore = 0, runStart = from, bestFrom = -1, bestTo = -1;
    for (let ai = from; ai < to; ai++) {
      const bi = ai - offset;
      const step = a[ai] === b[bi] ? 1 : -3;
      if (score <= 0) { score = step; runStart = ai; }
      else score += step;
      if (score > bestScore) { bestScore = score; bestFrom = runStart; bestTo = ai; }
    }
    if (bestFrom < 0) continue;

    const length = bestTo - bestFrom + 1;
    if (length < minOverlap) continue;

    let same = 0;
    for (let ai = bestFrom; ai <= bestTo; ai++) if (a[ai] === b[ai - offset]) same++;
    const identity = same / length;
    if (identity < minIdentity) continue;

    // The four ends around the join. For a genuine dovetail one read hangs off
    // to the left and the other to the right; the two ends facing each other
    // across the join are the ones that have to be short.
    const aHead = bestFrom;
    const aTail = a.length - 1 - bestTo;
    const bHead = bestFrom - offset;
    const bTail = b.length - 1 - (bestTo - offset);

    const bRight = aTail <= maxOverhang && bHead <= maxOverhang;
    const bLeft = aHead <= maxOverhang && bTail <= maxOverhang;
    if (!bRight && !bLeft) continue;

    if (!best || length > best.length) {
      best = { length, identity, aStart: bestFrom, bStart: bestFrom - offset, offset };
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
  const { minOverlap = 20, minIdentity = 0.9, qualityCutoff = 20, maxOverhang = 60 } = opts;

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

    /**
     * The layout as one string, for the next read to be matched against.
     *
     * Rebuilt from the placed reads rather than accumulated by concatenation.
     * A read no longer has to abut the end of the layout — it can sit anywhere,
     * including hanging off both sides — and appending its unmatched remainder
     * would put those bases in the wrong place.
     */
    const rebuild = (): string => callConsensus(placed, spanOf(placed)).consensus;
    let layout = rebuild();

    let grew = true;
    while (grew) {
      grew = false;
      for (const cand of trimmed) {
        if (used.has(cand.name)) continue;
        for (const flipped of [false, true]) {
          const seq = flipped ? revComp(cand.sequence) : cand.sequence;
          const ov = findOverlap(layout, seq, minOverlap, minIdentity, maxOverhang);
          if (!ov) continue;

          // The read sits where the shared region says it does, which may be
          // left of everything placed so far.
          const offset = ov.aStart - ov.bStart;
          if (offset < 0) {
            placed = placed.map(p => ({ ...p, offset: p.offset - offset }));
            placed.push({ name: cand.name, offset: 0, flipped, sequence: seq });
          } else {
            placed.push({ name: cand.name, offset, flipped, sequence: seq });
          }
          used.add(cand.name);
          layout = rebuild();
          grew = true;
          break;
        }
        if (grew) break;
      }
    }

    contigs.push(callConsensus(placed, spanOf(placed)));
  }

  // A read that joined nothing is its own contig of one; that is not a failure,
  // but it is worth being able to see.
  const unplaced = reads
    .filter(r => !trimmed.some(t => t.name === r.name))
    .map(r => r.name);

  return { contigs: contigs.sort((a, b) => b.consensus.length - a.consensus.length), unplaced };
}

/** How wide the laid-out reads reach, from the leftmost start to the rightmost end. */
function spanOf(placed: PlacedRead[]): number {
  return Math.max(...placed.map(p => p.offset + p.sequence.length));
}

/** Majority vote per column, with the losers recorded. */
function callConsensus(placed: PlacedRead[], length: number): Contig {
  const consensus: string[] = [];
  const coverage: number[] = [];
  const disagreements: Disagreement[] = [];

  for (let i = 0; i < length; i++) {
    const votes: Record<string, number> = {};
    let depth = 0;
    let fromReadEnd = Infinity;
    for (const p of placed) {
      const k = i - p.offset;
      if (k < 0 || k >= p.sequence.length) continue;
      // How far into this read the position sits, from whichever end is nearer.
      fromReadEnd = Math.min(fromReadEnd, k, p.sequence.length - 1 - k);
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
        fromReadEnd: Number.isFinite(fromReadEnd) ? fromReadEnd : 0,
        // One read disagreeing is one read: Sanger miscalls a base here and
        // there, and a lone dissenter is the expected shape of that. Two reads
        // agreeing on a different base is not an error rate, it is evidence --
        // a mixed population, or two different plasmids in one tube. So is a
        // tie. Those are the cases worth opening the trace for.
        contested: top <= runnerUp || runnerUp >= 2,
      });
    }
  }

  const contested = disagreements.filter(d => d.contested);
  return {
    consensus: consensus.join(''),
    reads: placed.sort((a, b) => a.offset - b.offset),
    coverage,
    disagreements,
    singleCoverage: coverage.filter(c => c === 1).length,
    interiorConflicts: contested.filter(d => d.fromReadEnd >= END_ZONE),
    endZoneConflicts: contested.filter(d => d.fromReadEnd < END_ZONE).length,
  };
}
