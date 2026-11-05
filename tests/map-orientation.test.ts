import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDisplay, fromDisplay, orientSequence, orientFeature, orientSpan, orientSite,
  originFor, describe as describeOrientation,
  UNROTATED, isTurned, type Orientation,
} from '../src/lib/map-orientation.ts';
import type { SequenceFeature } from '../src/lib/features.ts';

const feat = (over: Partial<SequenceFeature>): SequenceFeature => ({
  id: 'f', name: 'thing', start: 1, end: 10, color: '#888', type: 'CDS', strand: 1, ...over,
});

const LEN = 100;
const rotated: Orientation = { origin: 21, flipped: false };
const flipped: Orientation = { origin: 1, flipped: true };
const both: Orientation = { origin: 21, flipped: true };

describe('leaving the map alone', () => {
  test('an untouched orientation changes nothing', () => {
    assert.ok(!isTurned(UNROTATED));
    for (const p of [1, 50, 100]) assert.equal(toDisplay(p, LEN, UNROTATED), p);
    assert.equal(orientSequence('ATGC', UNROTATED), 'ATGC');
  });
});

describe('rotating the origin', () => {
  test('the chosen base becomes base 1', () => {
    assert.equal(toDisplay(21, LEN, rotated), 1);
  });

  test('the base before it becomes the last', () => {
    assert.equal(toDisplay(20, LEN, rotated), 100);
  });

  test('positions after the origin move down by the offset', () => {
    assert.equal(toDisplay(30, LEN, rotated), 10);
    assert.equal(toDisplay(100, LEN, rotated), 80);
  });

  test('the bases are rotated to match', () => {
    //                 1234567890
    const seq = 'AAAACCCCGG';
    // origin 5 means the sequence starts at the first C
    assert.equal(orientSequence(seq, { origin: 5, flipped: false }), 'CCCCGGAAAA');
  });
});

describe('flipping', () => {
  test('the first base becomes the last', () => {
    assert.equal(toDisplay(1, LEN, flipped), 100);
    assert.equal(toDisplay(100, LEN, flipped), 1);
  });

  test('the bases are the reverse complement', () => {
    assert.equal(orientSequence('ATGC', flipped), 'GCAT');
  });

  test('a feature keeps its extent and swaps its ends', () => {
    /*
     * What was the start of a forward feature is the end of the same feature
     * read the other way, so the ends swap as well as move -- otherwise the
     * feature would come out with end before start and draw as nothing.
     */
    const out = orientFeature(feat({ start: 10, end: 20 }), LEN, flipped);
    assert.equal(out.start, 81);
    assert.equal(out.end, 91);
    assert.ok(out.end > out.start);
    assert.equal(out.end - out.start, 10);
  });

  test('a feature reverses its strand', () => {
    // A promoter pointing clockwise points anticlockwise once the molecule
    // is turned over, and drawing the arrow the old way answers the question
    // backwards -- which is the question a flip is for.
    assert.equal(orientFeature(feat({ strand: 1 }), LEN, flipped).strand, -1);
    assert.equal(orientFeature(feat({ strand: -1 }), LEN, flipped).strand, 1);
  });

  test('a strand is untouched by rotation alone', () => {
    assert.equal(orientFeature(feat({ strand: 1 }), LEN, rotated).strand, 1);
  });

  test('exons come back in the order they are now read', () => {
    const spliced = feat({ start: 10, end: 40, segments: [{ start: 10, end: 15 }, { start: 35, end: 40 }] });
    const out = orientFeature(spliced, LEN, flipped);
    assert.equal(out.segments!.length, 2);
    // The last exon of the forward feature is the first one read backwards.
    assert.ok(out.segments![0].start < out.segments![1].start);
  });
});

describe('the inverse', () => {
  test('a click on a turned map comes back as the base it really is', () => {
    for (const o of [UNROTATED, rotated, flipped, both]) {
      for (const p of [1, 2, 20, 21, 50, 99, 100]) {
        assert.equal(fromDisplay(toDisplay(p, LEN, o), LEN, o), p,
          `${JSON.stringify(o)} at ${p}`);
      }
    }
  });

  test('every position of a molecule round-trips, both ways', () => {
    /*
     * Exhaustive, because an off-by-one here selects the wrong base and says
     * nothing about it -- the one failure mode a coordinate transform has
     * and the one that is invisible in a screenshot.
     */
    for (const o of [rotated, flipped, both, { origin: 100, flipped: false }, { origin: 100, flipped: true }]) {
      for (let p = 1; p <= LEN; p++) {
        assert.equal(fromDisplay(toDisplay(p, LEN, o), LEN, o), p, `to/from ${JSON.stringify(o)} at ${p}`);
        assert.equal(toDisplay(fromDisplay(p, LEN, o), LEN, o), p, `from/to ${JSON.stringify(o)} at ${p}`);
      }
    }
  });

  test('a display position is always on the molecule', () => {
    for (const o of [rotated, flipped, both]) {
      for (let p = 1; p <= LEN; p++) {
        const d = toDisplay(p, LEN, o);
        assert.ok(d >= 1 && d <= LEN, `${d} off the molecule`);
      }
    }
  });
});

describe('rotating and flipping together', () => {
  test('the rotation is applied first, as the origin is a record position', () => {
    // Base 21 rotates to 1, which flips to 100.
    assert.equal(toDisplay(21, LEN, both), 100);
  });

  test('the bases match the coordinates', () => {
    const seq = 'AAAACCCCGG';                       // 10 bases
    const out = orientSequence(seq, { origin: 5, flipped: true });
    // rotate to CCCCGGAAAA, then reverse complement
    assert.equal(out, 'TTTTCCGGGG');
  });
});

describe('choosing an origin', () => {
  test('the base clicked is the origin', () => {
    assert.equal(originFor(42, LEN), 42);
  });

  test('a position off the end wraps rather than throwing', () => {
    assert.equal(originFor(101, LEN), 1);
    assert.equal(originFor(0, LEN), 100);
  });
});

describe('saying what the map is doing', () => {
  test('nothing to say when it is not turned', () => {
    assert.equal(describeOrientation(UNROTATED), null);
  });

  test('it names each thing that is on', () => {
    assert.equal(describeOrientation(rotated), 'origin at 21');
    assert.equal(describeOrientation(flipped), 'flipped');
    assert.equal(describeOrientation(both), 'origin at 21, flipped');
  });
});

describe('degenerate molecules', () => {
  test('an empty sequence does not divide by zero', () => {
    assert.equal(toDisplay(1, 0, rotated), 1);
    assert.equal(fromDisplay(1, 0, rotated), 1);
    assert.equal(orientSequence('', flipped), '');
  });

  test('a single base is its own everything', () => {
    assert.equal(toDisplay(1, 1, { origin: 1, flipped: true }), 1);
  });
});

describe('spans and sites', () => {
  test('a span swaps its ends on a flip, like a feature', () => {
    const out = orientSpan({ start: 10, end: 20 }, LEN, flipped);
    assert.equal(out.start, 81);
    assert.equal(out.end, 91);
  });

  test('a rotated site moves its cuts and keeps their order', () => {
    const site = { cutPos: 30, cutBottom: 34, recognitionStart: 29, recognitionLen: 6 };
    const out = orientSite(site, LEN, rotated);
    assert.equal(out.cutPos, 10);
    assert.equal(out.cutBottom, 14);
    assert.equal(out.recognitionStart, 9);
  });

  test('a flipped site swaps which strand each cut is on', () => {
    /*
     * Turn the molecule over and the strand that was on top is underneath.
     * Moving the cuts without swapping them draws every overhang the wrong
     * way round, and an overhang the wrong way round is a cloning plan that
     * does not anneal.
     */
    const site = { cutPos: 30, cutBottom: 34, recognitionStart: 29, recognitionLen: 6 };
    const out = orientSite(site, LEN, flipped);
    assert.equal(out.cutPos, toDisplay(34, LEN, flipped));
    assert.equal(out.cutBottom, toDisplay(30, LEN, flipped));
  });

  test('a flipped site is read from what was its far end', () => {
    const site = { cutPos: 30, cutBottom: 30, recognitionStart: 29, recognitionLen: 6 };
    const out = orientSite(site, LEN, flipped);
    // recognition spans 29..34; flipped it starts where 34 landed
    assert.equal(out.recognitionStart, toDisplay(34, LEN, flipped));
  });

  test('a blunt cutter stays blunt however the map is turned', () => {
    const blunt = { cutPos: 50, cutBottom: 50, recognitionStart: 48, recognitionLen: 6 };
    for (const o of [rotated, flipped, both]) {
      const out = orientSite(blunt, LEN, o);
      assert.equal(out.cutPos, out.cutBottom, JSON.stringify(o));
    }
  });
});
