import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignPair, verifyRead, revComp, alignMultiple, MAX_CELLS,
} from '../src/lib/alignment.ts';

/**
 * Alignment.
 *
 * Every case here is one that can be checked by hand, because an alignment is
 * the kind of output that looks convincing whether or not it is right. A wrong
 * one does not error; it puts the mismatch two bases off, and somebody orders a
 * new primer against it.
 */

/** Columns must line up, or every coordinate derived from them is wrong. */
function wellFormed(al: { alignedA: string; alignedB: string; midline: string }) {
  assert.equal(al.alignedA.length, al.alignedB.length, 'rows differ in length');
  assert.equal(al.midline.length, al.alignedA.length, 'midline differs in length');
  for (let i = 0; i < al.alignedA.length; i++) {
    assert.ok(!(al.alignedA[i] === '-' && al.alignedB[i] === '-'),
      `column ${i} is a gap in both sequences`);
  }
}

/** Removing gaps must give back exactly what went in. */
function preservesInput(al: { alignedA: string; alignedB: string }, a: string, b: string) {
  assert.equal(al.alignedA.replace(/-/g, ''), a.toUpperCase(), 'sequence A was altered');
  assert.equal(al.alignedB.replace(/-/g, ''), b.toUpperCase(), 'sequence B was altered');
}

describe('global alignment', () => {
  test('identical sequences align with no gaps and full identity', () => {
    const a = alignPair('ACGTACGTAC', 'ACGTACGTAC');
    wellFormed(a);
    assert.equal(a.identity, 1);
    assert.equal(a.gaps, 0);
    assert.equal(a.mismatches, 0);
    assert.equal(a.matches, 10);
    assert.equal(a.midline, '|'.repeat(10));
  });

  test('a single substitution is reported at the right column', () => {
    //                    position 5 (0-based 4)
    const a = alignPair('ACGTACGTAC', 'ACGTTCGTAC');
    wellFormed(a);
    assert.equal(a.mismatches, 1);
    assert.equal(a.gaps, 0);
    assert.equal(a.midline.indexOf('.'), 4);
  });

  test('a deletion becomes one contiguous gap, not several', () => {
    // Affine gaps exist for this: three scattered single gaps would score the
    // same under a flat penalty, and be biologically wrong.
    const ref = 'ACGTACGTACGTACGT';
    const del = 'ACGTACGTACGT';       // last four bases missing
    const a = alignPair(ref, del);
    wellFormed(a);
    preservesInput(a, ref, del);
    assert.equal(a.gaps, 4);
    const runs = a.alignedB.match(/-+/g) ?? [];
    assert.equal(runs.length, 1, `expected one gap run, got ${runs.length}: ${a.alignedB}`);
  });

  test('an internal insertion is placed as one run', () => {
    const ref = 'ACGTACGTACGT';
    const ins = 'ACGTACAAAGTACGT';
    const a = alignPair(ref, ins);
    wellFormed(a);
    preservesInput(a, ref, ins);
    const runs = a.alignedA.match(/-+/g) ?? [];
    assert.equal(runs.length, 1, `expected one insertion run: ${a.alignedA}`);
  });

  test('input is never altered, only gapped', () => {
    const pairs: [string, string][] = [
      ['ACGTACGT', 'ACGT'],
      ['ACGT', 'ACGTACGT'],
      ['AAAAAAAA', 'TTTTTTTT'],
      ['ACGTACGTAAGGCC', 'ACGTCCGTAAGGCC'],
    ];
    for (const [x, y] of pairs) {
      const al = alignPair(x, y);
      wellFormed(al);
      preservesInput(al, x, y);
    }
  });

  test('identity is fraction of aligned columns, gaps excluded', () => {
    const a = alignPair('ACGTACGTAC', 'ACGTTCGTAC');
    assert.equal(a.matches, 9);
    assert.equal(a.mismatches, 1);
    assert.ok(Math.abs(a.identity - 0.9) < 1e-9, `identity ${a.identity}`);
  });

  test('unrelated sequences still produce a well-formed alignment', () => {
    const a = alignPair('AAAAAAAAAA', 'CCCCCCCCCC');
    wellFormed(a);
    assert.equal(a.identity, 0);
  });

  test('an empty sequence is refused rather than aligned', () => {
    assert.throws(() => alignPair('', 'ACGT'), /non-empty/);
    assert.throws(() => alignPair('ACGT', ''), /non-empty/);
  });

  test('an alignment too large to hold is refused, not attempted', () => {
    const huge = 'A'.repeat(Math.ceil(Math.sqrt(MAX_CELLS)) + 100);
    assert.throws(() => alignPair(huge, huge), /Too large/);
  });
});

describe('local alignment', () => {
  test('finds a shared island between unrelated flanks', () => {
    const island = 'ACGTACGTACGTACGT';
    const a = alignPair('TTTTTTTTTT' + island + 'TTTTTTTTTT',
                        'GGGGGGGGGG' + island + 'GGGGGGGGGG',
                        { mode: 'local' });
    wellFormed(a);
    // The aligned region should be the island, not the whole sequence.
    assert.ok(a.alignedA.replace(/-/g, '').includes('ACGTACGTACGTACGT'),
      `expected the shared island, got ${a.alignedA}`);
    assert.ok(a.alignedA.length < 30,
      `local alignment should not span the flanks; got ${a.alignedA.length} columns`);
    assert.equal(a.mismatches, 0);
  });

  test('a local alignment of identical sequences is the whole sequence', () => {
    const a = alignPair('ACGTACGTAC', 'ACGTACGTAC', { mode: 'local' });
    assert.equal(a.matches, 10);
    assert.equal(a.identity, 1);
  });
});

describe('reverse complement', () => {
  test('is its own inverse', () => {
    const s = 'ACGTACGTTTGCA';
    assert.equal(revComp(revComp(s)), s);
  });

  test('complements correctly', () => {
    assert.equal(revComp('ATGC'), 'GCAT');
  });
});

describe('verifying a sequencing read', () => {
  // A "plasmid" and a read from the middle of it.
  const reference =
    'ATGGCGAATTCGCTAGCTAGCTTACGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCTAGCATCGATCG' +
    'TAGCTAGCATCGATCGATCGTAGCTAGCTAGCATCGATCGATCGATCGTAGCTAGCTAGCATCGATCGAT';

  test('a perfect read reports no differences', () => {
    const read = reference.slice(20, 100);
    const v = verifyRead(reference, read);
    assert.equal(v.differences.length, 0, JSON.stringify(v.differences));
    assert.equal(v.identity, 1);
    assert.equal(v.reversed, false);
  });

  test('a read in the reverse orientation is detected and aligned', () => {
    // Which direction a read comes back in depends on the primer, not on the
    // person. Making them notice is a way to lose an afternoon.
    const read = revComp(reference.slice(20, 100));
    const v = verifyRead(reference, read);
    assert.equal(v.reversed, true);
    assert.equal(v.differences.length, 0, JSON.stringify(v.differences));
  });

  test('a point mutation is reported at its position in the reference', () => {
    const read = reference.slice(20, 100).split('');
    read[10] = read[10] === 'A' ? 'C' : 'A';   // reference position 31, 1-based
    const v = verifyRead(reference, read.join(''));
    assert.equal(v.differences.length, 1, JSON.stringify(v.differences));
    const d = v.differences[0];
    assert.equal(d.kind, 'mismatch');
    assert.equal(d.position, 31, `expected reference position 31, got ${d.position}`);
    assert.equal(d.reference, reference[30]);
  });

  test('a deletion in the read is reported as a deletion', () => {
    const slice = reference.slice(20, 100);
    const read = slice.slice(0, 30) + slice.slice(33); // three bases gone
    const v = verifyRead(reference, read);
    const dels = v.differences.filter(d => d.kind === 'deletion');
    assert.equal(dels.length, 3, JSON.stringify(v.differences));
    // Contiguous, not scattered.
    assert.equal(dels[2].position - dels[0].position, 2);
  });

  test('an insertion in the read is reported as an insertion', () => {
    const slice = reference.slice(20, 100);
    const read = slice.slice(0, 30) + 'GGG' + slice.slice(30);
    const v = verifyRead(reference, read);
    const ins = v.differences.filter(d => d.kind === 'insertion');
    assert.equal(ins.length, 3, JSON.stringify(v.differences));
  });

  test('coverage says which part of the reference the read reached', () => {
    const v = verifyRead(reference, reference.slice(20, 100));
    assert.equal(v.coverageStart, 21, `start ${v.coverageStart}`);
    assert.equal(v.coverageEnd, 100, `end ${v.coverageEnd}`);
  });

  test('a short read does not pay for the reference it does not cover', () => {
    // Without free end gaps the flanking reference would be charged as one long
    // gap and the read would align badly or not at all.
    const v = verifyRead(reference, reference.slice(60, 90));
    assert.equal(v.identity, 1);
    assert.equal(v.differences.length, 0);
  });
});

describe('aligning several sequences', () => {
  test('identical sequences give a fully conserved consensus', () => {
    const m = alignMultiple([
      { name: 'a', sequence: 'ACGTACGTAC' },
      { name: 'b', sequence: 'ACGTACGTAC' },
      { name: 'c', sequence: 'ACGTACGTAC' },
    ]);
    assert.equal(m.rows.length, 3);
    assert.equal(m.identity, 1);
    assert.equal(m.consensus, '*'.repeat(10));
  });

  test('every row comes out the same length', () => {
    const m = alignMultiple([
      { name: 'a', sequence: 'ACGTACGTACGT' },
      { name: 'b', sequence: 'ACGTACGTAC' },
      { name: 'c', sequence: 'ACGTAAAACGTACGT' },
    ]);
    const widths = new Set(m.rows.map(r => r.length));
    assert.equal(widths.size, 1, `rows have lengths ${[...widths].join(', ')}`);
    assert.equal(m.consensus.length, m.rows[0].length);
  });

  test('each row still contains its own sequence', () => {
    const input = [
      { name: 'a', sequence: 'ACGTACGTACGT' },
      { name: 'b', sequence: 'ACGTACGTAC' },
      { name: 'c', sequence: 'ACGTAAAACGTACGT' },
    ];
    const m = alignMultiple(input);
    for (let i = 0; i < input.length; i++) {
      const name = input[i].name;
      const row = m.rows[m.names.indexOf(name)];
      assert.equal(row.replace(/-/g, ''), input[i].sequence,
        `row ${name} no longer holds its sequence`);
    }
  });

  test('a divergent column is not marked conserved', () => {
    const m = alignMultiple([
      { name: 'a', sequence: 'ACGTACGTAC' },
      { name: 'b', sequence: 'ACGTTCGTAC' },
    ]);
    assert.ok(m.consensus.includes(' '), 'a mismatched column should not be starred');
    assert.ok(m.identity < 1);
  });

  test('fewer than two sequences is refused', () => {
    assert.throws(() => alignMultiple([{ name: 'a', sequence: 'ACGT' }]), /at least two/);
  });
});
