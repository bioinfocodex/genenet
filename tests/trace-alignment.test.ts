import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTrace, orientTrace, peakWindow, type TraceRead } from '../src/lib/trace-alignment.ts';
import { revComp } from '../src/lib/alignment.ts';

/** Deterministic random DNA. */
function dna(length: number, seed: number): string {
  let state = seed;
  let s = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    s += 'ACGT'[(state >> 16) & 3];
  }
  return s;
}

const SPACING = 12;
const ORDER = 'GATC';

/**
 * A chromatogram as an instrument would write it: one Gaussian peak per call,
 * channels in GATC order. `secondary` adds a second peak at a position, at the
 * given fraction of the first, as a mixed population would.
 */
function makeRead(
  name: string,
  calls: string,
  opts: { quality?: number[]; secondary?: Record<number, [string, number]> } = {},
): TraceRead {
  const length = calls.length * SPACING + SPACING;
  const traces = ORDER.split('').map(() => new Array<number>(length).fill(0));
  const peakLocations: number[] = [];
  const bump = (channel: number, centre: number, height: number) => {
    for (let x = Math.max(0, centre - 8); x < Math.min(length, centre + 9); x++) {
      traces[channel][x] += Math.round(height * Math.exp(-((x - centre) ** 2) / 8));
    }
  };
  for (let i = 0; i < calls.length; i++) {
    const centre = SPACING / 2 + i * SPACING;
    peakLocations.push(centre);
    bump(ORDER.indexOf(calls[i]), centre, 1000);
    const extra = opts.secondary?.[i];
    if (extra) bump(ORDER.indexOf(extra[0]), centre, 1000 * extra[1]);
  }
  return {
    name,
    sequence: calls,
    quality: opts.quality ?? new Array(calls.length).fill(40),
    baseOrder: ORDER,
    traces,
    peakLocations,
  };
}

/** Phred profile of a real run: ragged start, good middle, decaying end. */
function realisticQuality(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i < 25 ? 8 : i > n - 40 ? 10 : 45));
}

const reference = dna(3000, 1);

describe('a clean read', () => {
  const calls = reference.slice(1000, 1700);
  const read = makeRead('clean', calls);

  test('is confirmed with nothing to report', () => {
    const v = verifyTrace(reference, false, read);
    assert.equal(v.verdict, 'confirmed');
    assert.deepEqual(v.discrepancies, []);
    assert.equal(v.reversed, false);
    assert.equal(v.coverageStart, 1001);
    assert.equal(v.coverageEnd, 1700);
    assert.equal(v.identity, 1);
  });

  test('a reverse read is recognised and laid along the top strand', () => {
    const v = verifyTrace(reference, false, makeRead('rev', revComp(calls)));
    assert.equal(v.reversed, true);
    assert.equal(v.verdict, 'confirmed');
    assert.equal(v.coverageStart, 1001);
    assert.equal(v.trace.sequence, calls);
  });
});

describe('grading differences', () => {
  const calls = reference.slice(500, 1200).split('');
  const at = 300;
  calls[at] = calls[at] === 'A' ? 'G' : 'A';
  const mutated = calls.join('');

  test('a well-supported mismatch is reported at its reference position', () => {
    const v = verifyTrace(reference, false, makeRead('mut', mutated));
    assert.equal(v.verdict, 'differs');
    assert.equal(v.discrepancies.length, 1);
    const d = v.discrepancies[0];
    assert.equal(d.kind, 'mismatch');
    assert.equal(d.position, 500 + at + 1);
    assert.equal(d.reference, reference[500 + at]);
    assert.equal(d.read, mutated[at]);
    assert.equal(d.confidence, 'high');
  });

  test('the same mismatch under a poor call is low confidence and does not fail the read', () => {
    const quality = new Array(mutated.length).fill(40);
    quality[at] = 12;
    const v = verifyTrace(reference, false, makeRead('weak', mutated, { quality }));
    assert.equal(v.discrepancies[0].confidence, 'low');
    assert.equal(v.verdict, 'confirmed');
  });

  test('a mismatch on a reverse read is reported in reference terms', () => {
    const v = verifyTrace(reference, false, makeRead('mut-rev', revComp(mutated)));
    assert.equal(v.reversed, true);
    assert.equal(v.discrepancies[0].position, 500 + at + 1);
    assert.equal(v.discrepancies[0].read, mutated[at]);
  });

  test('a three-base deletion is one contiguous event', () => {
    const deleted = reference.slice(500, 800) + reference.slice(803, 1200);
    const v = verifyTrace(reference, false, makeRead('del', deleted));
    const dels = v.discrepancies.filter(d => d.kind === 'deletion');
    assert.equal(dels.length, 3);
    assert.deepEqual(dels.map(d => d.position), [801, 802, 803]);
    assert.ok(dels.every(d => d.confidence === 'high'));
  });

  test('an insertion is reported after the base it follows', () => {
    const inserted = reference.slice(500, 900) + 'T' + reference.slice(900, 1200);
    const v = verifyTrace(reference, false, makeRead('ins', inserted));
    const ins = v.discrepancies.filter(d => d.kind === 'insertion');
    assert.equal(ins.length, 1);
    assert.equal(ins[0].read, 'T');
    assert.ok(Math.abs(ins[0].position - 900) <= 1, `insertion near 900, got ${ins[0].position}`);
  });
});

describe('what the basecalls hide', () => {
  test('a strong second peak is flagged as mixed even though the call matches', () => {
    const calls = reference.slice(200, 900);
    const other = calls[350] === 'C' ? 'T' : 'C';
    const v = verifyTrace(reference, false, makeRead('mixed', calls, { secondary: { 350: [other, 0.7] } }));
    const mixed = v.discrepancies.filter(d => d.kind === 'mixed');
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].position, 551);
    assert.ok(mixed[0].secondaryRatio! > 0.6);
    assert.equal(mixed[0].confidence, 'high');
  });

  test('ragged ends are trimmed before anything is judged', () => {
    const calls = reference.slice(1000, 1800).split('');
    // Garbage calls in the low-quality ends that would otherwise be "differences".
    for (const i of [3, 7, 12, 790, 795]) calls[i] = calls[i] === 'A' ? 'C' : 'A';
    const v = verifyTrace(reference, false, makeRead('ragged', calls.join(''), { quality: realisticQuality(800) }));
    assert.equal(v.verdict, 'confirmed');
    assert.deepEqual(v.discrepancies, []);
    assert.equal(v.usableStart, 25);
    assert.equal(v.usableEnd, 761);
    assert.equal(v.coverageStart, 1026);
  });

  test('a read that is all noise is called unusable rather than wrong', () => {
    const v = verifyTrace(reference, false, makeRead('dead', dna(300, 9), { quality: new Array(300).fill(5) }));
    assert.equal(v.verdict, 'unusable');
  });
});

describe('circular references', () => {
  test('a read running through the origin aligns across it', () => {
    const plasmid = dna(2500, 3);
    const calls = plasmid.slice(2200) + plasmid.slice(0, 400);
    const v = verifyTrace(plasmid, true, makeRead('origin', calls));
    assert.equal(v.verdict, 'confirmed');
    assert.equal(v.coverageStart, 2201);
    assert.equal(v.coverageEnd, 400);
    assert.ok(v.columns.every(c => c.refPos >= 1 && c.refPos <= 2500));
  });
});

describe('orienting the trace', () => {
  test('reversing mirrors peaks and swaps each channel for its partner', () => {
    const read = makeRead('o', 'GATTACA');
    const o = orientTrace(read, true);
    assert.equal(o.sequence, revComp('GATTACA'));
    // The first oriented call is T (complement of the last A); its peak must be
    // in the T channel, at the mirrored position.
    const p = o.peaks[0];
    assert.equal(p, o.length - 1 - read.peakLocations[6]);
    assert.ok(o.channels.T[p] > 900);
    assert.ok(o.channels.A[p] < 50);
    // Peaks stay ascending, which the viewer relies on.
    assert.ok(o.peaks.every((x, i) => i === 0 || x > o.peaks[i - 1]));
  });

  test('each call owns the trace between the midpoints to its neighbours', () => {
    const o = orientTrace(makeRead('w', 'ACGTACGT'), false);
    const w = peakWindow(o, 3)!;
    assert.deepEqual(w, [36, 48]);
    assert.ok(w[0] <= o.peaks[3] && o.peaks[3] < w[1]);
  });
});
