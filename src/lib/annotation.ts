import { revComp } from './alignment';
import { FEATURE_LIBRARY, type LibraryFeature } from './features.data';

/**
 * Recognising known parts in a sequence.
 *
 * Two things separate this from a string search. Real plasmids carry silent
 * variants of every common part -- a promoter picked up from a different vector
 * ten years ago differs at a handful of positions -- so matching has to tolerate
 * mismatch. And a part can appear more than once: a terminator either side of a
 * cassette, two copies of an origin in a shuttle vector. The previous detector
 * stopped at the first hit per strand, which meant the second copy of anything
 * was invisible.
 *
 * Scanning every offset for every part is O(n·m) and becomes unusable as the
 * library grows past a few dozen entries. Instead the target is indexed by
 * k-mer once, and each part is looked up by a seed taken from it. Verification
 * still compares the full length, so tolerance is unchanged -- only the number
 * of places worth checking falls.
 */

export interface Annotation {
  name: string;
  type: string;
  color: string;
  /** 1-indexed, inclusive. */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Fraction of positions matching the reference part. */
  identity: number;
}

export interface AnnotateOptions {
  /** Minimum fraction of matching bases. */
  minIdentity?: number;
  /** Treat the sequence as a circle, so a part spanning the origin is found. */
  circular?: boolean;
  /** Extra parts beyond the built-in library. */
  extra?: LibraryFeature[];
  /** Cap, so a repetitive sequence cannot produce thousands of rows. */
  limit?: number;
}

const SEED = 12;

/** Positions of every k-mer in the target, built once and reused by every part. */
function indexSeeds(seq: string, k: number): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i + k <= seq.length; i++) {
    const key = seq.slice(i, i + k);
    const at = idx.get(key);
    if (at) at.push(i);
    else idx.set(key, [i]);
  }
  return idx;
}

function identityAt(target: string, offset: number, part: string): number {
  let same = 0;
  for (let j = 0; j < part.length; j++) {
    if (target[offset + j] === part[j]) same++;
  }
  return same / part.length;
}

/**
 * Every place a library part matches, on either strand.
 *
 * Seeds are taken from several positions in the part rather than only its
 * start: a part whose first twelve bases carry a mismatch would otherwise be
 * missed entirely, which is exactly the variant case tolerance exists for.
 */
export function annotate(sequence: string, opts: AnnotateOptions = {}): Annotation[] {
  const { minIdentity = 0.8, circular = false, extra = [], limit = 500 } = opts;
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  if (!seq) return [];

  const library = [...FEATURE_LIBRARY, ...extra];
  // A circular target is searched as itself plus a wrap, so a part crossing the
  // origin is found once rather than not at all.
  const longest = library.reduce((m, f) => Math.max(m, f.sequence.length), 0);
  const pad = circular ? Math.min(longest - 1, seq.length - 1) : 0;
  const target = circular ? seq + seq.slice(0, pad) : seq;

  const index = indexSeeds(target, SEED);
  // Short parts are looked up in their own index; there are few of them.
  const shortIndex = library.some(f => f.sequence.length < SEED) ? indexSeeds(target, 10) : index;
  const out: Annotation[] = [];

  for (const feat of library) {
    const part = feat.sequence.toUpperCase().replace(/[^ACGT]/g, '');
    // A part shorter than the seed would never be looked up, so the seed
    // shrinks to fit rather than the part being dropped. Ten is the floor for
    // meaning rather than for the algorithm: below it, chance matches outnumber
    // real ones.
    if (part.length < 10) continue;
    const k = Math.min(SEED, part.length);

    for (const strand of [1, -1] as const) {
      const probe = strand === 1 ? part : revComp(part);
      const tried = new Set<number>();

      // Seeds spread across the part, so one mismatched region cannot hide it.
      const seedAt = [0, Math.floor((probe.length - k) / 2), probe.length - k]
        .filter((v, i, a) => v >= 0 && a.indexOf(v) === i);

      for (const s of seedAt) {
        const hits = (k === SEED ? index : shortIndex).get(probe.slice(s, s + k));
        if (!hits) continue;
        for (const h of hits) {
          const offset = h - s;
          if (offset < 0 || offset + probe.length > target.length) continue;
          if (tried.has(offset)) continue;
          tried.add(offset);

          const identity = identityAt(target, offset, probe);
          if (identity < minIdentity) continue;

          const start = (offset % seq.length) + 1;
          const end = start + probe.length - 1;
          out.push({
            name: feat.name,
            type: feat.type,
            color: feat.color,
            start,
            end: end > seq.length && !circular ? seq.length : end,
            strand,
            identity,
          });
        }
      }
    }
    if (out.length > limit * 4) break;
  }

  return resolve(out).slice(0, limit);
}

/**
 * Drop hits that say the same thing twice.
 *
 * The same part found from two seeds at nearly the same place is one feature,
 * and the better-matching copy is the one to keep. Different parts overlapping
 * are left alone: a tag inside a coding sequence is two true facts, and hiding
 * one of them would be a worse error than showing both.
 */
function resolve(hits: Annotation[]): Annotation[] {
  const sorted = [...hits].sort((a, b) =>
    b.identity - a.identity || (a.end - a.start) - (b.end - b.start));
  const kept: Annotation[] = [];
  for (const h of sorted) {
    // Strand is not part of the identity here. A site whose arms are inverted
    // repeats -- loxP and FRT both are -- matches itself on the other strand at
    // better than eighty per cent, and reporting one physical site twice with
    // opposite arrows says something false about the construct. The
    // better-scoring orientation wins, which is the one the sequence supports.
    const dup = kept.some(k =>
      k.name === h.name &&
      Math.abs(k.start - h.start) < Math.max(20, (h.end - h.start) * 0.5));
    if (!dup) kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}
