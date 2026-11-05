import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findORFs, type ORF } from '../src/lib/simulation.ts';

/**
 * The two choices SnapGene offers about what counts as a reading frame, and
 * which we did not: whether a start codon is required, and whether a frame
 * running off the end of a linear molecule is worth showing.
 *
 * Both change what the ORF panel claims is there, which is the reason they
 * are worth testing rather than trusting.
 */

/** ATG + 33 codons + TAA: 105 nt, comfortably over the default floor. */
const CODING = 'ATG' + 'AAA'.repeat(33) + 'TAA';
const onPlus = (orfs: ORF[]) => orfs.filter(o => o.strand === '+');

describe('the defaults are what they were', () => {
  test('a start codon is required and the frame must close', () => {
    const found = onPlus(findORFs(CODING, 100));
    assert.equal(found.length, 1);
    assert.equal(found[0].start, 0);
    assert.equal(found[0].end, CODING.length);
    assert.equal(found[0].truncated, undefined);
  });

  test('a frame with no start codon is not an ORF by default', () => {
    // Same length, same stop, no ATG/GTG/TTG to open it.
    const noStart = 'CCC' + 'AAA'.repeat(33) + 'TAA';
    assert.equal(onPlus(findORFs(noStart, 100)).length, 0);
  });

  test('a frame that never stops is dropped by default', () => {
    const noStop = 'ATG' + 'AAA'.repeat(60);
    assert.equal(onPlus(findORFs(noStop, 100)).length, 0);
  });
});

describe('not requiring a start codon', () => {
  test('a stop-to-stop stretch counts', () => {
    const noStart = 'CCC' + 'AAA'.repeat(33) + 'TAA';
    const found = onPlus(findORFs(noStart, 100, { requireStart: false }));
    assert.equal(found.length, 1);
    assert.equal(found[0].start, 0);
  });

  test('the stretch after a stop is its own frame, not a continuation', () => {
    /*
     * Two stops means two stretches. Reopening at the base after the stop is
     * what makes the second one start where it does; carrying on through
     * would report one frame twice as long as anything in the sequence.
     */
    const two = 'AAA'.repeat(34) + 'TAA' + 'AAA'.repeat(34) + 'TAA';
    const found = onPlus(findORFs(two, 100, { requireStart: false }))
      .filter(o => o.frame === 1)
      .sort((a, b) => a.start - b.start);
    assert.equal(found.length, 2);
    assert.equal(found[0].start, 0);
    assert.equal(found[1].start, found[0].end);
  });

  test('it never reports less than requiring a start would', () => {
    const relaxed = onPlus(findORFs(CODING, 100, { requireStart: false }));
    const strict = onPlus(findORFs(CODING, 100));
    assert.ok(relaxed.length >= strict.length);
  });
});

describe('frames that run off the end', () => {
  const noStop = 'ATG' + 'AAA'.repeat(60);     // 183 nt, no stop codon

  test('kept when asked for, and marked', () => {
    const found = onPlus(findORFs(noStop, 100, { allowTruncated: true }));
    assert.equal(found.length, 1);
    assert.equal(found[0].truncated, true);
    assert.equal(found[0].start, 0);
  });

  test('it stops at the last whole codon, not at the last base', () => {
    // Two trailing bases belong to no codon and so to no reading frame.
    const ragged = 'ATG' + 'AAA'.repeat(60) + 'GG';
    const found = onPlus(findORFs(ragged, 100, { allowTruncated: true }));
    assert.equal(found[0].end % 3, 0);
    assert.equal(found[0].end, noStop.length);
  });

  test('a frame that does stop is not marked truncated', () => {
    const found = onPlus(findORFs(CODING, 100, { allowTruncated: true }));
    assert.equal(found[0].truncated, undefined);
  });

  test('the minimum length still applies to a truncated frame', () => {
    const shortOpen = 'ATG' + 'AAA'.repeat(5);     // 18 nt
    assert.equal(onPlus(findORFs(shortOpen, 100, { allowTruncated: true })).length, 0);
  });
});

describe('both relaxations together', () => {
  test('a sequence with neither a start nor a stop is one long frame', () => {
    const neither = 'AAA'.repeat(60);
    const found = onPlus(findORFs(neither, 100, { requireStart: false, allowTruncated: true }))
      .filter(o => o.frame === 1);
    assert.equal(found.length, 1);
    assert.equal(found[0].start, 0);
    assert.equal(found[0].truncated, true);
  });

  test('the coordinates stay inside the molecule on both strands', () => {
    const seq = 'ATGCCCAAATTTGGGCCCAAATTTGGG'.repeat(12);
    for (const o of findORFs(seq, 30, { requireStart: false, allowTruncated: true })) {
      assert.ok(o.start >= 0, `start ${o.start}`);
      assert.ok(o.end <= seq.length, `end ${o.end} > ${seq.length}`);
      assert.ok(o.end > o.start);
    }
  });
});
