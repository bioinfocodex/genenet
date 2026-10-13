import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  q5Primers, quikChangePrimers, applyMutation, kindOf, validateMutation,
  simulateBackToBack, sameCircle, quikChangeTm, codonSwap, type Mutation,
} from '../src/lib/mutagenesis-primers.ts';
import { revComp } from '../src/lib/alignment.ts';
import { codingChanges } from '../src/lib/point-mutation.ts';

function dna(length: number, seed: number): string {
  let state = seed;
  let s = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    s += 'ACGT'[(state >> 16) & 3];
  }
  return s;
}

const plasmid = dna(3000, 1);

const SUB: Mutation = { start: 1200, end: 1200, replacement: plasmid[1199] === 'A' ? 'G' : 'A' };
const DEL: Mutation = { start: 1500, end: 1529, replacement: '' };
const INS_SHORT: Mutation = { start: 1800, end: 1799, replacement: 'GCC' };
const INS_LONG: Mutation = { start: 2100, end: 2099, replacement: 'CATCACCATCACCATCAC' }; // His6
const REPLACE: Mutation = { start: 900, end: 902, replacement: 'GCT' };

describe('describing a change', () => {
  test('kinds', () => {
    assert.equal(kindOf(SUB), 'substitution');
    assert.equal(kindOf(DEL), 'deletion');
    assert.equal(kindOf(INS_SHORT), 'insertion');
  });

  test('applying it', () => {
    assert.equal(applyMutation('AAAACCCC', { start: 5, end: 4, replacement: 'GG' }), 'AAAAGGCCCC');
    assert.equal(applyMutation('AAAACCCC', { start: 3, end: 6, replacement: '' }), 'AACC');
    assert.equal(applyMutation('AAAACCCC', { start: 4, end: 4, replacement: 'T' }), 'AAATCCCC');
  });

  test('nonsense is refused with a reason', () => {
    assert.match(validateMutation('AAAA', { start: 2, end: 2, replacement: 'A' })!, /same/);
    assert.match(validateMutation('AAAA', { start: 2, end: 2, replacement: 'X' })!, /A, C, G or T/);
    assert.match(validateMutation('AAAA', { start: 3, end: 1, replacement: '' })!, /before the start/);
  });
});

describe('Q5: back-to-back primers', () => {
  for (const [label, m] of [
    ['a point substitution', SUB],
    ['a 30 bp deletion', DEL],
    ['a 3 bp insertion', INS_SHORT],
    ['an 18 bp His-tag insertion', INS_LONG],
    ['a codon replacement', REPLACE],
  ] as const) {
    test(`${label}: PCR and ligation with the primers give exactly the mutant`, () => {
      const d = q5Primers(plasmid, true, m);
      const made = simulateBackToBack(plasmid, d.forward.sequence, d.reverse.sequence);
      assert.ok(made, 'both primers anneal once');
      assert.ok(sameCircle(made, applyMutation(plasmid, m)));
      assert.ok(sameCircle(d.mutant, applyMutation(plasmid, m)));
    });
  }

  test('a substitution sits in the middle of the forward primer, with a clean 3′ stretch past it', () => {
    const d = q5Primers(plasmid, true, SUB);
    const [a, b] = d.forward.changed;
    assert.equal(b - a, 1);
    assert.ok(a >= 10, 'matching bases 5′ of the change');
    assert.ok(d.forward.anneals.length >= 10);
    assert.ok(d.forward.sequence.endsWith(d.forward.anneals));
  });

  test('a long insertion is split across both primers', () => {
    const d = q5Primers(plasmid, true, INS_LONG);
    assert.equal(d.forward.changed[1] - d.forward.changed[0] + d.reverse.changed[1] - d.reverse.changed[0], 18);
    assert.ok(d.notes.some(n => /split/.test(n)));
  });

  test('a deletion leaves no changed bases on either primer', () => {
    const d = q5Primers(plasmid, true, DEL);
    assert.deepEqual(d.forward.changed, [0, 0]);
    assert.deepEqual(d.reverse.changed, [0, 0]);
    assert.ok(d.forward.sequence.startsWith(plasmid.slice(1529, 1539)));
    assert.ok(revComp(d.reverse.sequence).endsWith(plasmid.slice(1489, 1499)));
  });

  test('anneal temperatures are near the target and the suggested Ta follows NEB', () => {
    const d = q5Primers(plasmid, true, SUB);
    for (const p of [d.forward, d.reverse]) assert.ok(p.tm >= 57 && p.tm <= 68, `${p.name} ${p.tm}`);
    assert.equal(d.annealingTemp, Math.min(72, Math.round(Math.min(d.forward.tm, d.reverse.tm) + 3)));
  });

  test('works across the origin of the plasmid', () => {
    const m: Mutation = { start: 5, end: 5, replacement: plasmid[4] === 'C' ? 'T' : 'C' };
    const d = q5Primers(plasmid, true, m);
    assert.ok(sameCircle(simulateBackToBack(plasmid, d.forward.sequence, d.reverse.sequence)!, d.mutant));
  });

  test('a linear template is refused: Q5 SDM amplifies a whole plasmid', () => {
    assert.throws(() => q5Primers(plasmid, false, SUB), /linear/);
  });
});

describe('QuikChange: complementary primers', () => {
  test('the primers are exact complements carrying the change in the middle', () => {
    const d = quikChangePrimers(plasmid, true, SUB);
    assert.equal(d.reverse.sequence, revComp(d.forward.sequence));
    const mutant = applyMutation(plasmid, SUB);
    assert.ok(mutant.includes(d.forward.sequence), 'the forward primer is a stretch of the mutant');
    const [a, b] = d.forward.changed;
    const len = d.forward.sequence.length;
    assert.ok(Math.abs(a - (len - b)) <= 4, 'roughly centred');
  });

  test('length and Tm follow the protocol', () => {
    for (const m of [SUB, INS_SHORT, REPLACE]) {
      const d = quikChangePrimers(plasmid, true, m);
      const len = d.forward.sequence.length;
      assert.ok(len >= 25 && len <= 47, `length ${len}`);
      if (!d.warnings.some(w => /78/.test(w))) assert.ok(d.forward.tm >= 78);
    }
  });

  test("Agilent's formula, worked by hand", () => {
    // 25 nt, 13 G/C (52%), one mismatch: 81.5 + 0.41·52 − 675/25 − 4 = 71.82
    const p = 'GCGCGCGCGCGCGAAAAAAAAAAAA';
    assert.equal(quikChangeTm(p, 1, 'substitution'), 71.8);
  });

  test('a long deletion is steered toward Q5', () => {
    const d = quikChangePrimers(plasmid, true, { start: 1000, end: 1059, replacement: '' });
    assert.ok(d.warnings.some(w => /Q5/.test(w)));
  });
});

describe('amino-acid changes', () => {
  //                 M  A  K  W  stop
  const orf = 'ATGGCTAAATGGTAA';
  const seq = 'CCCCCCCCCC' + orf + 'CCCCCCCCCC';
  const cds = { name: 'geneX', type: 'CDS', start: 11, end: 25, strand: 1 as const };

  test('K3A takes the alanine codon needing fewest changes', () => {
    const s = codonSwap(seq, cds, 3, 'A');
    assert.equal(s.originalCodon, 'AAA');
    assert.equal(s.notation, 'K3A');
    // AAA -> GCA needs two changes; every other Ala codon needs three.
    assert.equal(s.newCodon, 'GCA');
    assert.deepEqual(s.mutation, { start: 17, end: 19, replacement: 'GCA' });
    const mutant = applyMutation(seq, s.mutation);
    assert.equal(mutant.slice(16, 19), 'GCA');
  });

  test('on a bottom-strand gene the codon is written back to the top strand', () => {
    const rseq = 'CCCCCCCCCC' + revComp(orf) + 'CCCCCCCCCC';
    const rcds = { ...cds, strand: -1 as const };
    const s = codonSwap(rseq, rcds, 3, 'A');
    const mutant = applyMutation(rseq, s.mutation);
    // Read back through the point-mutation code: residue 3 is now Ala.
    const reread = revComp(mutant.slice(10, 25));
    assert.equal(reread.slice(6, 9), 'GCA');
  });

  test('a single-base swap agrees with the point-mutation reading', () => {
    const s = codonSwap(seq, cds, 4, '*'); // W4*: TGG -> TGA or TAG, one change
    const changedAt = [...s.originalCodon].findIndex((b, i) => b !== s.newCodon[i]);
    const pos = s.mutation.start + changedAt;
    const [c] = codingChanges(seq, [cds], pos, s.newCodon[changedAt]);
    assert.equal(c.notation, 'W4*');
  });

  test('asking for the residue that is already there is refused', () => {
    assert.throws(() => codonSwap(seq, cds, 2, 'A'), /already/);
  });
});
