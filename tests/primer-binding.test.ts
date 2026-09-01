import test from 'node:test';
import assert from 'node:assert/strict';
import { findBindings, placePrimers, bindingTitle } from '../src/lib/primer-binding.ts';
import { revComp } from '../src/lib/alignment.ts';
import { makeSeq } from './support/sequences.ts';

const T = makeSeq(2000, 17);

test('a forward primer is found with its 3-prime end on the right', () => {
  const p = T.slice(500, 522);
  const [b] = findBindings(p, T);
  assert.equal(b.strand, 'forward');
  assert.equal(b.start, 500);
  assert.equal(b.end, 521);
  assert.equal(b.exact, true);
  assert.equal(b.tailLength, 0);
});

test('a reverse primer is found, and its arrow anchors at the other end', () => {
  // The primer is the reverse complement of template 800..821, so it anneals
  // there reading right to left.
  const p = revComp(T.slice(800, 822));
  const [b] = findBindings(p, T);
  assert.equal(b.strand, 'reverse');
  assert.equal(b.start, 800);
  assert.equal(b.end, 821);
  assert.equal(b.exact, true);
});

test("a primer with a 5' tail is found by its annealing half", () => {
  // What every cloning method in the wizard produces: a restriction site or a
  // Gibson arm on the front. An exact search finds nothing here.
  const anneal = T.slice(300, 322);
  const withTail = 'GCGCGAATTCGCGC' + anneal;
  assert.equal(findBindings(withTail, T, { minAnneal: withTail.length }).length, 0,
    'demonstrating that a full-length requirement misses it');

  const [b] = findBindings(withTail, T);
  assert.equal(b.start, 300);
  assert.equal(b.end, 321);
  assert.equal(b.annealLength, 22);
  assert.equal(b.tailLength, 14);
  assert.equal(b.exact, false);
});

test("a reverse primer with a tail anneals by its 3' end too", () => {
  const anneal = revComp(T.slice(1200, 1222));
  const withTail = 'GGGGACAAGTTTGTACAAAAAAGCAGGCT' + anneal;   // attB1-ish tail
  const [b] = findBindings(withTail, T);
  assert.equal(b.strand, 'reverse');
  assert.equal(b.start, 1200);
  assert.equal(b.end, 1221);
  assert.equal(b.annealLength, 22);
  assert.ok(b.tailLength > 20);
});

test('a primer that anneals twice reports both sites', () => {
  // Why a PCR gives two bands, so both have to come back.
  const repeat = 'ACGTTGCACCTAGGATCCAT';
  const template = makeSeq(300, 3) + repeat + makeSeq(400, 4) + repeat + makeSeq(300, 5);
  const hits = findBindings(repeat, template);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].start, 300);
  assert.equal(hits[1].start, 720);
});

test('a primer that matches nothing is reported as nothing', () => {
  assert.deepEqual(findBindings(makeSeq(24, 999), T), []);
});

test('a short primer matches in full or not at all', () => {
  // The annealing floor guards partial 3' matches, not short oligos. A 9 nt
  // primer someone deliberately saved and which matches completely is a short
  // primer; refusing it would be the threshold answering a question it was
  // not asked.
  const short = T.slice(100, 109);
  const full = findBindings(short, T);
  assert.equal(full.length, 1);
  assert.equal(full[0].exact, true);
  assert.equal(full[0].annealLength, 9);

  // But it is never matched partially — a 6 of 9 agreement is nothing.
  const nearlyShort = short.slice(0, 6) + 'GGG';
  assert.deepEqual(findBindings(nearlyShort, T), []);

  // And below the absolute floor nothing is reported at all.
  assert.deepEqual(findBindings(T.slice(0, 6), T), []);
});

test('a long primer is still held to the partial-match floor', () => {
  // 40 nt of which only the last 9 match: chance, not annealing.
  const junk = makeSeq(31, 555);
  assert.deepEqual(findBindings(junk + T.slice(200, 209), T), []);
  // Extend the match past the floor and it is found.
  const real = findBindings(junk + T.slice(200, 214), T);
  assert.equal(real.length, 1);
  assert.equal(real[0].annealLength, 14);
});

test('the longest 3-prime match wins, not the first one tried', () => {
  const p = T.slice(600, 630);
  const [b] = findBindings(p, T);
  assert.equal(b.annealLength, 30, 'a 30 nt exact match must not be reported as a 12 nt one');
});

test('a primer over the origin of a circular template is found whole', () => {
  const acrossJoin = T.slice(T.length - 14) + T.slice(0, 14);

  // Linear: only the 3' half is present, so it anneals partially at position 0.
  // That is a real 14 nt match and reporting it is right — but it is not the
  // 28 nt site the primer actually has on a plasmid.
  const linear = findBindings(acrossJoin, T, { circular: false });
  assert.equal(linear.length, 1);
  assert.equal(linear[0].annealLength, 14);
  assert.equal(linear[0].start, 0);

  const [b] = findBindings(acrossJoin, T, { circular: true });
  assert.equal(b.annealLength, 28, 'the whole primer anneals once the join exists');
  assert.equal(b.start, T.length - 14);
  assert.equal(b.end, 13, 'the end wraps back to the start, as GenBank writes it');
  assert.equal(b.wrapsOrigin, true);
});

test('a palindromic primer anneals both ways and both are reported', () => {
  const template = makeSeq(200, 21) + 'GAATTCGCGCGAATTC' + makeSeq(200, 22);
  const hits = findBindings('GAATTCGCGCGAATTC', template);
  assert.equal(hits.length, 2, 'its own reverse complement matches the same place');
  assert.deepEqual([...new Set(hits.map(h => h.strand))].sort(), ['forward', 'reverse']);
});

test('placing a set keeps names and reports a filed direction that disagrees', () => {
  const placed = placePrimers([
    { id: 'a', name: 'M13F', sequence: T.slice(100, 124), direction: 'forward' },
    { id: 'b', name: 'M13R', sequence: revComp(T.slice(900, 924)), direction: 'reverse' },
    // Filed as forward but its sequence anneals the other way.
    { id: 'c', name: 'mislabelled', sequence: revComp(T.slice(1500, 1524)), direction: 'forward' },
  ], T);

  assert.equal(placed.length, 3);
  assert.deepEqual(placed.map(p => p.name), ['M13F', 'M13R', 'mislabelled']);
  assert.equal(placed[0].directionMismatch, false);
  assert.equal(placed[1].directionMismatch, false);
  assert.equal(placed[2].directionMismatch, true);
  assert.equal(placed[2].strand, 'reverse');
  assert.match(bindingTitle(placed[2]), /Filed as forward but anneals as reverse/);
});

test('a primer with no recorded direction is never called a mismatch', () => {
  const [p] = placePrimers([{ id: 'x', name: 'p', sequence: T.slice(50, 74) }], T);
  assert.equal(p.recordedDirection, null);
  assert.equal(p.directionMismatch, false);
});

test('the tooltip states the anneal and the tail separately', () => {
  const tail = 'GCGCGAATTCGCGCGAATTC';
  const primer = tail + T.slice(400, 424);
  const [p] = placePrimers([{ id: 'a', name: 'GibsonF', sequence: primer, direction: 'forward' }], T);

  // The match may run a base or two into the tail if the template happens to
  // continue it, so the assertion is on the invariant rather than on 24.
  assert.equal(p.annealLength + p.tailLength, primer.length);
  assert.ok(p.annealLength >= 24, `annealed ${p.annealLength}`);
  assert.ok(p.tailLength > 0, 'the tail is reported, not absorbed');
  assert.match(bindingTitle(p), /\d+ nt anneal, \d+ nt 5′ tail/);
});

test('placements come back in position order for drawing', () => {
  const placed = placePrimers([
    { id: 'c', name: 'late', sequence: T.slice(1500, 1524) },
    { id: 'a', name: 'early', sequence: T.slice(100, 124) },
    { id: 'b', name: 'middle', sequence: T.slice(700, 724) },
  ], T);
  assert.deepEqual(placed.map(p => p.name), ['early', 'middle', 'late']);
});
