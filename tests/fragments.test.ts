import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepared, bluntEnds, dephosphorylate, phosphorylate, ligationCheck, canSelfClose,
  annealOligos, partialDigestCircular, strandCuts, digestToFragments,
} from '../src/lib/fragments.ts';
import { ENZYMES } from '../src/lib/restrictionEnzymes.ts';
import { blunt, sticky, type Fragment } from '../src/lib/assembly.ts';
import { revComp } from '../src/lib/alignment.ts';

const frag = (seq: string, left = blunt(), right = blunt()): Fragment =>
  ({ id: 'f', name: 'f', seq, left, right });

describe('blunting', () => {
  test("filling a 5′ overhang keeps its bases, at both ends", () => {
    // An EcoRI fragment: AATT protruding on the top strand at the left, and on
    // the bottom at the right. Filled, the duplex is four bases longer at each.
    const f = prepared(frag('GCGCGC', sticky("5'", 'AATT'), sticky("5'", 'AATT')));
    const r = bluntEnds(f);
    assert.equal(r.fragment.seq, 'AATT' + 'GCGCGC' + revComp('AATT'));
    assert.deepEqual(r.change, { left: 4, right: 4 });
    assert.equal(r.fragment.left.type, 'blunt');
    assert.equal(r.fragment.right.type, 'blunt');
  });

  test("chewing a 3′ overhang back loses its bases", () => {
    // A PstI-style end: ACGT protruding at the 3' side.
    const f = prepared(frag('ACGTGGGGGGACGT', sticky("3'", 'ACGT'), sticky("3'", 'ACGT')));
    const r = bluntEnds(f);
    assert.equal(r.fragment.seq, 'GGGGGG');
    assert.deepEqual(r.change, { left: -4, right: -4 });
  });

  test('a fragment with one of each gains at one end and loses at the other', () => {
    const f = prepared(frag('AAGGGGTT', sticky("5'", 'CC'), sticky("3'", 'TT')));
    const r = bluntEnds(f);
    assert.equal(r.fragment.seq, 'CC' + 'AAGGGG');
    assert.deepEqual(r.change, { left: 2, right: -2 });
  });

  test('a change that is not a multiple of three is called out as a frame shift', () => {
    const f = prepared(frag('GGGGGG', sticky("5'", 'AATT'), blunt()));
    assert.ok(bluntEnds(f).notes.some(n => /shifts the reading frame/.test(n)));
    const inFrame = prepared(frag('GGGGGG', sticky("5'", 'AAT'), blunt()));
    assert.ok(!bluntEnds(inFrame).notes.some(n => /shifts the reading frame/.test(n)));
  });

  test('a fragment that is already blunt is unchanged', () => {
    const f = prepared(frag('ACGTACGT'));
    const r = bluntEnds(f);
    assert.equal(r.fragment.seq, 'ACGTACGT');
    assert.deepEqual(r.change, { left: 0, right: 0 });
    assert.deepEqual(r.notes, []);
  });
});

describe('phosphates', () => {
  const vector = prepared(frag('GGGGGGGG', sticky("5'", 'AATT'), sticky("5'", 'AATT')));
  const insert = prepared(frag('CCCCCCCC', sticky("5'", 'AATT'), sticky("5'", 'AATT')), false);

  test('a digested vector can close on itself; a dephosphorylated one cannot', () => {
    assert.ok(canSelfClose(vector));
    assert.ok(!canSelfClose(dephosphorylate(vector)));
  });

  test('one phosphate at a join is enough; none is not', () => {
    assert.ok(ligationCheck(vector, insert).joins, 'the vector brings the phosphate');
    const r = ligationCheck(dephosphorylate(vector), insert);
    assert.ok(!r.joins);
    assert.match(r.reason!, /phosphate/);
  });

  test('kinase puts them back, so a PCR product can be ligated', () => {
    assert.ok(ligationCheck(dephosphorylate(vector), phosphorylate(insert)).joins);
  });

  test('geometry is checked before phosphates', () => {
    const other = prepared(frag('TTTT', sticky("5'", 'GATC'), sticky("5'", 'GATC')), false);
    assert.match(ligationCheck(vector, other).reason!, /not complementary/);
  });

  test('blunt ends join only when blunt ligation is asked for', () => {
    const a = prepared(frag('AAAA'));
    assert.ok(!ligationCheck(a, a).joins);
    assert.ok(ligationCheck(a, a, { allowBlunt: true }).joins);
  });
});

describe('annealed oligos', () => {
  test('equal oligos give a blunt duplex', () => {
    const top = 'ACGTACGTACGT';
    const { fragment, error } = annealOligos('o', 'linker', top, revComp(top));
    assert.equal(error, undefined);
    assert.equal(fragment.seq, top);
    assert.equal(fragment.left.type, 'blunt');
    assert.equal(fragment.right.type, 'blunt');
    assert.equal(fragment.phosphate.left, false, 'synthetic oligos arrive unphosphorylated');
  });

  test('a longer top strand gives a 5′ overhang on the left', () => {
    const core = 'GGGGGGGGGG';
    const { fragment } = annealOligos('o', 'adaptor', 'AATT' + core, revComp(core));
    assert.equal(fragment.seq, core);
    assert.deepEqual([fragment.left.type, fragment.left.overhang], ["5'", 'AATT']);
    assert.equal(fragment.right.type, 'blunt');
  });

  test('a longer bottom strand gives a 5′ overhang on the right', () => {
    const core = 'GGGGGGGGGG';
    const { fragment } = annealOligos('o', 'adaptor', core, 'AATT' + revComp(core));
    assert.equal(fragment.seq, core);
    assert.deepEqual([fragment.right.type, fragment.right.overhang], ["5'", 'AATT']);
  });

  test('an adaptor with BamHI ends ligates into a BamHI vector', () => {
    const core = 'GGGGGGGGGG';
    const { fragment } = annealOligos('o', 'adaptor', 'GATC' + core, 'GATC' + revComp(core), true);
    const vector = prepared(frag('TTTTTTTT', sticky("5'", 'GATC'), sticky("5'", 'GATC')));
    assert.ok(ligationCheck(vector, fragment).joins);
    assert.ok(ligationCheck(fragment, vector).joins);
  });

  test('an adaptor overhanging at both ends pairs over its shorter core', () => {
    // The commonest adaptor shape, and the one a full-length search misses.
    const { fragment, error } = annealOligos('o', 'adaptor', 'AATT' + 'GGGGGGGGGG', 'GATC' + revComp('GGGGGGGGGG'));
    assert.equal(error, undefined);
    assert.equal(fragment.seq, 'GGGGGGGGGG');
    assert.deepEqual([fragment.left.type, fragment.left.overhang], ["5'", 'AATT']);
    assert.deepEqual([fragment.right.type, fragment.right.overhang], ["5'", 'GATC']);
  });

  test('oligos that do not pair are refused rather than guessed at', () => {
    // Not a palindrome either way: these two share nothing to pair over.
    const { error } = annealOligos('o', 'bad', 'AAAAAAAAAAAA', 'CCCCCCCCCCCC');
    assert.match(error!, /not complementary/);
  });
});

describe('partial digest of a circle', () => {
  // Three sites on a 300 bp circle, 100 bp apart.
  const seq = 'A'.repeat(100) + 'C'.repeat(100) + 'G'.repeat(100);
  const sites = [0, 100, 200].map(position => ({ position, enzyme: 'XhoI', end: sticky("5'", 'TCGA') }));

  test('every run between any two sites, not only neighbours', () => {
    const products = partialDigestCircular(seq, sites);
    // Three starts x three runs (100, 200, 300 bp).
    assert.equal(products.length, 9);
    const lengths = [...new Set(products.map(p => p.fragment.seq.length))].sort((a, b) => a - b);
    assert.deepEqual(lengths, [100, 200, 300]);
  });

  test('a piece running through the origin is continuous', () => {
    const products = partialDigestCircular(seq, sites);
    const wrapped = products.find(p => p.fragment.seq.startsWith('G') && p.fragment.seq.length === 200)!;
    assert.equal(wrapped.fragment.seq, 'G'.repeat(100) + 'A'.repeat(100));
  });

  test('the full-length linear molecule is among the products', () => {
    const products = partialDigestCircular(seq, sites);
    const whole = products.filter(p => p.fragment.seq.length === 300);
    assert.equal(whole.length, 3, 'one per site, each cut once');
    assert.ok(whole.every(p => p.fragment.left.overhang === 'TCGA'));
  });

  test('no sites, no products', () => {
    assert.deepEqual(partialDigestCircular(seq, []), []);
  });
});

describe('digesting to fragments with real ends', () => {
  const E = (name: string) => {
    const e = ENZYMES[name];
    return { name, pattern: e.pattern, cutBefore: e.cutBefore, cutBottom: e.cutBottom };
  };
  const filler = (n: number, seed: number) => {
    let x = seed; let s = '';
    for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; s += 'ACGT'[(x >> 16) & 3]; }
    return s;
  };

  test("EcoRI leaves a 5′ AATT overhang on both new ends", () => {
    const seq = 'GGGGG' + 'GAATTC' + 'CCCCC';
    const cuts = strandCuts(seq, false, [E('EcoRI')]);
    assert.equal(cuts.length, 1);
    assert.deepEqual([cuts[0].top, cuts[0].bottom], [6, 10]);
    const pieces = digestToFragments(seq, false, cuts);
    assert.equal(pieces.length, 2);
    assert.equal(pieces[0].seq, 'GGGGGG');
    assert.deepEqual([pieces[0].right.type, pieces[0].right.overhang], ["5'", 'AATT']);
    assert.deepEqual([pieces[1].left.type, pieces[1].left.overhang], ["5'", 'AATT']);
    assert.equal(pieces[1].seq, 'CCCCCC');
  });

  test('PstI leaves a 3′ overhang, and the bases of it belong to the top strand on the left piece', () => {
    const seq = 'GGGGG' + 'CTGCAG' + 'CCCCC';
    const [cut] = strandCuts(seq, false, [E('PstI')]);
    assert.ok(cut.top > cut.bottom, 'bottom strand cut first');
    const [left, right] = digestToFragments(seq, false, [cut]);
    assert.deepEqual([left.right.type, left.right.overhang], ["3'", 'TGCA']);
    assert.deepEqual([right.left.type, right.left.overhang], ["3'", 'TGCA']);
  });

  test('a blunt cutter leaves blunt ends', () => {
    const seq = 'GGGGG' + 'GTTAAC' + 'CCCCC'; // HpaI, GTT^AAC
    const pieces = digestToFragments(seq, false, strandCuts(seq, false, [E('HpaI')]));
    assert.equal(pieces.length, 2);
    assert.ok(pieces.every(p => p.left.type === 'blunt' && p.right.type === 'blunt'));
  });

  test('the pieces put back together are the molecule they came from', () => {
    // The round trip is the proof: overhangs written on the wrong strand, or
    // cores that keep bases the overhang already carries, both show up here.
    const seq = filler(200, 11) + 'GAATTC' + filler(300, 12) + 'GGATCC' + filler(150, 13);
    const cuts = strandCuts(seq, false, [E('EcoRI'), E('BamHI')]);
    const pieces = digestToFragments(seq, false, cuts);
    assert.equal(pieces.length, 3);
    const rebuilt = pieces.map((p, i) => (i === 0 ? '' : p.left.overhang) + p.seq).join('');
    assert.equal(rebuilt, seq.toUpperCase());
  });

  test('a circle gives one piece per cut, and they close back into it', () => {
    const seq = filler(100, 21) + 'GAATTC' + filler(120, 22) + 'GAATTC' + filler(80, 23);
    const cuts = strandCuts(seq, true, [E('EcoRI')]);
    assert.equal(cuts.length, 2);
    const pieces = digestToFragments(seq, true, cuts);
    assert.equal(pieces.length, 2);
    const total = pieces.reduce((n, p) => n + p.seq.length + p.left.overhang.length, 0);
    assert.equal(total, seq.length, 'every base is in exactly one piece');
  });

  test('a site on the bottom strand cuts the mirror image of one on the top', () => {
    // BsaI reads GGTCTC and cuts downstream; read on the other strand it cuts
    // upstream by the same offsets, which is what Golden Gate depends on.
    const seq = filler(60, 31) + 'GAGACC' + filler(60, 32);
    const [cut] = strandCuts(seq, false, [E('BsaI')]);
    const site = seq.indexOf('GAGACC');
    assert.equal(cut.top, site - 5);
    assert.equal(cut.bottom, site - 1);
  });

  test('an uncut molecule comes back whole', () => {
    const seq = filler(100, 41);
    const pieces = digestToFragments(seq, false, strandCuts(seq, false, [E('EcoRI')]));
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].seq, seq.toUpperCase());
  });

  test('digest products carry phosphates, so they ligate', () => {
    const seq = 'GGGGG' + 'GAATTC' + filler(50, 51) + 'GAATTC' + 'CCCCC';
    const pieces = digestToFragments(seq, false, strandCuts(seq, false, [E('EcoRI')]));
    assert.ok(pieces[1].phosphate.left && pieces[1].phosphate.right);
    assert.ok(ligationCheck(pieces[1], pieces[1]).joins, 'EcoRI ends anneal to each other');
  });
});
