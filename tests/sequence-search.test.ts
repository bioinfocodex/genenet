import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMatches, basesMatch, revComp, cleanQuery, stepThrough, applyReplacement,
  MAX_MATCHES,
} from '../src/lib/sequence-search.ts';

const at = (m: { start: number; end: number }) => `${m.start}..${m.end}`;

describe('comparing a base with a code', () => {
  test('plain bases are themselves', () => {
    assert.ok(basesMatch('A', 'A'));
    assert.ok(!basesMatch('A', 'C'));
  });

  test('a code stands for the bases it names', () => {
    assert.ok(basesMatch('A', 'R'));   // R is A or G
    assert.ok(basesMatch('G', 'R'));
    assert.ok(!basesMatch('C', 'R'));
    for (const b of 'ACGT') assert.ok(basesMatch(b, 'N'), b);
  });

  test('a code in the sequence is a code, not a wildcard letter', () => {
    /*
     * An assembled consensus really does contain N. Treating it as the
     * literal character N would make it match nothing; treating it as "any
     * base" is what it means, and a run of them matching every query is the
     * honest answer rather than a bug.
     */
    assert.ok(basesMatch('N', 'A'));
    assert.ok(basesMatch('R', 'A'));
    assert.ok(!basesMatch('R', 'C'));
  });

  test('U reads as T, because somebody will paste RNA', () => {
    assert.ok(basesMatch('T', 'U'));
    assert.ok(basesMatch('U', 'T'));
  });

  test('case is not a difference', () => {
    assert.ok(basesMatch('a', 'A'));
    assert.ok(basesMatch('A', 'n'));
  });
});

describe('the reverse complement', () => {
  test('plain bases', () => {
    assert.equal(revComp('ATGC'), 'GCAT');
  });

  test('codes complement to their own opposite, not to N', () => {
    // R is A-or-G; its complement is T-or-C, which is Y. Flattening codes to
    // N here would make a bottom-strand search of an ambiguous motif match
    // far more than it should.
    assert.equal(revComp('R'), 'Y');
    assert.equal(revComp('Y'), 'R');
    assert.equal(revComp('K'), 'M');
    assert.equal(revComp('B'), 'V');
    assert.equal(revComp('N'), 'N');
    assert.equal(revComp('W'), 'W');
  });

  test('it is its own inverse', () => {
    for (const s of ['ATGC', 'RYSWKM', 'BDHVN', 'GGTCTCN']) {
      assert.equal(revComp(revComp(s)), s, s);
    }
  });
});

describe('what counts as a query', () => {
  test('spaces, digits and punctuation are dropped', () => {
    // People paste "1 atg cta" straight out of a GenBank block.
    assert.equal(cleanQuery('1 atg cta\n21 ggc'), 'ATGCTAGGC');
  });

  test('an empty query finds nothing rather than everything', () => {
    assert.deepEqual(findMatches('ATGC', ''), []);
    assert.deepEqual(findMatches('ATGC', '   '), []);
  });

  test('a query longer than the sequence finds nothing', () => {
    assert.deepEqual(findMatches('ATG', 'ATGCTA'), []);
  });
});

describe('finding on a linear sequence', () => {
  test('a single occurrence, in 1-based inclusive coordinates', () => {
    //        1234567890
    const m = findMatches('TTATGCTTTT', 'ATGC', { bothStrands: false });
    assert.equal(m.length, 1);
    assert.equal(at(m[0]), '3..6');
    assert.equal(m[0].strand, 1);
    assert.equal(m[0].wrapsOrigin, false);
  });

  test('overlapping occurrences are all found', () => {
    // AA occurs twice in AAA, and a search that reports one is wrong.
    const m = findMatches('AAA', 'AA', { bothStrands: false });
    assert.deepEqual(m.map(at), ['1..2', '2..3']);
  });

  test('ambiguity codes in the query', () => {
    // GGTCTCN is BsaI with its spacer: the last base is genuinely any base.
    const m = findMatches('AAGGTCTCAAA', 'GGTCTCN', { bothStrands: false });
    assert.deepEqual(m.map(at), ['3..9']);
  });

  test('a match at the very start and at the very end', () => {
    assert.deepEqual(findMatches('ATGCCC', 'ATG', { bothStrands: false }).map(at), ['1..3']);
    assert.deepEqual(findMatches('CCCATG', 'ATG', { bothStrands: false }).map(at), ['4..6']);
  });
});

describe('the other strand', () => {
  test('a motif present only as its complement is still found', () => {
    /*
     * This is the case that matters: somebody pastes a reverse primer, which
     * exists in the file only as its reverse complement, and being told it
     * is absent would be a falsehood.
     */
    const seq = 'TTTTGCATTTT';            // contains GCAT; its revcomp is ATGC
    const m = findMatches(seq, 'ATGC');
    assert.equal(m.length, 1);
    assert.equal(at(m[0]), '5..8');
    assert.equal(m[0].strand, -1);
  });

  test('a palindrome is reported once, not twice', () => {
    // GAATTC is its own reverse complement. Counting it on both strands
    // would double every restriction site anybody searched for.
    const m = findMatches('AAGAATTCAA', 'GAATTC');
    assert.equal(m.length, 1);
    assert.equal(m[0].strand, 1);
  });

  test('the other strand can be turned off', () => {
    assert.equal(findMatches('TTTTGCATTTT', 'ATGC', { bothStrands: false }).length, 0);
  });

  test('both strands at once, in order along the molecule', () => {
    const m = findMatches('ATGCTTTTTGCAT', 'ATGC');
    assert.deepEqual(m.map(x => `${at(x)}:${x.strand}`), ['1..4:1', '10..13:-1']);
  });
});

describe('the origin of a circular molecule', () => {
  const seq = 'GCTTTTTTTTAT';   // ends AT, begins GC -> ATGC spans the origin

  test('a motif through the origin is missed when linear and found when circular', () => {
    assert.deepEqual(findMatches(seq, 'ATGC', { bothStrands: false, circular: false }), []);
    const m = findMatches(seq, 'ATGC', { bothStrands: false, circular: true });
    assert.equal(m.length, 1);
    assert.equal(at(m[0]), '11..2');
    assert.equal(m[0].wrapsOrigin, true);
  });

  test('a wrapping match reports its end before its start, as the coordinates mean', () => {
    const m = findMatches(seq, 'ATGC', { bothStrands: false, circular: true })[0];
    assert.ok(m.end < m.start);
  });

  test('a circular search does not invent matches on a sequence without one', () => {
    const plain = 'AAAAATGCAAAA';
    const linear = findMatches(plain, 'ATGC', { bothStrands: false });
    const circular = findMatches(plain, 'ATGC', { bothStrands: false, circular: true });
    assert.deepEqual(linear.map(at), circular.map(at));
  });
});

describe('not hanging the browser', () => {
  test('a one-base query on a long sequence stops at the limit', () => {
    const m = findMatches('A'.repeat(20000), 'A', { bothStrands: false });
    assert.equal(m.length, MAX_MATCHES);
  });

  test('the limit can be lowered', () => {
    assert.equal(findMatches('AAAA', 'A', { bothStrands: false, limit: 2 }).length, 2);
  });
});

describe('stepping through the matches', () => {
  const three = [
    { start: 1, end: 2, strand: 1 as const, wrapsOrigin: false },
    { start: 5, end: 6, strand: 1 as const, wrapsOrigin: false },
    { start: 9, end: 10, strand: 1 as const, wrapsOrigin: false },
  ];

  test('nothing found, nowhere to go', () => {
    assert.equal(stepThrough([], null, 1), null);
  });

  test('the first next is the first match, the first previous is the last', () => {
    assert.equal(stepThrough(three, null, 1), 0);
    assert.equal(stepThrough(three, null, -1), 2);
  });

  test('it wraps at both ends rather than stopping', () => {
    assert.equal(stepThrough(three, 2, 1), 0);
    assert.equal(stepThrough(three, 0, -1), 2);
  });
});

describe('replacing', () => {
  test('every match is replaced, and later positions stay correct', () => {
    /*
     * Replacing left to right moves every later match by the change in
     * length, so positions gathered before the first edit are wrong from the
     * second edit onwards. Right to left is what keeps them true.
     */
    const seq = 'AAATGAAATGAAA';
    const matches = findMatches(seq, 'ATG', { bothStrands: false });
    assert.equal(matches.length, 2);
    const out = applyReplacement(seq, matches, 'CCCC');
    assert.equal(out.replaced, 2);
    //  AA [ATG->CCCC] AA [ATG->CCCC] AAA
    assert.equal(out.sequence, 'AACCCCAACCCCAAA');
  });

  test('a shorter replacement works as well as a longer one', () => {
    const seq = 'AAATGAAATGAAA';
    const matches = findMatches(seq, 'ATG', { bothStrands: false });
    assert.equal(applyReplacement(seq, matches, 'C').sequence, 'AACAACAAA');
  });

  test('a bottom-strand match is written as the complement', () => {
    /*
     * Matches are reported in top-strand coordinates whichever strand they
     * were found on, so writing the replacement as typed would put it in
     * backwards.
     */
    const seq = 'TTTTGCATTTT';                      // GCAT = revcomp of ATGC
    const matches = findMatches(seq, 'ATGC');
    assert.equal(matches[0].strand, -1);
    const out = applyReplacement(seq, matches, 'AAGG');
    assert.equal(out.sequence, 'TTTT' + 'CCTT' + 'TTT');
  });

  test('a match through the origin is skipped and counted, not applied', () => {
    // Splicing across the end of the string would quietly re-origin the
    // molecule, which is not what replacing a motif asks for.
    const seq = 'GCTTTTTTTTAT';
    const matches = findMatches(seq, 'ATGC', { bothStrands: false, circular: true });
    const out = applyReplacement(seq, matches, 'CCCC');
    assert.equal(out.replaced, 0);
    assert.equal(out.skippedWrapping, 1);
    assert.equal(out.sequence, seq);
  });

  test('replacing nothing leaves the sequence alone', () => {
    assert.equal(applyReplacement('ATGC', [], 'TTTT').sequence, 'ATGC');
  });
});
