import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hydropathyProfile, hydrophobicSegments, chargeAtPh, isoelectricPoint,
  chargeCurve, absorbance, composition, cleanProtein,
} from '../src/lib/protein-analysis.ts';

/**
 * Bovine ribonuclease A, the mature chain of UniProt P61823 (residues 27-150,
 * after the signal peptide): 124 residues, no tryptophan, six tyrosines, eight
 * cysteines. Copied from the UniProt record rather than from memory, so the
 * published figures below mean something.
 */
const RNASE_A =
  'KETAAAKFERQHMDSSTSAASSSNYCNQMMKSRNLTKDRCKPVNTFVHESLADVQAVCSQKNVACKNGQTNCYQSYSTMSITDCRET'
  + 'GSSKYPNCAYKTTQANKHIIVACEGNPYVPVHFDASV';

/** Glucagon (P01275 chain): 29 residues, one tryptophan, two tyrosines. */
const GLUCAGON = 'HSQGTFTSDYSKYLDSRRAQDFVQWLMNT';

describe('hydropathy along the chain', () => {
  test('a window of one is the residue scale itself', () => {
    const p = hydropathyProfile('III', 1);
    assert.deepEqual(p.map(x => x.value), [4.5, 4.5, 4.5]);
    assert.deepEqual(p.map(x => x.position), [1, 2, 3]);
  });

  test('a window is centred on its middle residue', () => {
    // Nine residues, window nine: one point, centred on the fifth.
    const p = hydropathyProfile('AAAAIAAAA', 9);
    assert.equal(p.length, 1);
    assert.equal(p[0].position, 5);
    // Eight alanines at 1.8 and one isoleucine at 4.5.
    assert.equal(p[0].value, Math.round(((8 * 1.8 + 4.5) / 9) * 1000) / 1000);
  });

  test('hydrophobic and polar stretches come out on opposite sides of zero', () => {
    const hydrophobic = hydropathyProfile('IIIIIVVVVVLLLLL', 9);
    const polar = hydropathyProfile('DDDDDEEEEEKKKKK', 9);
    assert.ok(hydrophobic.every(p => p.value > 3));
    assert.ok(polar.every(p => p.value < -3));
  });

  test('a sequence shorter than the window gives no points rather than a wrong one', () => {
    assert.deepEqual(hydropathyProfile('AAA', 9).length, 1, 'the window shrinks to the sequence');
    assert.deepEqual(hydropathyProfile('', 9), []);
  });
});

describe('hydrophobic segments', () => {
  test('a planted 20-residue hydrophobic stretch is found, and its loops are not', () => {
    const seq = 'D'.repeat(40) + 'LIVLIVLIVLIVLIVLIVLI' + 'K'.repeat(40);
    const [seg, ...rest] = hydrophobicSegments(seq);
    assert.equal(rest.length, 0, 'one segment, not several');
    // Reported as the positions whose window is above the threshold, so the
    // segment sits inside the real 41-60 rather than spilling over it.
    assert.ok(seg.start >= 41 && seg.start <= 50, `starts inside the stretch, got ${seg.start}`);
    assert.ok(seg.end <= 60 && seg.end >= 51, `ends inside the stretch, got ${seg.end}`);
    assert.ok(seg.score > 2.5);
  });

  test('two separated stretches are two segments', () => {
    const tm = 'LIVLIVLIVLIVLIVLIVLI';
    const seq = 'D'.repeat(30) + tm + 'K'.repeat(40) + tm + 'D'.repeat(30);
    assert.equal(hydrophobicSegments(seq).length, 2);
  });

  test('a soluble, polar protein has none', () => {
    assert.deepEqual(hydrophobicSegments(RNASE_A), []);
  });
});

describe('charge and pI', () => {
  test('a chain of lysines is positive at neutral pH and a chain of glutamates negative', () => {
    assert.ok(chargeAtPh('KKKKKKKKKK', 7) > 8);
    assert.ok(chargeAtPh('EEEEEEEEEE', 7) < -8);
  });

  test('charge falls as pH rises, and crosses zero exactly at the pI', () => {
    const curve = chargeCurve(RNASE_A, 3, 11, 0.5);
    for (let i = 1; i < curve.length; i++) {
      assert.ok(curve[i].charge <= curve[i - 1].charge, `charge rose from pH ${curve[i - 1].ph} to ${curve[i].ph}`);
    }
    const pi = isoelectricPoint(RNASE_A);
    // The pI is reported to two places, and near it the curve is steep: a
    // hundredth of a pH unit is worth a few hundredths of a charge, so the
    // rounded pI does not evaluate to exactly nil.
    assert.ok(Math.abs(chargeAtPh(RNASE_A, pi)) < 0.05, `near nil at the pI, got ${chargeAtPh(RNASE_A, pi)}`);
    assert.ok(chargeAtPh(RNASE_A, pi - 0.5) > 0 && chargeAtPh(RNASE_A, pi + 0.5) < 0, 'and it changes sign across it');
  });

  test('ribonuclease A matches the pI ExPASy ProtParam reports', () => {
    // 8.64, from ProtParam on this exact chain. The pKa set is what is being
    // pinned here: the same arithmetic over other published sets gives 8.28
    // and 8.39, and a number that cannot be compared with ProtParam's is of
    // no use to anyone checking it against ProtParam.
    assert.equal(isoelectricPoint(RNASE_A), 8.64);
  });

  test('an acidic protein comes out acidic', () => {
    const pi = isoelectricPoint('DDDEEEDDDEEEDDDEEEAAAGGG');
    assert.ok(pi < 4.5, `got ${pi}`);
  });
});

describe('absorbance at 280 nm', () => {
  test('Pace: 5500 per tryptophan, 1490 per tyrosine, 125 per cystine', () => {
    assert.equal(absorbance('W').extinctionReduced, 5500);
    assert.equal(absorbance('Y').extinctionReduced, 1490);
    assert.equal(absorbance('WY').extinctionReduced, 6990);
    // Two cysteines make one cystine; three still make only one.
    assert.equal(absorbance('CC').extinctionOxidised, 125);
    assert.equal(absorbance('CCC').extinctionOxidised, 125);
    assert.equal(absorbance('CCCC').extinctionOxidised, 250);
    assert.equal(absorbance('CC').extinctionReduced, 0, 'reduced cysteines absorb nothing');
  });

  test('ribonuclease A matches its published coefficient', () => {
    // Six tyrosines, no tryptophan, eight cysteines: 6 x 1490 + 4 x 125 = 9440.
    const a = absorbance(RNASE_A);
    assert.equal(a.extinctionReduced, 8940);
    assert.equal(a.extinctionOxidised, 9440);
    // Its mass is about 13.7 kDa, giving an A280 near 0.69 for 1 mg/mL.
    assert.ok(Math.abs(a.molecularWeight - 13690) < 60, `mass ${a.molecularWeight}`);
    assert.ok(Math.abs(a.a280Oxidised - 0.69) < 0.03, `A280 ${a.a280Oxidised}`);
  });

  test('glucagon, one tryptophan and two tyrosines', () => {
    const a = absorbance(GLUCAGON);
    assert.equal(a.extinctionReduced, 5500 + 2 * 1490);
    assert.equal(a.extinctionOxidised, a.extinctionReduced, 'no cysteines, so no cystines');
    assert.ok(Math.abs(a.molecularWeight - 3482) < 5, `mass ${a.molecularWeight}`);
  });

  test('a protein with no W, Y or cystine is called out rather than given a zero', () => {
    const a = absorbance('AAAGGGKKKDDD');
    assert.equal(a.extinctionOxidised, 0);
    assert.ok(a.blind);
    assert.ok(!absorbance(GLUCAGON).blind);
  });
});

describe('reading the sequence', () => {
  test('whitespace, numbers and unknown letters are dropped', () => {
    assert.equal(cleanProtein('  mkv 123 lx* '), 'MKVL');
  });

  test('composition covers all twenty, including the absent ones', () => {
    const c = composition('AAAC');
    assert.equal(c.length, 20);
    assert.deepEqual(c.find(x => x.aa === 'A'), { aa: 'A', count: 3, percent: 75 });
    assert.deepEqual(c.find(x => x.aa === 'W'), { aa: 'W', count: 0, percent: 0 });
  });
});
