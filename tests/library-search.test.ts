import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, searchLibrary } from '../src/lib/library-search.ts';
import { revComp } from '../src/lib/alignment.ts';
import { makeSeq } from './support/sequences.ts';


const PLASMID_A = makeSeq(3000, 11);
const PLASMID_B = makeSeq(2400, 29);
const GFP = makeSeq(720, 41);
// B carries GFP at 800; A does not.
const B_WITH_GFP = PLASMID_B.slice(0, 800) + GFP + PLASMID_B.slice(800);

const LIB = [
  { id: 'a', name: 'pBackbone', sequence: PLASMID_A, topology: 'circular' as const },
  { id: 'b', name: 'pGFP', sequence: B_WITH_GFP, topology: 'circular' as const },
];
const INDEX = buildIndex(LIB);

test('a gene present in one plasmid is found there and only there', () => {
  const hits = search(INDEX, GFP);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'pGFP');
  assert.equal(hits[0].strand, '+');
  assert.equal(hits[0].length, GFP.length);
  assert.equal(hits[0].identity, 1);
  assert.equal(hits[0].queryStart, 1);
  assert.equal(hits[0].queryEnd, GFP.length);
  assert.equal(hits[0].subjectStart, 801);
  assert.equal(hits[0].subjectEnd, 800 + GFP.length);
});

test('a query given in the other orientation is found on the minus strand', () => {
  const hits = search(INDEX, revComp(GFP));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].strand, '-');
  assert.equal(hits[0].length, GFP.length);
  assert.equal(hits[0].identity, 1);
  // Subject coordinates still read against the stored sequence.
  assert.equal(hits[0].subjectStart, 801);
  assert.equal(hits[0].subjectEnd, 800 + GFP.length);
  // Query coordinates read against the query as handed in.
  assert.equal(hits[0].queryStart, 1);
  assert.equal(hits[0].queryEnd, GFP.length);
});

test('a few point mutations do not lose the hit', () => {
  const mutated = GFP.split('');
  for (const at of [100, 250, 400, 600]) mutated[at] = mutated[at] === 'A' ? 'C' : 'A';
  const hits = search(INDEX, mutated.join(''));
  assert.equal(hits.length, 1);
  assert.ok(hits[0].identity > 0.99 && hits[0].identity < 1, `identity ${hits[0].identity}`);
  assert.equal(hits[0].length, GFP.length);
});

test('an unrelated sequence matches nothing', () => {
  assert.deepEqual(search(INDEX, makeSeq(500, 777)), []);
});

test('a query shorter than the k-mer returns nothing rather than throwing', () => {
  assert.deepEqual(search(INDEX, 'ACGT'), []);
});

test('a hit spanning the origin of a circular plasmid is found whole', () => {
  // 200 bp either side of position 0.
  const across = PLASMID_A.slice(PLASMID_A.length - 200) + PLASMID_A.slice(0, 200);
  const hits = search(INDEX, across);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].name, 'pBackbone');
  assert.equal(hits[0].length, 400, 'one hit, not two halves either side of the join');
});

test('the same query against a linear record is cut at the ends, as it should be', () => {
  const linear = buildIndex([{ id: 'a', name: 'pBackbone', sequence: PLASMID_A, topology: 'linear' }]);
  const across = PLASMID_A.slice(PLASMID_A.length - 200) + PLASMID_A.slice(0, 200);
  const hits = search(linear, across);
  // Two separate segments: the end of the record and the start of it.
  assert.equal(hits.length, 2);
  assert.ok(hits.every(h => h.length === 200));
});

test('an insertion splits one hit into two segments, which is the ungapped limit', () => {
  const withInsert = GFP.slice(0, 300) + makeSeq(60, 555) + GFP.slice(300);
  const hits = search(INDEX, withInsert);
  assert.equal(hits.length, 2, 'the two flanks either side of the insertion');
  const lengths = hits.map(h => h.length).sort((a, b) => a - b);
  assert.deepEqual(lengths, [300, 420]);
  // Both land on the same plasmid, and their subject coordinates are contiguous
  // even though the query coordinates are not.
  assert.ok(hits.every(h => h.name === 'pGFP'));
  const bySubject = [...hits].sort((a, b) => a.subjectStart - b.subjectStart);
  assert.equal(bySubject[1].subjectStart, bySubject[0].subjectEnd + 1);
});

test('"you already have this" fires on a near-identical full-length match', () => {
  const nearly = B_WITH_GFP.slice(0, 500) + (B_WITH_GFP[500] === 'A' ? 'C' : 'A') + B_WITH_GFP.slice(501);
  const { alreadyHave } = searchLibrary(INDEX, nearly);
  assert.ok(alreadyHave, 'a one-base difference over 3.1 kb is the same plasmid');
  assert.equal(alreadyHave.name, 'pGFP');
  assert.ok(alreadyHave.coverage >= 0.95);
  assert.ok(alreadyHave.identity >= 0.98);
});

test('it does not fire for a fragment that merely occurs in a library plasmid', () => {
  // GFP is a real, perfect hit — but it covers a fifth of pGFP and is not it.
  const { hits, alreadyHave } = searchLibrary(INDEX, GFP + makeSeq(2000, 888));
  assert.ok(hits.length >= 1);
  assert.equal(alreadyHave, undefined);
});

test('the identity floor is applied, not just computed', () => {
  const noisy = GFP.split('');
  for (let i = 0; i < noisy.length; i += 3) noisy[i] = 'A';   // ~50% identity
  assert.deepEqual(search(INDEX, noisy.join(''), { minIdentity: 0.95 }), []);
});

test('the length floor is applied', () => {
  const short = GFP.slice(0, 25);
  assert.deepEqual(search(INDEX, short, { minLength: 30 }), []);
  assert.equal(search(INDEX, short, { minLength: 20 }).length, 1);
});

test('a repetitive k-mer is masked rather than seeding a million extensions', () => {
  const repeat = 'ACGTACGTAC'.repeat(300);   // 3 kb of one 10-mer
  const idx = buildIndex([{ id: 'r', name: 'repeats', sequence: repeat, topology: 'linear' }]);
  assert.ok(idx.masked > 0, 'the repeated k-mers were dropped');
  // And the index still works for anything non-repetitive.
  const mixed = buildIndex([{ id: 'r', name: 'repeats', sequence: repeat + PLASMID_A, topology: 'linear' }]);
  const hits = search(mixed, PLASMID_A.slice(100, 400));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].length, 300);
});

test('searching a realistic library stays fast', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: String(i), name: `p${i}`, sequence: makeSeq(5000, i + 100), topology: 'circular' as const,
  }));
  many[137].sequence = many[137].sequence.slice(0, 1000) + GFP + many[137].sequence.slice(1000);
  const big = buildIndex(many);
  const hits = search(big, GFP);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'p137');
  assert.equal(hits[0].subjectStart, 1001);
});
