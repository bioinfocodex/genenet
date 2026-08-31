/**
 * Describing a change to a sequence.
 *
 * The generic history formatter truncates a value at 140 characters, which for
 * a three-kilobase plasmid means the entry reads "ATGGCG…" before and
 * "ATGGCG…" after: a change is recorded, and nothing about it is legible.
 *
 * What a person needs is where it changed and by how much. This finds the first
 * and last positions that differ, which bounds the edit without aligning
 * anything -- an alignment would be more precise about an internal indel and far
 * too slow to run on every history entry, and the bounds are enough to answer
 * "is this the edit I remember making?"
 */

export interface SequenceChange {
  before: number;
  after: number;
  /** Signed change in length. */
  delta: number;
  /** 1-indexed position of the first differing base, or null when only the length changed at the end. */
  firstDiff: number | null;
  /** 1-indexed position, counted from the end, where they stop differing. */
  lastDiff: number | null;
  /** A short window around the first difference, for recognition rather than analysis. */
  context: { before: string; after: string } | null;
  /** Set when the sequences are identical. */
  identical: boolean;
}

export function describeSequenceChange(before: string, after: string, window = 12): SequenceChange {
  const a = (before ?? '').toUpperCase();
  const b = (after ?? '').toUpperCase();

  if (a === b) {
    return { before: a.length, after: b.length, delta: 0, firstDiff: null, lastDiff: null, context: null, identical: true };
  }

  // Longest shared prefix, then longest shared suffix that does not overlap it.
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;

  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

  const firstDiff = p < Math.max(a.length, b.length) ? p + 1 : null;
  const lastDiff = s > 0 ? s : null;

  const from = Math.max(0, p - window);
  const context = {
    before: a.slice(from, p + window) || '—',
    after: b.slice(from, p + window) || '—',
  };

  return {
    before: a.length,
    after: b.length,
    delta: b.length - a.length,
    firstDiff,
    lastDiff,
    context,
    identical: false,
  };
}

/** One line a person can read in a history list. */
export function summariseSequenceChange(c: SequenceChange): string {
  if (c.identical) return 'Sequence unchanged.';
  const size = c.delta === 0
    ? `${c.before.toLocaleString()} bp, length unchanged`
    : `${c.before.toLocaleString()} → ${c.after.toLocaleString()} bp (${c.delta > 0 ? '+' : ''}${c.delta})`;
  const where = c.firstDiff === null
    ? ''
    : `, first difference at ${c.firstDiff.toLocaleString()}`;
  return size + where;
}
