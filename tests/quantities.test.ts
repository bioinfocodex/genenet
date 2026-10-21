import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuantity, convert, base, humanise, format, round,
  perLitre, formatConcentration, amountIn, volumeFor,
  dsDnaMolarMass, ssDnaMolarMass, molesFrom, massFrom, PHOSPHATE,
  inStockUnits, remaining, canTake,
  type Quantity, type Concentration, type Stock,
} from '../src/lib/quantities.ts';

const q = (value: number, unit: string): Quantity => ({ value, unit });
const near = (got: number | null, want: number, tol = 1e-9, what = '') =>
  assert.ok(got !== null && Math.abs(got - want) <= tol, `${what} got ${got}, wanted ${want}`);

describe('reading a quantity off a tube', () => {
  test('the forms a person actually types', () => {
    assert.deepEqual(parseQuantity('50 µL'), q(50, 'uL'));
    assert.deepEqual(parseQuantity('50uL'), q(50, 'uL'));
    assert.deepEqual(parseQuantity('0.5 mL'), q(0.5, 'mL'));
    assert.deepEqual(parseQuantity('2e3 ng'), q(2000, 'ng'));
    assert.deepEqual(parseQuantity('  1.5mg '), q(1.5, 'mg'));
    assert.deepEqual(parseQuantity('100 micrograms'), q(100, 'ug'));
  });

  test('both micro signs are the same unit', () => {
    // U+00B5 MICRO SIGN and U+03BC GREEK SMALL LETTER MU look identical and
    // arrive from instrument exports and pasted protocols in both forms.
    assert.deepEqual(parseQuantity('5 µL'), q(5, 'uL'));
    assert.deepEqual(parseQuantity('5 μL'), q(5, 'uL'));
  });

  test('a bare number is a count, which is what typing one means', () => {
    assert.deepEqual(parseQuantity('3'), q(3, 'item'));
    assert.deepEqual(parseQuantity('3 tubes'), q(3, 'item'));
  });

  test('a unit nobody knows is refused rather than guessed at', () => {
    assert.equal(parseQuantity('5 smoots'), null);
    assert.equal(parseQuantity('5 M'), null, 'M is a concentration, not an amount');
    assert.equal(parseQuantity(''), null);
    assert.equal(parseQuantity('abc'), null);
  });
});

describe('converting between units', () => {
  test('up and down the ladder', () => {
    // Compared with a tolerance, and that is the design rather than a
    // concession: these keep full precision and round only where a number is
    // shown, so 1 mL converts to 1000.0000000000001 µL and formats as 1000.
    near(convert(q(1, 'mL'), 'uL')!.value, 1000, 1e-9);
    assert.equal(format(convert(q(1, 'mL'), 'uL')!, { humanise: false }), '1000 µL');
    near(convert(q(1500, 'ng'), 'ug')!.value, 1.5);
    near(convert(q(1, 'mol'), 'pmol')!.value, 1e12, 1);
  });

  test('across dimensions it refuses, because there is no answer', () => {
    assert.equal(convert(q(1, 'mL'), 'mg'), null);
    assert.equal(convert(q(1, 'item'), 'uL'), null);
    assert.equal(convert(q(1, 'uL'), 'nonsense'), null);
  });

  test('the base is litres, grams, moles or items', () => {
    near(base(q(50, 'uL'))!, 50e-6);
    near(base(q(2, 'mg'))!, 2e-3);
    assert.equal(base(q(3, 'item')), 3);
  });
});

describe('writing it the way a person would', () => {
  test('the unit that puts the number between 1 and 1000', () => {
    assert.equal(humanise(q(0.000005, 'L')).unit, 'uL');
    assert.equal(humanise(q(1500, 'ng')).unit, 'ug');
    assert.equal(humanise(q(0.9, 'ug')).unit, 'ng');
    assert.equal(format(q(0.000005, 'L')), '5 µL');
    assert.equal(format(q(1500, 'ng')), '1.5 µg');
    assert.equal(format(q(0.9, 'ug')), '900 ng');
  });

  test('an amount below the finest unit still gets that unit, not scientific notation', () => {
    assert.equal(humanise(q(0.0001, 'nL')).unit, 'nL');
  });

  test('nothing is nothing, in the unit it was recorded in', () => {
    assert.equal(format(q(0, 'uL')), '0 µL');
  });

  test('counts are counted, and one of them is singular', () => {
    assert.equal(format(q(1, 'item')), '1 item');
    assert.equal(format(q(81, 'item')), '81 items');
  });

  test('four significant figures, with the trailing zeros gone', () => {
    assert.equal(round(45.000000000000004), 45);
    assert.equal(round(1 / 3), 0.3333);
    assert.equal(round(123456), 123500);
    assert.equal(round(0), 0);
  });
});

describe('concentration', () => {
  test('a nanogram per microlitre is a microgram per millilitre', () => {
    // The same bottle, two labels. If these did not agree, every number
    // downstream would depend on which way somebody happened to write it.
    const a: Concentration = { value: 1, per: 'ng', volume: 'uL' };
    const b: Concentration = { value: 1, per: 'ug', volume: 'mL' };
    near(perLitre(a)!, perLitre(b)!, 1e-12);
    near(perLitre(a)!, 1e-3, 1e-12, 'one gram per litre is 1000 ng/µL');
  });

  test('molar is written the way a bottle is labelled', () => {
    assert.equal(formatConcentration({ value: 1, per: 'mol', volume: 'L' }), '1 M');
    assert.equal(formatConcentration({ value: 100, per: 'umol', volume: 'L' }), '100 µM');
    assert.equal(formatConcentration({ value: 200, per: 'ng', volume: 'uL' }), '200 ng/µL');
  });

  test('fifty microlitres at two hundred nanograms per microlitre is ten micrograms', () => {
    const c: Concentration = { value: 200, per: 'ng', volume: 'uL' };
    const got = amountIn(q(50, 'uL'), c)!;
    assert.equal(format(got), '10 µg');
  });

  test('and ten micrograms of it is fifty microlitres', () => {
    const c: Concentration = { value: 200, per: 'ng', volume: 'uL' };
    assert.equal(format(volumeFor(q(10, 'ug'), c)!), '50 µL');
  });

  test('the two are each other\'s inverse at any scale', () => {
    const c: Concentration = { value: 1.37, per: 'mg', volume: 'mL' };
    const there = amountIn(q(2.5, 'mL'), c)!;
    const back = volumeFor(there, c)!;
    near(base(back)!, base(q(2.5, 'mL'))!, 1e-12);
  });

  test('asking for a volume with the wrong dimension gets nothing, not a wrong number', () => {
    const c: Concentration = { value: 200, per: 'ng', volume: 'uL' };
    assert.equal(amountIn(q(10, 'ug'), c), null, 'a mass is not a volume');
    assert.equal(volumeFor(q(10, 'uL'), c), null, 'a volume is not a mass');
    assert.equal(volumeFor(q(10, 'pmol'), c), null, 'moles need a molar mass, not a mass concentration');
  });
});

describe('molar mass of DNA', () => {
  /*
   * Checked against Biopython's SeqUtils.molecular_weight, which sums the
   * actual bases. The agreements and the disagreements are both deliberate,
   * and the disagreement is the interesting one.
   */
  test('a double-stranded 20-mer agrees with summing its bases to 0.02%', () => {
    // Biopython, double_stranded=True on ACGT x5: 12393.90.
    const got = dsDnaMolarMass(20)!;
    assert.ok(Math.abs(got - 12393.9) / 12393.9 < 0.0002, `got ${got}`);
  });

  test('a circle has no ends, so it loses the end correction', () => {
    near(dsDnaMolarMass(1000)! - dsDnaMolarMass(1000, true)!, 36.04, 1e-6);
    // On a plasmid that is a rounding error; on a 20-mer it is not.
    assert.ok(36.04 / dsDnaMolarMass(2686, true)! < 0.0001);
    assert.ok(36.04 / dsDnaMolarMass(20, true)! > 0.002);
  });

  test('a single strand is summed from its own bases, not averaged', () => {
    // A 20-mer of all G against one of all C: 800 g/mol apart, 13% of the
    // mass. An average per base would call them the same molecule.
    const allG = ssDnaMolarMass('G'.repeat(20))!;
    const allC = ssDnaMolarMass('C'.repeat(20))!;
    assert.ok(allG - allC > 790 && allG - allC < 810, `${allG} vs ${allC}`);
  });

  test('a synthesised oligo is the 5\'-OH form, 80 daltons under the phosphorylated one', () => {
    // Biopython reports 6282.15 for A20, which is the 5'-phosphate form; a
    // synthesiser ships 5'-OH unless asked otherwise. The two differ by HPO3.
    const oh = ssDnaMolarMass('A'.repeat(20))!;
    const p = ssDnaMolarMass('A'.repeat(20), { phosphorylated: true })!;
    near(p - oh, PHOSPHATE, 1e-9);
    /*
     * Biopython reports 6282.15 against 6282.22 here -- 0.001%, and the
     * difference is the constants rather than the chemistry. The per-base
     * figures are the rounded ones oligo suppliers publish; Biopython sums
     * exact atomic masses. Matching the supplier is the more useful of the
     * two when the number is going to be compared against a synthesis report.
     */
    near(p, 6282.15, 0.1, 'the phosphorylated form matches Biopython');
    near(oh, 6202.24, 0.1, 'and the shipped form is 79.98 lighter');
  });

  test('a length that is not a length has no mass', () => {
    assert.equal(dsDnaMolarMass(0), null);
    assert.equal(dsDnaMolarMass(-5), null);
    assert.equal(ssDnaMolarMass(''), null);
    assert.equal(ssDnaMolarMass('   '), null);
  });

  test('nanograms become picomoles and back', () => {
    const mm = dsDnaMolarMass(2686, true)!; // pUC19
    const moles = molesFrom(q(100, 'ng'), mm)!;
    // 100 ng of a 2,686 bp plasmid is about 0.06 pmol.
    assert.equal(format(moles).endsWith('fmol') || format(moles).endsWith('pmol'), true, format(moles));
    near(base(massFrom(moles, mm)!)!, 100e-9, 1e-15);
  });

  test('a molar mass that is not one is refused', () => {
    assert.equal(molesFrom(q(1, 'ug'), 0), null);
    assert.equal(molesFrom(q(1, 'uL'), 650), null, 'a volume has no molar mass');
  });
});

describe('taking some out of a tube', () => {
  const tube: Stock = {
    initial: q(50, 'uL'),
    concentration: { value: 200, per: 'ng', volume: 'uL' },
  };

  test('taking a volume leaves the rest, and the concentration is unchanged', () => {
    const left = remaining(tube, [{ amount: q(5, 'uL') }, { amount: q(10, 'uL') }]);
    assert.equal(format(left.left), '35 µL');
    assert.equal(left.empty, false);
    assert.deepEqual(left.unusable, []);
  });

  test('taking a mass comes off as the volume that held it', () => {
    // 1 µg of a 200 ng/µL stock is 5 µL. Recording the use as a mass and
    // recording it as a volume have to leave the same tube behind.
    const byMass = remaining(tube, [{ amount: q(1, 'ug') }]);
    const byVolume = remaining(tube, [{ amount: q(5, 'uL') }]);
    near(base(byMass.left)!, base(byVolume.left)!, 1e-15);
    assert.equal(format(byMass.left), '45 µL');
  });

  test('without a concentration, a mass cannot come out of a volume, and it says why', () => {
    const unlinked: Stock = { initial: q(50, 'uL') };
    const left = remaining(unlinked, [{ amount: q(1, 'ug') }]);
    assert.equal(format(left.left), '50 µL', 'nothing is subtracted on a guess');
    assert.equal(left.unusable.length, 1);
    assert.match(left.unusable[0].why, /no concentration/);
  });

  test('a tube emptied exactly is empty, not seven zeptolitres', () => {
    // Floating point over factors spanning fifteen orders of magnitude: five
    // lots of 10 µL out of 50 µL leaves 7.1e-21 L unless something says
    // otherwise, and a tube with that in it is one somebody goes looking for.
    const draws = Array.from({ length: 5 }, () => ({ amount: q(10, 'uL') }));
    const left = remaining(tube, draws);
    assert.equal(left.empty, true);
    assert.equal(left.left.value, 0);
    assert.equal(format(left.left), '0 µL');
  });

  test('taking more than there ever was is reported, not clamped away', () => {
    // A real event: the tube was mislabelled, or a use was entered twice.
    // Showing nought left would hide the only evidence of it.
    const left = remaining(tube, [{ amount: q(60, 'uL') }]);
    assert.equal(left.empty, true);
    assert.ok(left.overdrawn, 'the overdraw is reported');
    assert.equal(format(left.overdrawn!), '10 µL');
  });

  test('a stock of things is counted down by things', () => {
    const box: Stock = { initial: q(81, 'item') };
    const left = remaining(box, [{ amount: q(1, 'item') }, { amount: q(3, 'item') }]);
    assert.equal(format(left.left), '77 items');
  });

  test('a volume cannot be taken out of a count, and the reason names both', () => {
    const box: Stock = { initial: q(81, 'item') };
    const left = remaining(box, [{ amount: q(5, 'uL') }]);
    assert.equal(left.unusable.length, 1);
    assert.match(left.unusable[0].why, /number of things/);
  });

  test('moles come out of a volume when both links are recorded', () => {
    // Needs the concentration to reach a mass and the molar mass to reach
    // moles from it. Either alone is a dead end.
    const oligo: Stock = {
      initial: q(100, 'uL'),
      concentration: { value: 100, per: 'ug', volume: 'mL' },
      molarMass: ssDnaMolarMass('ATGCGTACGTTAGCCATGCA')!,
    };
    const left = remaining(oligo, [{ amount: q(100, 'pmol') }]);
    assert.deepEqual(left.unusable, []);
    assert.ok(base(left.left)! < base(q(100, 'uL'))!, 'something came out');

    const noMolarMass: Stock = { ...oligo, molarMass: null };
    assert.equal(remaining(noMolarMass, [{ amount: q(100, 'pmol') }]).unusable.length, 1);
  });

  test('an unusable use does not quietly subtract something else', () => {
    const left = remaining(tube, [{ amount: q(5, 'uL') }, { amount: q(2, 'item') }]);
    assert.equal(format(left.left), '45 µL', 'only the volume came off');
    assert.equal(left.unusable.length, 1);
  });

  test('converting a use into the stock\'s units says what it could not do', () => {
    const r = inStockUnits(q(1, 'ug'), { initial: q(50, 'uL') });
    assert.ok('why' in r);
  });
});

describe('whether one more use would fit', () => {
  const tube: Stock = { initial: q(50, 'uL'), concentration: { value: 200, per: 'ng', volume: 'uL' } };

  test('it fits until it does not', () => {
    assert.deepEqual(canTake(tube, [], q(50, 'uL')), { ok: true }, 'exactly all of it fits');
    assert.deepEqual(canTake(tube, [{ amount: q(45, 'uL') }], q(5, 'uL')), { ok: true });

    const no = canTake(tube, [{ amount: q(45, 'uL') }], q(6, 'uL'));
    assert.equal(no.ok, false);
    assert.match((no as { why: string }).why, /Only 5 µL is left/);
  });

  test('a use expressed another way is checked the same', () => {
    // 2 µg of a 200 ng/µL stock is 10 µL, which does not fit in 5 µL.
    const no = canTake(tube, [{ amount: q(45, 'uL') }], q(2, 'ug'));
    assert.equal(no.ok, false);
  });

  test('taking nothing is not a use', () => {
    assert.equal(canTake(tube, [], q(0, 'uL')).ok, false);
    assert.equal(canTake(tube, [], q(-5, 'uL')).ok, false);
  });

  test('a use that cannot be linked is refused with its own reason', () => {
    const r = canTake({ initial: q(50, 'uL') }, [], q(1, 'ug'));
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /no concentration/);
  });
});
