import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findAttSites, gatewayReaction, ATT_CORES } from '../src/lib/gateway.ts';
import { revComp } from '../src/lib/alignment.ts';

/**
 * Published att site sequences, used to build the inputs and to check what
 * comes out. The point of the tests is not to re-assert the reference data --
 * it is to show that recombining a real attB site with a real attP site
 * reconstructs the published attL and attR, which is a claim the model either
 * satisfies or does not.
 */
const attB1 = 'CAAGTTTGTACAAAAAAGCAGGCT';
const attB2 = 'ACCCAGCTTTCTTGTACAAAGTGG';
const attP1 = 'AAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACACATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATG';
const attP2 = 'AATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATAAGCAATGCTTTCTTATAATGCCAACTTTGTACAAGAAAGCTGAACGAGAAACG';

const filler = (seed: number, n: number) => {
  let x = seed * 7919 + 13;
  let out = '';
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out += 'ACGT'[(x >>> 16) % 4]; }
  return out;
};

describe('att cores', () => {
  test('the two families differ at exactly one base', () => {
    // That single position is the whole of Gateway's directionality: it is why
    // attB1 recombines with attP1 and never with attP2.
    const a = ATT_CORES[1], b = ATT_CORES[2];
    assert.equal(a.length, b.length);
    assert.equal([...a].filter((c, i) => c !== b[i]).length, 1);
  });

  test('published att sites all carry their family core', () => {
    assert.ok(attB1.includes(ATT_CORES[1]));
    assert.ok(attP1.includes(ATT_CORES[1]));
    // The 2-family sites are conventionally written on the other strand.
    assert.ok(attB2.includes(revComp(ATT_CORES[2])));
    assert.ok(attP2.includes(ATT_CORES[2]));
  });
});

describe('finding att sites', () => {
  test('a site is found on either strand', () => {
    const fwd = findAttSites(filler(1, 50) + attB1 + filler(2, 50));
    assert.equal(fwd.length, 1);
    assert.equal(fwd[0].family, 1);
    assert.equal(fwd[0].strand, 1);

    const rev = findAttSites(filler(3, 50) + attB2 + filler(4, 50));
    assert.equal(rev.length, 1);
    assert.equal(rev[0].family, 2);
    assert.equal(rev[0].strand, -1);
  });

  test('a sequence with no att site yields nothing', () => {
    assert.deepEqual(findAttSites(filler(5, 400)), []);
  });

  test('a site spanning the origin of a circle is found', () => {
    const half = Math.floor(attB1.length / 2);
    const circle = attB1.slice(half) + filler(6, 200) + attB1.slice(0, half);
    assert.equal(findAttSites(circle, false).length, 0);
    assert.equal(findAttSites(circle, true).length, 1);
  });
});

describe('the BP reaction', () => {
  const gene = filler(10, 600);
  const ccdB = filler(11, 1500);
  const backbone = filler(12, 2000);

  // A PCR product with attB ends, and a donor plasmid with attP ends.
  const pcr = { name: 'attB-gene', sequence: attB1 + gene + attB2, circular: false };
  const pDONR = { name: 'pDONR', sequence: attP1 + ccdB + attP2 + backbone, circular: true };

  test('it produces an entry clone and a byproduct', () => {
    const r = gatewayReaction(pcr, pDONR, 'BP');
    assert.deepEqual(r.problems, []);
    assert.ok(r.product, 'no entry clone');
    assert.ok(r.byproduct, 'no byproduct');
    assert.equal(r.product!.circular, true);
    assert.match(r.product!.sites, /attL1/);
    assert.match(r.byproduct!.sites, /attR1/);
  });

  test('no nucleotide is gained or lost', () => {
    // The defining property of the reaction, and the reason to model it
    // exactly rather than approximately.
    const r = gatewayReaction(pcr, pDONR, 'BP');
    assert.equal(
      r.product!.sequence.length + r.byproduct!.sequence.length,
      pcr.sequence.length + pDONR.sequence.length,
    );
  });

  test('the gene ends up in the entry clone and the ccdB cassette does not', () => {
    const r = gatewayReaction(pcr, pDONR, 'BP');
    const entry = r.product!.sequence;
    assert.ok(entry.includes(gene), 'the insert should be in the entry clone');
    assert.ok(!entry.includes(ccdB), 'the ccdB cassette should have left');
    assert.ok(entry.includes(backbone), 'the donor backbone is what carries it');
  });

  test('the entry clone carries the published attL1 junction', () => {
    // attL is the left arm of attP joined to the right arm of attB across the
    // shared core. If the crossover is placed correctly this falls out; if it
    // is off by even a base, it does not.
    const r = gatewayReaction(pcr, pDONR, 'BP');
    const attL1 = attP1.slice(0, attP1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length)
                + attB1.slice(attB1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length);
    const doubled = r.product!.sequence + r.product!.sequence;
    assert.ok(doubled.includes(attL1), 'the attL1 junction was not reconstructed');
  });

  test('the byproduct carries the published attR1 junction', () => {
    const r = gatewayReaction(pcr, pDONR, 'BP');
    const attR1 = attB1.slice(0, attB1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length)
                + attP1.slice(attP1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length);
    assert.ok(r.byproduct!.sequence.includes(attR1), 'the attR1 junction was not reconstructed');
  });

  test('a missing site is named rather than guessed around', () => {
    const noSites = { name: 'plain-pcr', sequence: filler(20, 700), circular: false };
    const r = gatewayReaction(noSites, pDONR, 'BP');
    assert.equal(r.product, null);
    assert.ok(r.problems.some(p => /attB1/.test(p)));
    assert.ok(r.problems.some(p => /attB2/.test(p)));
  });

  test('a duplicated site is refused, because the reaction would not be directional', () => {
    const twice = { name: 'two-B1', sequence: attB1 + filler(21, 300) + attB1 + filler(22, 300) + attB2, circular: false };
    const r = gatewayReaction(twice, pDONR, 'BP');
    assert.equal(r.product, null);
    assert.ok(r.problems.some(p => /2 attB1 sites/.test(p)), r.problems.join(' | '));
  });
});

describe('the LR reaction', () => {
  const gene = filler(30, 600);
  const ccdB = filler(31, 1400);
  const kanBackbone = filler(32, 1800);
  const ampBackbone = filler(33, 2200);

  // The entry clone from a BP reaction, and a destination vector.
  const attL1 = attP1.slice(0, attP1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length)
              + attB1.slice(attB1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length);
  const i2 = attB2.indexOf(revComp(ATT_CORES[2]));
  const j2 = attP2.indexOf(ATT_CORES[2]);
  const attL2 = attB2.slice(0, i2) + attP2.slice(j2);
  const attR1 = attB1.slice(0, attB1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length)
              + attP1.slice(attP1.indexOf(ATT_CORES[1]) + ATT_CORES[1].length);
  const attR2 = attP2.slice(0, j2) + attB2.slice(i2);

  const entry = { name: 'pENTR-gene', sequence: attL1 + gene + attL2 + kanBackbone, circular: true };
  const dest = { name: 'pDEST', sequence: attR1 + ccdB + attR2 + ampBackbone, circular: true };

  test('it moves the gene onto the destination backbone', () => {
    const r = gatewayReaction(entry, dest, 'LR');
    assert.deepEqual(r.problems, []);
    const expr = r.product!.sequence;
    assert.ok(expr.includes(gene), 'the gene should reach the expression clone');
    assert.ok(expr.includes(ampBackbone), 'on the destination backbone');
    assert.ok(!expr.includes(ccdB), 'the ccdB cassette should be gone');
    assert.ok(!expr.includes(kanBackbone), 'the entry backbone stays behind');
  });

  test('both products are circular and nothing is lost', () => {
    const r = gatewayReaction(entry, dest, 'LR');
    assert.equal(r.product!.circular, true);
    assert.equal(r.byproduct!.circular, true);
    assert.equal(
      r.product!.sequence.length + r.byproduct!.sequence.length,
      entry.sequence.length + dest.sequence.length,
    );
  });

  test('the products are labelled attB and attP, as an LR reaction gives', () => {
    const r = gatewayReaction(entry, dest, 'LR');
    assert.match(r.product!.sites, /attB1/);
    assert.match(r.byproduct!.sites, /attP1/);
  });
});
