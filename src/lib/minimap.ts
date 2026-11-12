/**
 * Where you are in a long molecule.
 *
 * The sequence pane shows a screenful at a time. On a 2 kb plasmid that is
 * most of the molecule and the scrollbar is sense of place enough; on a 250 kb
 * record it is a thousandth of it, and a scrollbar says "somewhere in the
 * middle" about a region the size of a gene. The minimap is the whole molecule
 * drawn as one strip, with the screenful marked on it.
 *
 * Everything that decides where something lands on that strip lives here
 * rather than in the component, because all of it is arithmetic that is either
 * right or quietly one pixel out, and a picture does not say which.
 */

import type { SequenceFeature } from './features';

/**
 * The narrowest the window marker is allowed to get.
 *
 * On 250 kb a screenful of sequence is about a thousandth of the strip, which
 * rounds to nothing: the marker that is the entire point of the strip would
 * not be drawn. Widening it tells a small lie about the extent and keeps the
 * one fact the reader came for, which way round is not a close call.
 */
export const MIN_WINDOW_PX = 7;

/** A minimap is for a molecule too long to take in, and nothing shorter. */
export const MIN_LENGTH = 5_000;

/**
 * How much of the molecule has to be off screen before the strip earns room.
 *
 * An eighth, which is to say the strip appears at about eight screenfuls. The
 * question it answers is not "is there more below" -- the scrollbar answers
 * that -- but "where in the molecule am I", and a scrollbar only stops
 * answering that once its thumb is too small to aim with. A 1.8 kb gene over
 * five screenfuls does not need a second map above it; a 250 kb record, where
 * a screenful is a seven-hundredth of the molecule, is the case this is for.
 */
export const MAX_ON_SCREEN = 1 / 8;

export interface MinimapBand {
  /** Pixels from the left edge of the strip. */
  x: number;
  w: number;
  color: string;
  /** What to name in a tooltip: the feature this band is mostly made of. */
  name: string;
  id: string;
}

/** Whether a strip is worth the room it would take. */
export function worthShowing(len: number, visibleBases: number): boolean {
  if (len < MIN_LENGTH) return false;
  if (visibleBases <= 0) return true;
  return visibleBases < len * MAX_ON_SCREEN;
}

/**
 * Left edge of a base, in strip pixels.
 *
 * 1-based in, because every coordinate the viewer holds is 1-based and
 * converting at the boundary is how the off-by-one gets in.
 */
export function baseToX(base: number, len: number, width: number): number {
  if (len <= 0 || width <= 0) return 0;
  const clamped = Math.min(Math.max(base, 1), len);
  return ((clamped - 1) / len) * width;
}

/** The base under a pixel. Always a base on the molecule. */
export function xToBase(x: number, len: number, width: number): number {
  if (len <= 0 || width <= 0) return 1;
  const frac = Math.min(Math.max(x, 0), width) / width;
  return Math.min(len, Math.max(1, Math.floor(frac * len) + 1));
}

/**
 * The marker for the screenful, given the first and last base on screen.
 *
 * Both inclusive. A range through the origin cannot happen here -- the
 * sequence pane reads top to bottom from base 1 -- so end before start is
 * treated as the one-line case it is rather than wrapped.
 */
export function windowRect(
  first: number, last: number, len: number, width: number,
): { x: number; w: number } {
  if (len <= 0 || width <= 0) return { x: 0, w: 0 };
  const a = Math.min(Math.max(first, 1), len);
  const b = Math.min(Math.max(Math.max(last, a), 1), len);
  const x = baseToX(a, len, width);
  const raw = ((b - a + 1) / len) * width;
  const w = Math.max(MIN_WINDOW_PX, raw);
  // Widening at the right-hand end would push the marker off the strip, so it
  // is the left edge that gives way once there is no room on the right.
  return { x: Math.min(x, Math.max(0, width - w)), w: Math.min(w, width) };
}

/**
 * Where to put the top of the window when somebody points at the strip.
 *
 * The pointer means "show me here", so the screenful is centred on it rather
 * than started at it -- starting at it puts the thing pointed to on the top
 * edge, half under the labels, which is the one place it cannot be read.
 */
export function topBaseFor(x: number, len: number, width: number, span: number): number {
  if (len <= 0) return 1;
  const at = xToBase(x, len, width);
  const visible = Math.min(Math.max(span, 1), len);
  const top = at - Math.floor(visible / 2);
  return Math.min(Math.max(top, 1), len - visible + 1);
}

/**
 * Features as bands on the strip, at most one per pixel column.
 *
 * A 250 kb record with two thousand features would otherwise be two thousand
 * rects, most of them a tenth of a pixel wide, and the browser spends its
 * frame budget drawing a grey smear. One band per column, and where features
 * share a column the longer one wins it: the strip is read for the shape of
 * the molecule, and the shape is the long features. A 20 bp site that loses
 * its pixel to the 4 kb gene it sits inside has lost nothing a whole-molecule
 * view could have shown.
 *
 * A feature through the origin is drawn as the two runs it is on a line.
 */
export function bands(
  features: SequenceFeature[], len: number, width: number,
): MinimapBand[] {
  if (len <= 0 || width <= 0) return [];
  const cols = Math.floor(width);
  if (cols <= 0) return [];

  /** The feature holding each column, and how long it is. */
  const held: ({ f: SequenceFeature; span: number } | null)[] = new Array(cols).fill(null);

  const claim = (f: SequenceFeature, from: number, to: number) => {
    const span = to - from + 1;
    const c0 = Math.min(cols - 1, Math.max(0, Math.floor(baseToX(from, len, width))));
    const c1 = Math.min(cols - 1, Math.max(0, Math.floor(baseToX(to, len, width))));
    for (let c = c0; c <= c1; c++) {
      const sitting = held[c];
      if (!sitting || span > sitting.span) held[c] = { f, span };
    }
  };

  for (const f of features) {
    const s = Math.min(Math.max(f.start, 1), len);
    const e = Math.min(Math.max(f.end, 1), len);
    if (f.end < f.start) {
      // Wraps the origin: the tail to the end of the molecule, then the head.
      claim(f, s, len);
      claim(f, 1, e);
    } else {
      claim(f, s, e);
    }
  }

  // Runs of columns held by the same feature are one band, so a long gene is
  // one rect with one tooltip rather than four hundred abutting slivers.
  const out: MinimapBand[] = [];
  for (let c = 0; c < cols; c++) {
    const here = held[c];
    if (!here) continue;
    const prev = out[out.length - 1];
    if (prev && prev.id === here.f.id && Math.abs(prev.x + prev.w - c) < 0.001) {
      prev.w += 1;
      continue;
    }
    out.push({ x: c, w: 1, color: here.f.color, name: here.f.name, id: here.f.id });
  }
  return out;
}

/**
 * Pixel columns holding a search hit.
 *
 * Deduplicated, because a motif with four hundred hits in one kilobase is
 * four hundred rects in the same column, and the answer the strip gives --
 * "they are all down there" -- needs one of them.
 */
export function hitMarks(
  hits: { start: number; end: number }[], len: number, width: number,
): number[] {
  if (len <= 0 || width <= 0) return [];
  const cols = new Set<number>();
  for (const h of hits) {
    const a = Math.min(h.start, h.end);
    const b = Math.max(h.start, h.end);
    const c0 = Math.floor(baseToX(a, len, width));
    const c1 = Math.floor(baseToX(b, len, width));
    for (let c = c0; c <= c1; c++) cols.add(c);
  }
  return [...cols].sort((p, q) => p - q);
}

/**
 * Round numbers to label along the strip, with the end always among them.
 *
 * A strip with no numbers on it says where the window is relative to the
 * molecule and nothing about what that means in bases, which is the number
 * somebody is about to type into a primer order.
 */
export function ticks(len: number, width: number, minGapPx = 60): number[] {
  if (len <= 0 || width <= 0) return [];
  const maxTicks = Math.max(2, Math.floor(width / minGapPx));
  const rough = len / maxTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= rough) ?? pow * 10;
  const out: number[] = [];
  for (let at = step; at < len; at += step) out.push(at);
  return out;
}
