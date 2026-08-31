import test from 'node:test';
import assert from 'node:assert/strict';
import { alignProgressive, alignProfiles, guideTree, guideDistances } from '../src/lib/msa.ts';
import { alignMultiple } from '../src/lib/alignment.ts';
import { toNewick, type TreeNode } from '../src/lib/phylogenetics.ts';
import { makeSeq } from './support/sequences.ts';

const BASE = makeSeq(400, 5);
const mut = (s: string, at: number) => s.slice(0, at) + (s[at] === 'A' ? 'G' : 'A') + s.slice(at + 1);
const del = (s: string, at: number, len: number) => s.slice(0, at) + s.slice(at + len);
/** Topology only, so the assertions do not depend on branch lengths. */
const topology = (n: TreeNode): string => n.children ? `(${n.children.map(topology).join(',')})` : n.name!;
const gapRuns = (row: string) => (row.match(/-+/g) ?? []).map(r => r.length);

test('identical sequences align without gaps', () => {
  const a = alignProgressive([
    { name: 'x', sequence: BASE }, { name: 'y', sequence: BASE }, { name: 'z', sequence: BASE },
  ]);
  assert.equal(a.rows[0].length, BASE.length);
  assert.ok(a.rows.every(r => !r.includes('-')));
  assert.equal(a.identity, 1);
});

test('a guide-tree distance counts an indel; a substitution-model distance does not', () => {
  // The exact case that made the first guide tree wrong: A1 and B1 differ only
  // by a deletion, A1 and A2 only by one substitution.
  const seqs = [
    { name: 'A1', sequence: del(BASE, 150, 12) },
    { name: 'A2', sequence: mut(del(BASE, 150, 12), 40) },
    { name: 'B1', sequence: BASE },
  ];
  const d = guideDistances(seqs);
  // A1-A2 (one substitution) must be nearer than A1-B1 (twelve-base deletion).
  assert.ok(d.d[0][1] < d.d[0][2],
    `substitution ${d.d[0][1]} should be nearer than indel ${d.d[0][2]}`);
  assert.ok(d.d[0][2] > 0, 'an indel is a difference, not a free pass');
});

test('the guide tree groups by overall similarity, indels included', () => {
  const seqs = [
    { name: 'A1', sequence: del(BASE, 150, 12) },
    { name: 'A2', sequence: mut(del(BASE, 150, 12), 40) },
    { name: 'B1', sequence: BASE },
    { name: 'B2', sequence: mut(BASE, 300) },
  ];
  const t = topology(guideTree(seqs).tree);
  assert.ok(t === '((B1,B2),(A1,A2))' || t === '((A1,A2),(B1,B2))', `got ${t}`);
});

test('two different indels: each sequence keeps its own gap, in the right place', () => {
  const seqs = [
    { name: 'P1', sequence: del(BASE, 100, 15) },
    { name: 'P2', sequence: mut(del(BASE, 100, 15), 350) },
    { name: 'Q1', sequence: del(BASE, 250, 15) },
    { name: 'Q2', sequence: mut(del(BASE, 250, 15), 20) },
  ];
  const a = alignProgressive(seqs);

  // The true alignment is exactly as wide as the undeleted sequence.
  assert.equal(a.rows[0].length, BASE.length);
  for (const r of a.rows) assert.deepEqual(gapRuns(r), [15], 'one deletion, one gap run');

  // Where the gap sits is only determined to within the ambiguity of the
  // deletion itself: when the base before a deleted block equals the last base
  // of it, sliding the gap one column left produces the identical sequence.
  // Nothing can tell those apart, so the assertion is that the placement is
  // right to within a base -- and, more to the point, that sequences sharing a
  // deletion get it in the *same* column.
  assert.equal(a.rows[0].indexOf('-'), a.rows[1].indexOf('-'), 'P1 and P2 agree');
  assert.equal(a.rows[2].indexOf('-'), a.rows[3].indexOf('-'), 'Q1 and Q2 agree');
  assert.ok(Math.abs(a.rows[0].indexOf('-') - 100) <= 1, `P gap at ${a.rows[0].indexOf('-')}`);
  assert.ok(Math.abs(a.rows[2].indexOf('-') - 250) <= 1, `Q gap at ${a.rows[2].indexOf('-')}`);
});

test('the centre-star method gets that same case wrong, which is why this exists', () => {
  const seqs = [
    { name: 'P1', sequence: del(BASE, 100, 15) },
    { name: 'P2', sequence: mut(del(BASE, 100, 15), 350) },
    { name: 'Q1', sequence: del(BASE, 250, 15) },
    { name: 'Q2', sequence: mut(del(BASE, 250, 15), 20) },
  ];
  const c = alignMultiple(seqs);
  const p = alignProgressive(seqs);

  // Padded 15 columns beyond the true width, and every row carries both
  // deletions rather than its own.
  assert.ok(c.rows[0].length > BASE.length, 'centre-star over-pads');
  assert.ok(p.identity > c.identity, `progressive ${p.identity} vs centre-star ${c.identity}`);
  // The giveaway: Q1 and Q2 differ by a single substitution, yet centre-star
  // puts their gaps in different columns.
  assert.notEqual(c.rows[2].indexOf('-'), c.rows[3].indexOf('-'));
  assert.equal(p.rows[2].indexOf('-'), p.rows[3].indexOf('-'));
});

test('merging two alignments does not re-cut the columns inside either', () => {
  const left = { names: ['a', 'b'], rows: ['ACGT--ACGT', 'ACGT--ACGT'] };
  const right = { names: ['c'], rows: ['ACGTTTACGT'] };
  const merged = alignProfiles(left, right);
  // Whatever the merge decides, a and b stay identical to each other: the
  // columns they already shared are carried through as a unit.
  assert.equal(merged.rows[0], merged.rows[1]);
  assert.equal(merged.rows.length, 3);
  assert.ok(merged.rows.every(r => r.length === merged.rows[0].length));
});

test('two colonies given the same name are both aligned', () => {
  const a = alignProgressive([
    { name: 'clone 3', sequence: BASE },
    { name: 'clone 3', sequence: mut(BASE, 50) },
    { name: 'clone 7', sequence: mut(BASE, 200) },
  ]);
  assert.equal(a.rows.length, 3);
  assert.deepEqual(a.names, ['clone 3', 'clone 3', 'clone 7']);
  // Distinct sequences in, distinct rows out — not the same one twice.
  assert.notEqual(a.rows[0], a.rows[1]);
  assert.equal(a.rows[0][50] !== a.rows[1][50], true);
});

test('consensus marks exactly the columns where every row agrees', () => {
  const a = alignProgressive([
    { name: 'p', sequence: BASE },
    { name: 'q', sequence: mut(BASE, 10) },
    { name: 'r', sequence: mut(BASE, 20) },
  ]);
  assert.equal(a.consensus.length, a.rows[0].length);
  assert.equal(a.consensus[10], ' ');
  assert.equal(a.consensus[20], ' ');
  assert.equal(a.consensus[15], '*');
  const stars = (a.consensus.match(/\*/g) ?? []).length;
  assert.equal(stars / a.rows[0].length, a.identity);
  assert.equal(stars, BASE.length - 2);
});

test('the guide tree comes back with the caller names on it', () => {
  const { tree } = guideTree([
    { name: 'pUC19', sequence: BASE },
    { name: 'pET28a', sequence: mut(BASE, 33) },
  ]);
  const nw = toNewick(tree);
  assert.ok(nw.includes('pUC19') && nw.includes('pET28a'), nw);
});

test('a gap opened early survives later merges', () => {
  // Three sequences share a deletion; a fourth does not. The shared gap should
  // end up in one column for all three, not spread across the alignment.
  const d = del(BASE, 200, 9);
  const a = alignProgressive([
    { name: 'd1', sequence: d },
    { name: 'd2', sequence: mut(d, 12) },
    { name: 'd3', sequence: mut(d, 340) },
    { name: 'full', sequence: BASE },
  ]);
  // Same one-base ambiguity as above; what matters is that all three landed in
  // one column rather than being smeared across the alignment.
  assert.ok(Math.abs(a.rows[0].indexOf('-') - 200) <= 1, `at ${a.rows[0].indexOf('-')}`);
  assert.equal(a.rows[1].indexOf('-'), a.rows[0].indexOf('-'));
  assert.equal(a.rows[2].indexOf('-'), a.rows[0].indexOf('-'));
  assert.ok(!a.rows[3].includes('-'));
  assert.equal(a.rows[0].length, BASE.length);
});
