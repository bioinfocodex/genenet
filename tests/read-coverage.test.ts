import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { coverageOf, unresolved, classify, type Call } from '../src/lib/read-coverage.ts';
import { verifyTrace, type TraceRead } from '../src/lib/trace-alignment.ts';
import { revComp } from '../src/lib/alignment.ts';

function dna(length: number, seed: number): string {
  let state = seed;
  let s = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    s += 'ACGT'[(state >> 16) & 3];
  }
  return s;
}

/** A clean synthetic trace for `calls`, as in the trace-alignment tests. */
function makeRead(name: string, calls: string, quality?: number[]): TraceRead {
  const ORDER = 'GATC';
  const length = calls.length * 12 + 12;
  const traces = [0, 1, 2, 3].map(() => new Array<number>(length).fill(0));
  const peakLocations: number[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = 6 + i * 12;
    peakLocations.push(c);
    for (let x = c - 6; x <= c + 6; x++) traces[ORDER.indexOf(calls[i])][x] += Math.round(1000 * Math.exp(-((x - c) ** 2) / 8));
  }
  return { name, sequence: calls, quality: quality ?? new Array(calls.length).fill(40), baseOrder: ORDER, traces, peakLocations };
}

const ref = dna(2000, 5);
const swap = (s: string, at: number, b: string) => s.slice(0, at) + b + s.slice(at + 1);
const other = (b: string) => (b === 'A' ? 'G' : 'A');
const read = (name: string, calls: string, q?: number[]) => ({ name, verification: verifyTrace(ref, false, makeRead(name, calls, q)) });

describe('how much of the construct the reads cover', () => {
  test('overlapping forward and reverse reads: covered, gaps, single-read and both-strand stretches', () => {
    const c = coverageOf(ref.length, [
      read('F', ref.slice(100, 900)),
      read('R', revComp(ref.slice(700, 1500))),
    ]);
    assert.equal(c.covered, 1400);
    assert.equal(c.bothStrands, 200, '701..900 is read from both strands');
    assert.equal(c.singleRead, 1200);
    assert.deepEqual(c.gaps, [{ start: 1, end: 100 }, { start: 1501, end: 2000 }]);
    assert.equal(c.disagreements.length, 0);
    assert.equal(c.spans.length, 2);
  });
});

describe('what a difference means across reads', () => {
  const at = 800; // 0-based; position 801, inside the overlap
  const changed = swap(ref, at, other(ref[at]));

  test('the same change in a forward and a reverse read is confirmed', () => {
    const c = coverageOf(ref.length, [
      read('F', changed.slice(100, 900)),
      read('R', revComp(changed.slice(700, 1500))),
    ]);
    const [d] = c.disagreements;
    assert.equal(d.position, at + 1);
    assert.equal(d.agreement, 'confirmed');
    assert.equal(d.change, `${ref[at]}${at + 1}${other(ref[at])}`);
    assert.deepEqual(unresolved(c).map(x => x.position), [at + 1]);
  });

  test('a weak change one read makes and another clearly does not is a read error', () => {
    const q = new Array(800).fill(40);
    q[at - 100] = 12;
    const c = coverageOf(ref.length, [
      read('F', changed.slice(100, 900), q),
      read('R', revComp(ref.slice(700, 1500))),
    ]);
    assert.equal(c.disagreements[0].agreement, 'contradicted');
    assert.deepEqual(unresolved(c), []);
  });

  test('a clear change against a single clear reference call is a draw, not a verdict', () => {
    const c = coverageOf(ref.length, [
      read('F', changed.slice(100, 900)),
      read('R', revComp(ref.slice(700, 1500))),
    ]);
    assert.equal(c.disagreements[0].agreement, 'contested');
  });

  test('a change only one read covers needs another read', () => {
    const lone = swap(ref, 300, other(ref[300]));
    const c = coverageOf(ref.length, [read('F', lone.slice(100, 900)), read('R', revComp(ref.slice(700, 1500)))]);
    const d = c.disagreements.find(x => x.position === 301)!;
    assert.equal(d.agreement, 'single');
    assert.equal(unresolved(c).length, 1, 'a clear single-read change still stands in the way');
  });

  test('an insertion two reads agree on is confirmed, named after the join', () => {
    const ins = ref.slice(0, 801) + 'T' + ref.slice(801);
    const c = coverageOf(ref.length, [
      read('F', ins.slice(100, 901)),
      read('R', revComp(ins.slice(700, 1501))),
    ]);
    const d = c.disagreements.find(x => x.reference === '')!;
    assert.ok(d, 'an insertion is reported');
    assert.equal(d.agreement, 'confirmed');
    assert.match(d.change, /ins/);
    assert.ok(Math.abs(d.position - 801) <= 1);
  });
});

describe('classifying calls at one position', () => {
  const call = (read: string, base: string, quality: number | null, mixed = false): Call =>
    ({ read, base, quality, column: 0, reversed: false, mixed });

  test('reads naming different changes are contested', () => {
    assert.equal(classify([call('a', 'G', 40), call('b', 'T', 40)], 'A'), 'contested');
  });
  test('a mixed peak is contested whatever the calls', () => {
    assert.equal(classify([call('a', 'A', 40, true), call('b', 'A', 40)], 'A'), 'contested');
  });
  test('two clear reference calls outvote one clear dissent', () => {
    assert.equal(classify([call('a', 'G', 45), call('b', 'A', 40), call('c', 'A', 42)], 'A'), 'contradicted');
  });
  test('without quality scores a call is taken at its word', () => {
    assert.equal(classify([call('a', 'G', null), call('b', 'G', null)], 'A'), 'confirmed');
  });
});
