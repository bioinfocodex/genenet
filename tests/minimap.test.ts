import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseToX, xToBase, windowRect, topBaseFor, bands, hitMarks, ticks,
  worthShowing, MIN_WINDOW_PX, MIN_LENGTH,
} from '../src/lib/minimap.ts';
import type { SequenceFeature } from '../src/lib/features.ts';

const feat = (over: Partial<SequenceFeature>): SequenceFeature => ({
  id: 'f', name: 'thing', start: 1, end: 100, color: '#888', type: 'CDS', strand: 1, ...over,
});

const LEN = 250_000;
const W = 800;

describe('whether a strip is worth the room', () => {
  test('a short record does not get one', () => {
    // The scrollbar already answers it, and a second answer is clutter.
    assert.ok(!worthShowing(900, 300));
    assert.ok(!worthShowing(MIN_LENGTH - 1, 10));
  });

  test('a gene over a handful of screenfuls does not get one', () => {
    /*
     * Measured in the app: a 1,791 bp record shows about 355 bases at a time,
     * five screenfuls, and a scrollbar aims that well by itself. This was the
     * first threshold's mistake -- it put a strip above a record you can hold
     * in your head.
     */
    assert.ok(!worthShowing(1_791, 355));
  });

  test('a plasmid over dozens of screenfuls gets one', () => {
    assert.ok(worthShowing(12_000, 355));
  });

  test('a long record with most of it off screen gets one', () => {
    assert.ok(worthShowing(250_000, 1_200));
  });

  test('a long record almost entirely on screen does not', () => {
    assert.ok(!worthShowing(20_000, 19_000));
  });

  test('before the pane has been measured, length decides', () => {
    // visibleBases is 0 on the first render; treating that as "all of it is on
    // screen" would hide the strip exactly when the record is longest.
    assert.ok(worthShowing(250_000, 0));
  });
});

describe('a base on the strip', () => {
  test('the first base is the left edge and the last is inside the right', () => {
    assert.equal(baseToX(1, LEN, W), 0);
    assert.ok(baseToX(LEN, LEN, W) < W);
    assert.ok(baseToX(LEN, LEN, W) > W - 1);
  });

  test('the middle base is the middle', () => {
    assert.ok(Math.abs(baseToX(LEN / 2, LEN, W) - W / 2) < 0.01);
  });

  test('a base off the molecule is clamped rather than drawn off the strip', () => {
    assert.equal(baseToX(-5, LEN, W), 0);
    assert.equal(baseToX(LEN + 1000, LEN, W), baseToX(LEN, LEN, W));
  });

  test('an empty molecule does not divide by zero', () => {
    assert.equal(baseToX(1, 0, W), 0);
    assert.equal(xToBase(400, 0, W), 1);
    assert.deepEqual(bands([feat({})], 0, W), []);
  });
});

describe('the inverse', () => {
  test('a click comes back as a base on the molecule', () => {
    for (const x of [0, 1, 399, 400, 799, 800]) {
      const b = xToBase(x, LEN, W);
      assert.ok(b >= 1 && b <= LEN, `${x} -> ${b}`);
    }
  });

  test('a click outside the strip is clamped to its ends', () => {
    assert.equal(xToBase(-20, LEN, W), 1);
    assert.equal(xToBase(W + 20, LEN, W), LEN);
  });

  test('every pixel round-trips to within its own width', () => {
    /*
     * A pixel is 312 bases on a 250 kb strip, so this cannot be exact -- the
     * check that matters is that the base found under a pixel is a base that
     * pixel actually covers, which is what makes a click land where it looks.
     */
    const basesPerPx = LEN / W;
    for (let x = 0; x < W; x++) {
      const b = xToBase(x, LEN, W);
      const back = baseToX(b, LEN, W);
      assert.ok(Math.abs(back - x) <= 1, `x=${x} -> base ${b} -> x=${back}`);
      assert.ok(b >= Math.floor(x * basesPerPx), `base ${b} is left of pixel ${x}`);
    }
  });
});

describe('the window marker', () => {
  test('it covers the screenful it was given', () => {
    const r = windowRect(100_001, 101_000, LEN, W);
    assert.ok(Math.abs(r.x - baseToX(100_001, LEN, W)) < 0.01);
  });

  test('a screenful too small to draw is widened to stay visible', () => {
    // 1,000 of 250,000 bases is 3.2px of an 800px strip.
    const r = windowRect(1, 1_000, LEN, W);
    assert.equal(r.w, MIN_WINDOW_PX);
  });

  test('the widening never pushes the marker off the right-hand end', () => {
    /*
     * At the bottom of the molecule the marker's left edge is already within
     * a few pixels of the strip's end; widening rightwards would draw it past
     * the strip and say the view is somewhere the molecule is not.
     */
    const r = windowRect(LEN - 999, LEN, LEN, W);
    assert.ok(r.x + r.w <= W, `${r.x} + ${r.w} > ${W}`);
    assert.equal(r.w, MIN_WINDOW_PX);
  });

  test('a whole molecule on screen fills the strip', () => {
    const r = windowRect(1, LEN, LEN, W);
    assert.equal(r.x, 0);
    assert.equal(r.w, W);
  });

  test('a marker is never wider than the strip', () => {
    const r = windowRect(1, LEN * 2, LEN, W);
    assert.ok(r.w <= W);
  });

  test('ends the wrong way round are read as one line, not as a wrap', () => {
    // The pane reads top to bottom from base 1, so this is a bad input rather
    // than a range through the origin, and inventing a wrap would draw a band
    // across the whole molecule.
    const r = windowRect(500, 400, LEN, W);
    assert.equal(r.w, MIN_WINDOW_PX);
    assert.ok(Math.abs(r.x - baseToX(500, LEN, W)) < MIN_WINDOW_PX);
  });

  test('a degenerate strip gives nothing to draw', () => {
    assert.deepEqual(windowRect(1, 10, LEN, 0), { x: 0, w: 0 });
  });
});

describe('pointing at the strip', () => {
  const SPAN = 1_000;

  test('the screenful is centred on the pointer, not started at it', () => {
    const top = topBaseFor(W / 2, LEN, W, SPAN);
    const centre = top + SPAN / 2;
    assert.ok(Math.abs(centre - LEN / 2) < LEN / W, `${centre} vs ${LEN / 2}`);
  });

  test('pointing at the left end does not scroll above base 1', () => {
    assert.equal(topBaseFor(0, LEN, W, SPAN), 1);
  });

  test('pointing at the right end does not scroll past the last screenful', () => {
    assert.equal(topBaseFor(W, LEN, W, SPAN), LEN - SPAN + 1);
  });

  test('every pixel gives a reachable screenful', () => {
    for (let x = 0; x <= W; x++) {
      const top = topBaseFor(x, LEN, W, SPAN);
      assert.ok(top >= 1 && top + SPAN - 1 <= LEN, `x=${x} -> ${top}`);
    }
  });

  test('a screenful larger than the molecule stays at the top', () => {
    assert.equal(topBaseFor(W / 2, 500, W, 5_000), 1);
  });
});

describe('features as bands', () => {
  test('a feature lands where its bases are', () => {
    const b = bands([feat({ id: 'g', start: 125_000, end: 135_000 })], LEN, W);
    assert.equal(b.length, 1);
    assert.ok(Math.abs(b[0].x - baseToX(125_000, LEN, W)) <= 1);
    assert.ok(b[0].w >= 30 && b[0].w <= 34);   // 10 kb of 250 kb over 800px
  });

  test('a long feature is one band, not one per pixel', () => {
    // 400 abutting 1px rects would each carry their own tooltip, so hovering
    // the gene would name it once per pixel crossed.
    const b = bands([feat({ id: 'g', start: 1, end: 125_000 })], LEN, W);
    assert.equal(b.length, 1);
    assert.equal(b[0].id, 'g');
  });

  test('two features sharing a pixel do not become two slivers', () => {
    const b = bands([
      feat({ id: 'a', start: 1000, end: 1050 }),
      feat({ id: 'b', start: 1060, end: 1100 }),
    ], LEN, W);
    assert.equal(b.length, 1);
  });

  test('the longer feature wins the pixel it shares', () => {
    /*
     * The strip is read for the shape of the molecule, and the shape is the
     * long features. Letting a 50 bp site punch a hole in the 20 kb gene it
     * sits inside would draw a gene that looks spliced.
     */
    const b = bands([
      feat({ id: 'gene', name: 'big gene', start: 100_000, end: 120_000, color: '#0a0' }),
      feat({ id: 'site', name: 'little site', start: 110_000, end: 110_050, color: '#a00' }),
    ], LEN, W);
    assert.equal(b.length, 1);
    assert.equal(b[0].id, 'gene');
    assert.equal(b[0].color, '#0a0');
  });

  test('never more bands than pixel columns', () => {
    const many = Array.from({ length: 4_000 }, (_, i) =>
      feat({ id: `f${i}`, start: i * 60 + 1, end: i * 60 + 30 }));
    const b = bands(many, LEN, W);
    assert.ok(b.length <= W, `${b.length} bands on ${W} columns`);
  });

  test('a feature through the origin is drawn as the two runs it is', () => {
    // end before start is this codebase's wrap convention; a naive x..width
    // would come out as a negative width and draw nothing at all.
    const b = bands([feat({ id: 'w', start: LEN - 5_000, end: 5_000 })], LEN, W);
    assert.equal(b.length, 2);
    assert.ok(b[0].x < 50, 'the head run is at the left end');
    assert.ok(b[1].x + b[1].w >= W - 2, 'the tail run reaches the right end');
    for (const band of b) assert.ok(band.w > 0);
  });

  test('a feature reaching past the end is clamped, not dropped', () => {
    const b = bands([feat({ id: 'x', start: LEN - 100, end: LEN + 9_000 })], LEN, W);
    assert.equal(b.length, 1);
    assert.ok(b[0].x + b[0].w <= W);
  });

  test('nothing annotated is nothing drawn', () => {
    assert.deepEqual(bands([], LEN, W), []);
  });

  test('every band is inside the strip', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      feat({ id: `f${i}`, start: i * 500 + 1, end: i * 500 + 400 }));
    for (const band of bands(many, LEN, W)) {
      assert.ok(band.x >= 0 && band.x + band.w <= W, `${band.x}+${band.w}`);
    }
  });
});

describe('search hits on the strip', () => {
  test('a hit is marked where it is', () => {
    /*
     * A pixel is 312 bases here, so a 20-base hit is a mark or two depending
     * on whether it straddles a column boundary. Where it lands is the claim;
     * which side of the boundary it rounded to is not.
     */
    const marks = hitMarks([{ start: 125_000, end: 125_020 }], LEN, W);
    assert.ok(marks.length <= 2, `${marks.length} marks for one hit`);
    for (const m of marks) {
      assert.ok(Math.abs(m - baseToX(125_000, LEN, W)) <= 1, `${m} is not where the hit is`);
    }
  });

  test('hundreds of hits in one stretch collapse to the stretch', () => {
    // 400 rects in the same two pixels is the shape this must not take: the
    // answer the strip gives is "they are all down there", and that needs one.
    const crowd = Array.from({ length: 400 }, (_, i) => ({ start: 1000 + i, end: 1000 + i + 5 }));
    assert.ok(hitMarks(crowd, LEN, W).length <= 2);
  });

  test('marks come back in order along the molecule', () => {
    const marks = hitMarks([
      { start: 200_000, end: 200_010 },
      { start: 1, end: 10 },
      { start: 100_000, end: 100_010 },
    ], LEN, W);
    assert.deepEqual(marks, [...marks].sort((a, b) => a - b));
  });

  test('a wrapping hit is read from its lower end rather than inverted', () => {
    const marks = hitMarks([{ start: 400, end: 200 }], 1_000, 100);
    assert.ok(marks.length > 0);
    assert.ok(marks.every(m => m >= 0 && m <= 100));
  });

  test('no hits, no marks', () => {
    assert.deepEqual(hitMarks([], LEN, W), []);
  });
});

describe('numbers along the strip', () => {
  test('they are round numbers a person would say', () => {
    for (const t of ticks(LEN, W)) {
      assert.equal(t % 10_000, 0, `${t} is not a round number`);
    }
  });

  test('they fit without crowding', () => {
    const t = ticks(LEN, W, 60);
    assert.ok(t.length <= Math.floor(W / 60), `${t.length} ticks in ${W}px`);
    assert.ok(t.length >= 2);
  });

  test('none of them sits on the end, where the length already is', () => {
    for (const t of ticks(LEN, W)) assert.ok(t > 0 && t < LEN);
  });

  test('a short molecule gets finer numbers, not none', () => {
    const t = ticks(2_000, W);
    assert.ok(t.length >= 2);
    assert.ok(t.every(v => v > 0 && v < 2_000));
  });

  test('a degenerate strip has nothing to label', () => {
    assert.deepEqual(ticks(0, W), []);
    assert.deepEqual(ticks(LEN, 0), []);
  });
});
