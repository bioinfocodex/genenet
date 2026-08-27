import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  reverseComplement, calcGC, calcTm, translateDNA, findORFs,
  parseFasta, calcProteinProperties,
} from '../src/lib/simulation.ts';
import { wallaceTm, translateSeq } from '../src/lib/molbuilder-logic.ts';

/**
 * The molecular biology functions.
 *
 * These are tested first because a wrong answer here is invisible: nothing
 * crashes, no error appears, the number is simply not the number. Someone
 * orders a primer against it. The dsDNA molecular weight bug fixed in 7d39c05
 * was exactly that shape, and a test of this kind would have caught it.
 *
 * Expected values come from the biology, not from running the code and
 * recording what it said -- otherwise the test only asserts that the bug is
 * reproducible.
 */

describe('reverseComplement', () => {
  test('complements and reverses', () => {
    assert.equal(reverseComplement('ATGC'), 'GCAT');
  });

  test('is its own inverse', () => {
    const seq = 'ATGGCGAATTCGCTAGCTAGCTTACGT';
    assert.equal(reverseComplement(reverseComplement(seq)), seq);
  });

  test('a palindromic restriction site reads the same on both strands', () => {
    // EcoRI, BamHI and HindIII sites are palindromes -- that is why they are
    // cut by a homodimeric enzyme.
    for (const site of ['GAATTC', 'GGATCC', 'AAGCTT']) {
      assert.equal(reverseComplement(site), site, `${site} should be palindromic`);
    }
  });

  test('lowercase input is handled', () => {
    assert.equal(reverseComplement('atgc'), 'GCAT');
  });

  test('IUPAC ambiguity codes complement correctly', () => {
    // R is purine (A/G), so its complement is Y, pyrimidine (C/T) -- not N.
    assert.equal(reverseComplement('ATRC'), 'GYAT');
    assert.equal(reverseComplement('R'), 'Y');
    assert.equal(reverseComplement('W'), 'W'); // A/T is self-complementary
    assert.equal(reverseComplement('S'), 'S'); // G/C likewise
    assert.equal(reverseComplement('N'), 'N');
  });

  test('a truly unknown character becomes N rather than vanishing', () => {
    // Dropping a base would shift every downstream coordinate.
    assert.equal(reverseComplement('ATZC').length, 4);
    assert.equal(reverseComplement('ATZC'), 'GNAT');
  });
});

describe('calcGC', () => {
  test('all G/C is 100, all A/T is 0', () => {
    assert.equal(calcGC('GGCC'), 100);
    assert.equal(calcGC('AATT'), 0);
  });

  test('half and half is 50', () => {
    assert.equal(calcGC('ATGC'), 50);
  });

  test('non-ACGT characters are excluded from the denominator', () => {
    // 'ATGCNNNN' is 50% GC over real bases, not 25% over all characters.
    assert.equal(calcGC('ATGCNNNN'), 50);
  });

  test('an empty sequence is 0, not NaN', () => {
    assert.equal(calcGC(''), 0);
    assert.equal(calcGC('NNNN'), 0);
  });

  test('pUC19 is about 50% GC', () => {
    // A stretch of the pUC19 polylinker region.
    const seq = 'GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTT';
    const gc = calcGC(seq);
    assert.ok(gc > 45 && gc < 70, `expected a plausible GC%, got ${gc}`);
  });
});

describe('calcTm', () => {
  test('short oligos follow the Wallace rule: 2(A+T) + 4(G+C)', () => {
    // 12-mer, 6 AT and 6 GC -> 2*6 + 4*6 = 36
    assert.equal(calcTm('ATATATGCGCGC'), 36);
    // 8-mer, all AT -> 2*8 = 16
    assert.equal(calcTm('ATATATAT'), 16);
    // 8-mer, all GC -> 4*8 = 32
    assert.equal(calcTm('GCGCGCGC'), 32);
  });

  test('GC-rich oligos melt higher than AT-rich ones of the same length', () => {
    assert.ok(calcTm('GCGCGCGCGC') > calcTm('ATATATATAT'));
  });

  test('switches formula above 13 bases', () => {
    // The Wallace rule is only valid for short oligos; above 13 the function
    // uses the salt-adjusted approximation, which gives a much lower number
    // for a long AT-rich sequence than 2*(A+T) would.
    const long = 'ATATATATATATATATATAT'; // 20-mer, no GC
    assert.notEqual(calcTm(long), 40);
    assert.ok(calcTm(long) < 40);
  });

  test('a typical 20-mer primer lands in a usable range', () => {
    const primer = 'GTAAAACGACGGCCAGTGAA'; // M13 forward, 20-mer
    const tm = calcTm(primer);
    assert.ok(tm > 40 && tm < 75, `expected a usable annealing temperature, got ${tm}`);
  });

  test('wallaceTm agrees with calcTm on short oligos', () => {
    for (const s of ['ATGC', 'GGGGCCCC', 'ATATATATATA']) {
      assert.equal(wallaceTm(s), calcTm(s), `disagreement on ${s}`);
    }
  });
});

describe('translateDNA', () => {
  test('translates the start codon to methionine', () => {
    assert.equal(translateDNA('ATG'), 'M');
  });

  test('translates a known peptide', () => {
    // ATG GCC TTA -> Met Ala Leu
    assert.equal(translateDNA('ATGGCCTTA'), 'MAL');
  });

  test('stops at a stop codon by default', () => {
    // ATG AAA TAA GGG -> M K then stop; GGG must not appear.
    assert.equal(translateDNA('ATGAAATAAGGG'), 'MK');
  });

  test('reads through stops when asked', () => {
    assert.equal(translateDNA('ATGAAATAAGGG', false), 'MKG');
  });

  test('the three stop codons all stop', () => {
    for (const stop of ['TAA', 'TAG', 'TGA']) {
      assert.equal(translateDNA(`ATG${stop}AAA`), 'M', `${stop} should terminate`);
    }
  });

  test('all six leucine codons give leucine', () => {
    // Leucine is six-fold degenerate; a wrong codon table usually shows here.
    for (const codon of ['TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG']) {
      assert.equal(translateDNA(codon, false), 'L', `${codon} should be Leu`);
    }
  });

  test('tryptophan and methionine have exactly one codon each', () => {
    assert.equal(translateDNA('TGG', false), 'W');
    assert.equal(translateDNA('ATG', false), 'M');
  });

  test('a trailing partial codon is ignored, not guessed', () => {
    assert.equal(translateDNA('ATGGCCTT'), 'MA');
  });

  test('the two codon tables in this codebase agree', () => {
    // translateSeq returns one entry per base for the sequence viewer, with the
    // amino acid at the codon's first position. Different shape, same genetics
    // -- and two codon tables that disagree would be a subtle disaster.
    const seq = 'ATGGCCTTAGGGCCCAAATTTTGGCCC';
    const perBase = translateSeq(seq, 1);
    const fromViewer = perBase.filter((x): x is string => x !== null).join('');
    assert.equal(fromViewer, translateDNA(seq, false));
  });
});

describe('findORFs', () => {
  test('finds an open reading frame on the forward strand', () => {
    // ATG + 40 codons + TAA = 129 bp of coding sequence.
    const orf = 'ATG' + 'GCC'.repeat(40) + 'TAA';
    const found = findORFs(orf, 100);
    assert.ok(found.length >= 1, 'expected at least one ORF');
    assert.ok(found.some(o => o.strand === '+'), 'expected a forward-strand ORF');
  });

  test('finds the same ORF on the reverse strand when reverse-complemented', () => {
    const orf = 'ATG' + 'GCC'.repeat(40) + 'TAA';
    const found = findORFs(reverseComplement(orf), 100);
    assert.ok(found.some(o => o.strand === '-'), 'expected a reverse-strand ORF');
  });

  test('respects the minimum length', () => {
    const shortOrf = 'ATG' + 'GCC'.repeat(5) + 'TAA'; // 24 bp
    assert.equal(findORFs(shortOrf, 100).length, 0, 'short ORF should be filtered out');
    assert.ok(findORFs(shortOrf, 10).length >= 1, 'should appear with a lower threshold');
  });

  test('a sequence with no start codon yields nothing', () => {
    assert.equal(findORFs('CCC'.repeat(100), 30).length, 0);
  });
});

describe('parseFasta', () => {
  test('reads a record and its name', () => {
    const r = parseFasta('>seq1 a description\nATGC\nGGTT\n');
    assert.ok(r, 'expected a parsed record');
    assert.equal(r.sequence, 'ATGCGGTT');
    assert.equal(r.name, 'seq1');
  });

  test('joins sequence lines without inserting anything', () => {
    const r = parseFasta('>x\nAT\nGC\nAT\n');
    assert.equal(r?.sequence, 'ATGCAT');
  });

  test('empty input returns null rather than an empty record', () => {
    assert.equal(parseFasta(''), null);
    assert.equal(parseFasta('   \n  '), null);
  });

  test('a header is required: bare sequence returns null', () => {
    // Documenting current behaviour rather than endorsing it. Sequence import
    // (actions/sequences.ts) sends pasted text straight here, so pasting a raw
    // sequence with no ">" line fails the import. Strictly correct for a
    // function named parseFasta; probably not what someone pasting expects.
    assert.equal(parseFasta('ATGCATGC'), null);
  });

  test('non-sequence characters are stripped, digits and spaces included', () => {
    // GenBank-style numbered blocks paste in with coordinates attached.
    const r = parseFasta('>x\n   1 atgc atgc\n   9 ggtt\n');
    assert.equal(r?.sequence, 'ATGCATGCGGTT');
  });
});

describe('calcProteinProperties', () => {
  test('molecular weight of a single glycine matches the residue plus water', () => {
    // Gly residue 57.05 + water 18.02 = 75.07 Da. Reported in kDa, so 0.08.
    const p = calcProteinProperties('G');
    assert.ok(Math.abs(p.mw - 0.075) < 0.01, `expected ~0.075 kDa, got ${p.mw}`);
  });

  test('insulin B chain is about 3.4 kDa', () => {
    // Published mass of the 30-residue human insulin B chain: ~3430 Da.
    const b = 'FVNQHLCGSHLVEALYLVCGERGFFYTPKT';
    const p = calcProteinProperties(b);
    assert.equal(p.length, 30);
    assert.ok(Math.abs(p.mw - 3.43) < 0.1, `expected ~3.43 kDa, got ${p.mw}`);
  });

  test('molecular weight grows with length', () => {
    assert.ok(calcProteinProperties('GG').mw > calcProteinProperties('G').mw);
  });

  test('an empty sequence gives zeroes, not NaN', () => {
    const p = calcProteinProperties('');
    assert.equal(p.length, 0);
    assert.equal(p.mw, 0);
    assert.ok(Number.isFinite(p.gravy));
  });

  test('a hydrophobic peptide has a higher GRAVY than a hydrophilic one', () => {
    // GRAVY: Ile is the most hydrophobic residue (+4.5), Arg the least (-4.5).
    assert.ok(calcProteinProperties('IIIIII').gravy > calcProteinProperties('RRRRRR').gravy);
  });
});
