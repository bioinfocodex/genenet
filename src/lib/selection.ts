/**
 * What can be done with a selected range.
 *
 * Copying it as the other strand, reading it as protein, or taking it out as
 * a record of its own. All three were things somebody had to do by hand:
 * copy the bases, paste them somewhere, reverse them in their head or in
 * another tool, and -- for the extraction -- re-annotate the result.
 *
 * The awkward part throughout is a range that crosses the origin of a
 * circular molecule, where `end` is smaller than `start`. It is a real
 * selection on a real plasmid and every function here has to mean something
 * sensible for it.
 */

import type { SequenceFeature } from './features';
import { CODON_TABLE } from './simulation';
import { AA3 } from './molbuilder-logic';
import { revComp } from './sequence-search';

/** The bases of a range, following it round the origin where it wraps. */
export function sliceRange(sequence: string, start: number, end: number): string {
  const len = sequence.length;
  if (len === 0) return '';
  const from = Math.max(1, Math.min(len, start));
  const to = Math.max(1, Math.min(len, end));
  if (to >= from) return sequence.slice(from - 1, to);
  // Wrapped: the tail, then back round to the head.
  return sequence.slice(from - 1) + sequence.slice(0, to);
}

/** How many bases a range covers, wrapping included. */
export function rangeLength(start: number, end: number, seqLength: number): number {
  return end >= start ? end - start + 1 : seqLength - start + 1 + end;
}

export type StrandForm = 'top' | 'bottom-5to3' | 'bottom-3to5';

/**
 * A range as one of the forms worth copying.
 *
 * The two bottom-strand forms are not the same string and the difference is
 * the thing people get wrong by hand. 5'->3' is the reverse complement --
 * the strand read the way a strand is read, and what goes in an order form.
 * 3'->5' is the complement without reversing, which is the strand written
 * underneath the top one, the way it appears in the sequence view.
 */
export function asStrand(bases: string, form: StrandForm): string {
  const seq = bases.toUpperCase();
  if (form === 'top') return seq;
  if (form === 'bottom-5to3') return revComp(seq);
  // Complement in place: the bottom strand as it is drawn, left to right.
  return revComp(seq).split('').reverse().join('');
}

export type AminoForm = 'one' | 'three';

/**
 * A range read as protein.
 *
 * Translated from the first base of the range, because that is what a
 * selection means -- somebody who wanted a different frame would have
 * selected from a different base. Trailing bases that do not fill a codon
 * are dropped rather than guessed at, and the count of them is returned so
 * the caller can say so rather than silently rounding.
 */
export function asAminoAcids(
  bases: string,
  form: AminoForm = 'one',
): { protein: string; leftover: number } {
  const seq = bases.toUpperCase().replace(/[^A-Z]/g, '');
  const leftover = seq.length % 3;
  const codons = leftover === 0 ? seq : seq.slice(0, seq.length - leftover);
  /*
   * Translated here rather than through translateDNA, which drops stop
   * codons from its output. That is right for the ORF scan and wrong for
   * this: a premature stop that silently disappeared would make a broken
   * construct read as a clean one. A stop in a selected range is
   * information, and it is shown.
   */
  let one = '';
  for (let i = 0; i + 2 < codons.length; i += 3) {
    one += CODON_TABLE[codons.slice(i, i + 3)] ?? 'X';
  }
  if (form === 'one') return { protein: one, leftover };
  return {
    protein: one.split('').map(a => AA3[a] ?? 'Xaa').join('-'),
    leftover,
  };
}

// ─── Taking a region out as its own record ───────────────────────────────────

export interface ExtractOptions {
  /** Keep the positions the features had, or restart the region at 1. */
  renumber: boolean;
  /** Features only partly inside are cut at the boundary rather than dropped. */
  clipPartial?: boolean;
}

export interface Extracted {
  sequence: string;
  features: SequenceFeature[];
}

/**
 * The features that belong to a region, moved to its coordinates.
 *
 * A feature wholly inside comes along. One that straddles the boundary is
 * cut at it and marked, because dropping it loses the fact that the region
 * is inside a CDS, and keeping it whole would claim the new record contains
 * bases it does not.
 *
 * Spliced features lose their segments when clipped: a join() whose exons
 * have been cut is no longer the thing the join described, and carrying the
 * old blocks forward would place introns where there are none.
 */
export function clipFeatures(
  features: SequenceFeature[],
  start: number,
  end: number,
  seqLength: number,
  opts: ExtractOptions,
): SequenceFeature[] {
  const wraps = end < start;
  const length = rangeLength(start, end, seqLength);

  /** Where a base sits in the extracted region, 1-based, or null if outside. */
  const place = (pos: number): number | null => {
    if (!wraps) return pos >= start && pos <= end ? pos - start + 1 : null;
    if (pos >= start) return pos - start + 1;
    if (pos <= end) return seqLength - start + 1 + pos;
    return null;
  };

  const out: SequenceFeature[] = [];
  for (const f of features) {
    // A feature that itself wraps is handled by its own ends, which is
    // enough for the containment test below.
    const a = place(f.start);
    const b = place(f.end);
    if (a === null && b === null) continue;

    const whole = a !== null && b !== null && b >= a;
    if (!whole && opts.clipPartial === false) continue;

    const from = a ?? 1;
    const to = b !== null && b >= from ? b : length;
    if (to < from) continue;

    const clipped = !whole;
    const copy: SequenceFeature = {
      ...f,
      start: opts.renumber ? from : f.start,
      end: opts.renumber ? to : (clipped ? Math.min(f.end, f.start + (to - from)) : f.end),
      name: clipped ? `${f.name} (partial)` : f.name,
    };
    // A join() whose exons have been cut no longer describes this molecule.
    if (clipped || opts.renumber) delete copy.segments;
    out.push(copy);
  }
  return out.sort((x, y) => x.start - y.start);
}

/** A region of a sequence as a record in its own right. */
export function extractRegion(
  sequence: string,
  features: SequenceFeature[],
  start: number,
  end: number,
  opts: ExtractOptions,
): Extracted {
  return {
    sequence: sliceRange(sequence, start, end),
    features: clipFeatures(features, start, end, sequence.length, opts),
  };
}

/**
 * A name for the new record that says where it came from.
 *
 * The coordinates are in it because somebody will make three of these from
 * one plasmid in an afternoon, and "m4 fragment" three times is a filing
 * problem they will have to solve later.
 */
export function extractedName(parent: string, start: number, end: number): string {
  return `${parent} ${start}-${end}`;
}
