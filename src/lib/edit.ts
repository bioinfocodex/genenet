import type { SequenceFeature } from './features';

/**
 * Editing the sequence, and what that does to everything drawn on it.
 *
 * Inserting a base is not a change to one string. Every feature downstream of
 * the cut moves, every feature spanning it grows, and a feature inside a
 * deleted stretch stops existing. Getting that wrong is worse than not
 * offering the edit at all: a map that still looks right while its coordinates
 * have slipped is a map that will be believed.
 *
 * Coordinates here follow the viewer's convention -- features are 1-indexed
 * and inclusive -- while the caret is a 0-indexed *gap* between bases, so
 * caret 0 is before the first base and caret n is after the last.
 */

export interface EditResult {
  sequence: string;
  features: SequenceFeature[];
}

/** Bases the editor will accept. IUPAC, because ambiguity codes are real data. */
export const EDITABLE_BASES = /^[ACGTRYMKSWHBVDNacgtrymkswhbvdn]+$/;

/** Normalise typed input: uppercase, and nothing that is not a base. */
export function cleanTyped(text: string): string {
  return text.toUpperCase().replace(/[^ACGTRYMKSWHBVDN]/g, '');
}

function shiftSegments(
  segments: { start: number; end: number }[] | undefined,
  move: (n: number) => number,
): { start: number; end: number }[] | undefined {
  if (!segments) return undefined;
  return segments.map(s => ({ start: move(s.start), end: move(s.end) }));
}

/**
 * Insert `text` at the caret.
 *
 * A feature that *spans* the caret grows by the inserted length, because the
 * inserted bases are inside it -- pasting a linker into the middle of a CDS
 * makes the CDS longer, and pretending otherwise would silently truncate the
 * annotation. A feature that starts at or after the caret simply moves.
 */
export function insertBases(
  sequence: string,
  features: SequenceFeature[],
  caret: number,
  text: string,
): EditResult {
  const insert = cleanTyped(text);
  if (!insert) return { sequence, features };
  const at = Math.max(0, Math.min(sequence.length, caret));
  const n = insert.length;

  // 1-indexed position of the first inserted base.
  const firstNew = at + 1;

  const move = (pos: number) => (pos >= firstNew ? pos + n : pos);

  return {
    sequence: sequence.slice(0, at) + insert + sequence.slice(at),
    features: features.map(f => {
      const start = move(f.start);
      // The end moves when the insertion is at or before it, which is what
      // makes a feature containing the caret grow rather than shift whole.
      const end = f.end >= firstNew ? f.end + n : f.end;
      return { ...f, start, end, ...(f.segments ? { segments: shiftSegments(f.segments, move2(firstNew, n)) } : {}) };
    }),
  };
}

/** Segment ends follow the same rule as feature ends. */
function move2(firstNew: number, n: number) {
  return (pos: number) => (pos >= firstNew ? pos + n : pos);
}

/**
 * Delete bases from `start` to `end`, 1-indexed inclusive.
 *
 * A feature wholly inside the deletion is dropped -- it no longer describes
 * anything. One that overlaps is trimmed to what survives. A spliced feature
 * loses the exons that went, and stops being spliced if only one is left,
 * because a single block is not a splice.
 */
export function deleteRange(
  sequence: string,
  features: SequenceFeature[],
  start: number,
  end: number,
): EditResult {
  const from = Math.max(1, Math.min(start, end));
  const to = Math.min(sequence.length, Math.max(start, end));
  if (to < from) return { sequence, features };
  const n = to - from + 1;

  /** Where a 1-indexed position lands once the range is gone. */
  const move = (pos: number) => (pos > to ? pos - n : pos);

  const out: SequenceFeature[] = [];
  for (const f of features) {
    // Gone entirely.
    if (f.start >= from && f.end <= to) continue;

    const start2 = f.start >= from && f.start <= to ? from : move(f.start);
    // A feature whose end is inside the deletion ends where the deletion began.
    const end2 = f.end >= from && f.end <= to ? from - 1 : move(f.end);
    if (end2 < start2) continue;

    const segments = f.segments
      ?.filter(s => !(s.start >= from && s.end <= to))
      .map(s => ({
        start: s.start >= from && s.start <= to ? from : move(s.start),
        end: s.end >= from && s.end <= to ? from - 1 : move(s.end),
      }))
      .filter(s => s.end >= s.start);

    out.push({
      ...f,
      start: start2,
      end: end2,
      // One block left is not a splice any more.
      ...(segments && segments.length > 1 ? { segments } : {}),
      ...(segments && segments.length <= 1 ? { segments: undefined } : {}),
    });
  }

  return {
    sequence: sequence.slice(0, from - 1) + sequence.slice(to),
    features: out.map(f => {
      const copy = { ...f };
      if (copy.segments === undefined) delete copy.segments;
      return copy;
    }),
  };
}

/** Replace a selected range with typed text: a delete and an insert. */
export function replaceRange(
  sequence: string,
  features: SequenceFeature[],
  start: number,
  end: number,
  text: string,
): EditResult {
  const cut = deleteRange(sequence, features, start, end);
  const from = Math.max(1, Math.min(start, end));
  return insertBases(cut.sequence, cut.features, from - 1, text);
}

// ─── Undo ────────────────────────────────────────────────────────────────────

export interface EditSnapshot {
  sequence: string;
  features: SequenceFeature[];
  /** What the edit was, for the label on the undo button. */
  label: string;
}

/**
 * A bounded history.
 *
 * Snapshots rather than inverse operations: a plasmid is a few kilobases of
 * string and thirty of them is nothing, whereas an inverse-operation log has
 * to be right about feature reconstruction as well, and that is the part most
 * likely to be subtly wrong.
 */
export const MAX_HISTORY = 50;

export function pushHistory(stack: EditSnapshot[], entry: EditSnapshot): EditSnapshot[] {
  const next = [...stack, entry];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}
