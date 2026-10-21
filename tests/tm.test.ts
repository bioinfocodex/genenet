import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nnTm, duplexThermo, sodiumEquivalent, PCR_BUFFER } from '../src/lib/tm.ts';

/**
 * Absolute melting temperatures depend on the model, the salt and the
 * concentration, so these pin the behaviour that must hold for any correct
 * nearest-neighbour implementation rather than asserting numbers copied from
 * one calculator.
 */
describe('nearest-neighbour melting temperature', () => {
  test('sequence order changes Tm even at identical composition', () => {
    // The whole reason to use nearest-neighbour rather than GC content:
    // both are 0% GC and 20 nt, but TA stacks are the weakest in DNA.
    const alternating = nnTm('ATATATATATATATATATAT');
    const blocked = nnTm('AATTAATTAATTAATTAATT');
    assert.ok(blocked > alternating + 3, `AATT ${blocked} should exceed ATAT ${alternating} clearly`);
  });

  test('GC content raises Tm', () => {
    assert.ok(nnTm('GCGCGCGCGCGCGCGCGCGC') > nnTm('ATCGATCGATCGATCGATCG'));
    assert.ok(nnTm('ATCGATCGATCGATCGATCG') > nnTm('AAAAAAAAAAAAAAAAAAAA'));
  });

  test('a longer duplex of the same composition melts higher', () => {
    assert.ok(nnTm('ATCGATCGATCGATCGATCG') > nnTm('ATCGATCGAT'));
  });

  test('a typical 20-mer lands where bench experience puts it', () => {
    // 50% GC, 20 nt, 0.25 µM, 50 mM Na+ sits in the low-to-mid fifties on
    // every common calculator. A wider band than that would not be a test.
    const t = nnTm('GCTTACCGATTGCAGTTACC', { magnesium: 0 });
    assert.ok(t > 48 && t < 60, `got ${t} °C`);
  });

  test('Tm rises with salt, monotonically', () => {
    const seq = 'GCTTACCGATTGCAGTTACC';
    const t = [0.01, 0.05, 0.2, 1.0].map(sodium => nnTm(seq, { sodium }));
    for (let i = 1; i < t.length; i++) {
      assert.ok(t[i] > t[i - 1], `Tm fell from ${t[i - 1]} to ${t[i]} as salt rose`);
    }
  });

  test('Tm rises with strand concentration', () => {
    const seq = 'GCTTACCGATTGCAGTTACC';
    assert.ok(nnTm(seq, { strandConc: 1e-6 }) > nnTm(seq, { strandConc: 1e-8 }));
  });

  test('enthalpy and entropy are both negative for a real duplex', () => {
    const { dH, dS } = duplexThermo('GCTTACCGATTGCAGTTACC');
    assert.ok(dH < 0, 'duplex formation is exothermic');
    assert.ok(dS < 0, 'duplex formation loses entropy');
  });

  test('unusable input gives NaN rather than a confident wrong number', () => {
    assert.ok(Number.isNaN(nnTm('')));
    assert.ok(Number.isNaN(nnTm('A')));
  });

  test('U is read as T so RNA can be measured', () => {
    assert.equal(nnTm('AUCGAUCGAUCGAUCGAUCG'), nnTm('ATCGATCGATCGATCGATCG'));
  });

  test('lower case and whitespace are tolerated', () => {
    assert.equal(nnTm('gcttaccgattgcagttacc'), nnTm('GCTTACCGATTGCAGTTACC'));
  });
});

describe('magnesium', () => {
  // Reference values from Biopython 1.85, which implements the same model:
  //   Tm_NN(seq, nn_table=DNA_NN3, Na=50, Mg=m, dNTPs=d, dnac1=250, dnac2=0, saltcorr=5)
  // Biopython's dnac1=250 with dnac2=0 is a 250 nM concentration term, which is
  // strandConc/4 here, hence strandConc = 1 µM.
  const cases: [string, number, number][] = [
    ['AGCGGATAACAATTTCACACAGGA', 58.35, 64.98],
    ['GTAAAACGACGGCCAGT', 53.86, 60.05],
    ['ATGGCTAGCAAAGGAGAAGAACTTTTCACTGG', 63.43, 70.26],
    ['TTTTTTTTTTTTTTTTTTTT', 39.92, 46.11],
  ];
  for (const [seq, sodiumOnly, withMg] of cases) {
    test(`agrees with Biopython for ${seq}`, () => {
      const naOnly = nnTm(seq, { strandConc: 1e-6, sodium: 0.05, magnesium: 0, dntp: 0 });
      const mg = nnTm(seq, { strandConc: 1e-6, sodium: 0.05, magnesium: 0.002, dntp: 0.0008 });
      assert.ok(Math.abs(naOnly - sodiumOnly) < 0.05, `Na only: ${naOnly.toFixed(2)} vs ${sodiumOnly}`);
      assert.ok(Math.abs(mg - withMg) < 0.05, `with Mg: ${mg.toFixed(2)} vs ${withMg}`);
    });
  }

  test('a PCR buffer reads several degrees above sodium alone', () => {
    const seq = 'GCTTACCGATTGCAGTTACC';
    const lift = nnTm(seq) - nnTm(seq, { magnesium: 0 });
    assert.ok(lift > 4 && lift < 8, `PCR buffer adds ${lift.toFixed(1)} °C`);
  });

  test('only Mg2+ left free by the dNTPs counts', () => {
    // 1.5 mM Mg2+ with 0.6 mM dNTP leaves 0.9 mM: 50 + 120·√0.9 ≈ 163.8 mM.
    assert.ok(Math.abs(sodiumEquivalent(PCR_BUFFER) - 0.1638) < 0.0005);
    // More dNTP than Mg2+: nothing is free, and the buffer is just its sodium.
    assert.equal(sodiumEquivalent({ sodium: 0.05, magnesium: 0.0005, dntp: 0.0008 }), 0.05);
    const seq = 'GCTTACCGATTGCAGTTACC';
    assert.ok(nnTm(seq, { magnesium: 0.003 }) > nnTm(seq, { magnesium: 0.0015 }));
    assert.ok(nnTm(seq, { dntp: 0.001 }) < nnTm(seq, { dntp: 0.0002 }));
  });
});
