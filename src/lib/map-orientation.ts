/**
 * Turning a map round, without turning the record round.
 *
 * Two presentation choices that SnapGene offers and we did not:
 *
 *   Origin. A plasmid map's twelve o'clock is a choice, and people rotate one
 *     so the promoter is at the top before it goes in a paper.
 *   Flip. Checking an insert that went in backwards means reading the map
 *     backwards, unless the map can be read the other way round.
 *
 * Both are views, not edits. The bases in the database do not move, nothing
 * is renumbered, and no signature is invalidated -- which is the whole reason
 * this is a transform module rather than two buttons that rewrite the
 * sequence.
 *
 * That choice has a price, and it is paid here: everything the maps draw is
 * positioned from base 1, so a rotated or flipped map is drawing coordinates
 * that are not the record's. A click on it comes back in those coordinates
 * and has to be turned back before anything else sees it. So every transform
 * has an inverse, and the pair is tested together -- round-tripping every
 * position of a molecule, because an off-by-one here selects the wrong base
 * and says nothing.
 */

import type { SequenceFeature } from './features';
import { revComp } from './sequence-search';

export interface Orientation {
  /**
   * The base drawn at twelve o'clock, 1-based. 1 is the record's own origin.
   * Meaningless for a linear molecule, and ignored there.
   */
  origin: number;
  /** Draw the reverse complement, with the features following. */
  flipped: boolean;
}

export const UNROTATED: Orientation = { origin: 1, flipped: false };

export const isTurned = (o: Orientation) => o.origin !== 1 || o.flipped;

/** A position as the turned map draws it. 1-based in, 1-based out. */
export function toDisplay(pos: number, len: number, o: Orientation): number {
  if (len <= 0) return pos;
  // Rotate first: the origin is a position in the record's own numbering.
  let p = ((pos - o.origin) % len + len) % len + 1;
  if (o.flipped) p = len - p + 1;
  return p;
}

/** The same journey backwards, for a click on a turned map. */
export function fromDisplay(pos: number, len: number, o: Orientation): number {
  if (len <= 0) return pos;
  let p = pos;
  if (o.flipped) p = len - p + 1;
  return ((p - 1 + o.origin - 1) % len + len) % len + 1;
}

/** The bases as the turned map reads them. */
export function orientSequence(sequence: string, o: Orientation): string {
  const len = sequence.length;
  if (len === 0) return sequence;
  const rotated = o.origin === 1 ? sequence : sequence.slice(o.origin - 1) + sequence.slice(0, o.origin - 1);
  return o.flipped ? revComp(rotated) : rotated;
}

/**
 * A feature in the turned map's coordinates.
 *
 * A flip swaps the ends as well as moving them -- what was the start of a
 * forward feature is the end of the same feature read the other way -- and
 * reverses its strand, because a promoter pointing clockwise points
 * anticlockwise once the molecule is turned over. Getting the strand wrong
 * here would draw every arrow backwards, which is precisely the question
 * somebody flips a map to answer.
 */
export function orientFeature(f: SequenceFeature, len: number, o: Orientation): SequenceFeature {
  const a = toDisplay(f.start, len, o);
  const b = toDisplay(f.end, len, o);
  const out: SequenceFeature = {
    ...f,
    start: o.flipped ? b : a,
    end: o.flipped ? a : b,
    strand: (o.flipped ? -f.strand : f.strand) as 1 | -1,
  };
  if (f.segments?.length) {
    const moved = f.segments.map(s => {
      const sa = toDisplay(s.start, len, o);
      const sb = toDisplay(s.end, len, o);
      return o.flipped ? { start: sb, end: sa } : { start: sa, end: sb };
    });
    // Exons are drawn in the order they are read, which the flip reverses.
    out.segments = o.flipped ? moved.reverse() : moved;
  }
  return out;
}

/**
 * Any plain start/end span -- a primer, a reading frame -- turned with the map.
 *
 * The ends swap on a flip for the same reason a feature's do: what was the
 * start read one way is the end read the other.
 */
export function orientSpan<T extends { start: number; end: number }>(
  span: T, len: number, o: Orientation,
): T {
  const a = toDisplay(span.start, len, o);
  const b = toDisplay(span.end, len, o);
  return { ...span, start: o.flipped ? b : a, end: o.flipped ? a : b };
}

/**
 * A restriction site turned with the map.
 *
 * The subtle part is the pair of cuts. An enzyme leaving a 5' overhang cuts
 * the top strand before the bottom one; turn the molecule over and the
 * strand that was on top is underneath, so the two cuts swap as well as
 * move. Moving them without swapping would draw every overhang the wrong way
 * round -- and an overhang drawn the wrong way round is a cloning plan that
 * does not anneal.
 */
export function orientSite<T extends {
  cutPos: number; cutBottom: number; recognitionStart: number; recognitionLen: number;
}>(site: T, len: number, o: Orientation): T {
  if (!o.flipped) {
    return {
      ...site,
      cutPos: toDisplay(site.cutPos, len, o),
      cutBottom: toDisplay(site.cutBottom, len, o),
      recognitionStart: toDisplay(site.recognitionStart, len, o),
    };
  }
  /*
   * Flipped, the recognition sequence is read from what was its far end, and
   * the two cuts change places.
   */
  const farEnd = site.recognitionStart + site.recognitionLen - 1;
  return {
    ...site,
    cutPos: toDisplay(site.cutBottom, len, o),
    cutBottom: toDisplay(site.cutPos, len, o),
    recognitionStart: toDisplay(farEnd, len, o),
  };
}

/**
 * Where to put the origin so that a chosen base sits at the top.
 *
 * Takes the base somebody clicked, which is in record coordinates, and is
 * the function the "set origin here" command is made of.
 */
export function originFor(base: number, len: number): number {
  if (len <= 0) return 1;
  return ((base - 1) % len + len) % len + 1;
}

/** How the current orientation should be described, for a label. */
export function describe(o: Orientation): string | null {
  if (!isTurned(o)) return null;
  const bits: string[] = [];
  if (o.origin !== 1) bits.push(`origin at ${o.origin.toLocaleString()}`);
  if (o.flipped) bits.push('flipped');
  return bits.join(', ');
}
