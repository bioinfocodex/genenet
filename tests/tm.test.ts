import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nnTm, duplexThermo } from '../src/lib/tm.ts';

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
    const t = nnTm('GCTTACCGATTGCAGTTACC');
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
