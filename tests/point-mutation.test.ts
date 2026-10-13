import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { codingChanges, isCoding } from '../src/lib/point-mutation.ts';
import { revComp } from '../src/lib/alignment.ts';

//                 M  A  K  W  stop
const ORF = 'ATGGCTAAATGGTAA';
const flank = 'CCCCCCCCCC'; // 10 bases, so the CDS starts at 11
const seq = flank + ORF + flank;
const cds = { name: 'geneX', type: 'CDS', start: 11, end: 25, strand: 1 as const };

describe('a forward CDS', () => {
  test('a missense change is read in the gene’s own frame', () => {
    // Position 15 is the second base of codon 2 (GCT, Ala). C -> A gives GAT, Asp.
    const [c] = codingChanges(seq, [cds], 15, 'A');
    assert.equal(c.codonNumber, 2);
    assert.equal(c.codonPosition, 2);
    assert.equal(c.originalCodon, 'GCT');
    assert.equal(c.mutantCodon, 'GAT');
    assert.equal(c.effect, 'missense');
    assert.equal(c.notation, 'A2D');
  });

  test('a third-position change that keeps the residue is silent', () => {
    // Codon 2 GCT -> GCC is still Ala.
    const [c] = codingChanges(seq, [cds], 16, 'C');
    assert.equal(c.effect, 'silent');
    assert.equal(c.notation, 'A2=');
  });

  test('a change that makes a stop is nonsense', () => {
    // Codon 4 TGG (Trp): G -> A at its third base gives TGA.
    const [c] = codingChanges(seq, [cds], 22, 'A');
    assert.equal(c.mutantCodon, 'TGA');
    assert.equal(c.effect, 'nonsense');
    assert.equal(c.notation, 'W4*');
  });

  test('losing the start codon and losing the stop are named as such', () => {
    assert.equal(codingChanges(seq, [cds], 12, 'C')[0].effect, 'start-loss');
    // TAA -> CAA (Gln) reads through the stop.
    assert.equal(codingChanges(seq, [cds], 23, 'C')[0].effect, 'stop-loss');
    // TAA -> TGA is still a stop, so it is silent, not a stop-loss.
    assert.equal(codingChanges(seq, [cds], 24, 'G')[0].effect, 'silent');
  });

  test('outside every CDS there is no protein effect to report', () => {
    assert.deepEqual(codingChanges(seq, [cds], 5, 'A'), []);
  });

  test('the old window-based reading would have got this wrong', () => {
    // The old panel translated from pos-14. For position 15 that starts at
    // base 1 -- inside the flank -- and reads CCC CCC CCC CAT GGC..., a frame
    // in which the change looks like nothing the gene encodes. Here the frame
    // comes from the CDS whatever window is shown.
    const c = codingChanges(seq, [cds], 15, 'A')[0];
    assert.equal(c.originalAA, 'A');
    assert.equal(c.mutantAA, 'D');
  });
});

describe('a reverse CDS', () => {
  // The same gene, written on the bottom strand.
  const rseq = flank + revComp(ORF) + flank;
  const rcds = { name: 'geneR', type: 'CDS', start: 11, end: 25, strand: -1 as const };

  test('is read from its own 5′ end, with the changed base complemented', () => {
    // Codon 2 base 2 of the gene sits at top-strand position 25 - 4 = 21.
    // On the top strand that base is G (the complement of the gene's C);
    // changing it to T makes the gene read A there: GCT -> GAT.
    assert.equal(rseq[20], 'G');
    const [c] = codingChanges(rseq, [rcds], 21, 'T');
    assert.equal(c.codonNumber, 2);
    assert.equal(c.originalCodon, 'GCT');
    assert.equal(c.mutantCodon, 'GAT');
    assert.equal(c.notation, 'A2D');
  });
});

describe('a spliced CDS', () => {
  // ATG GCT | intron | AAA TGG TAA -- the exon junction falls between codons 2 and 3.
  const intron = 'GTAAGTTTTTTTTTTTTTTCAG';
  const spliced = flank + 'ATGGCT' + intron + 'AAATGGTAA' + flank;
  const exon2Start = 11 + 6 + intron.length;
  const gene = {
    name: 'geneS', type: 'CDS', start: 11, end: exon2Start + 8, strand: 1 as const,
    segments: [{ start: 11, end: 16 }, { start: exon2Start, end: exon2Start + 8 }],
  };

  test('codons are counted across the exon junction', () => {
    // First base of exon 2 is codon 3 (AAA, Lys).
    const [c] = codingChanges(spliced, [gene], exon2Start, 'G');
    assert.equal(c.codonNumber, 3);
    assert.equal(c.originalCodon, 'AAA');
    assert.equal(c.notation, 'K3E');
  });

  test('an intronic base changes no codon', () => {
    assert.deepEqual(codingChanges(spliced, [gene], 20, 'C'), []);
  });
});

describe('what is treated as coding', () => {
  test('CDS and ORF features carry a frame; a promoter does not', () => {
    assert.ok(isCoding('CDS'));
    assert.ok(isCoding('orf'));
    assert.ok(!isCoding('promoter'));
    assert.deepEqual(codingChanges(seq, [{ ...cds, type: 'promoter' }], 15, 'A'), []);
  });

  test('a CDS that is not a whole number of codons is flagged', () => {
    const [c] = codingChanges(seq, [{ ...cds, end: 24 }], 15, 'A');
    assert.match(c.caution!, /not a whole number of codons/);
  });

  test('two overlapping CDSs each report their own effect', () => {
    const other = { name: 'overlap', type: 'CDS', start: 12, end: 23, strand: 1 as const };
    const changes = codingChanges(seq, [cds, other], 15, 'A');
    assert.deepEqual(changes.map(c => c.feature), ['geneX', 'overlap']);
    assert.notEqual(changes[0].codonPosition, changes[1].codonPosition);
  });
});
