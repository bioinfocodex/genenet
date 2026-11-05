import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sliceRange, rangeLength, asStrand, asAminoAcids,
  clipFeatures, extractRegion, extractedName,
} from '../src/lib/selection.ts';
import type { SequenceFeature } from '../src/lib/features.ts';

const feat = (over: Partial<SequenceFeature>): SequenceFeature => ({
  id: 'f1', name: 'thing', start: 1, end: 10, color: '#888', type: 'CDS', strand: 1, ...over,
});

describe('taking the bases of a range', () => {
  const seq = 'AAAACCCCGGGGTTTT';   // 16 bases

  test('an ordinary range', () => {
    assert.equal(sliceRange(seq, 5, 8), 'CCCC');
    assert.equal(sliceRange(seq, 1, 4), 'AAAA');
  });

  test('a single base', () => {
    assert.equal(sliceRange(seq, 1, 1), 'A');
  });

  test('a range through the origin follows the molecule round', () => {
    // 15..2 is TT then AA, which is what the selection means on a plasmid.
    assert.equal(sliceRange(seq, 15, 2), 'TTAA');
  });

  test('its length counts the way round, not the difference', () => {
    assert.equal(rangeLength(5, 8, 16), 4);
    assert.equal(rangeLength(15, 2, 16), 4);
  });
});

describe('the strand forms', () => {
  // ATGC: complement is TACG, reverse complement is GCAT.
  test('the top strand is what was selected', () => {
    assert.equal(asStrand('ATGC', 'top'), 'ATGC');
  });

  test("bottom 5'->3' is the reverse complement, which is what gets ordered", () => {
    assert.equal(asStrand('ATGC', 'bottom-5to3'), 'GCAT');
  });

  test("bottom 3'->5' is the complement in place, as the view draws it", () => {
    /*
     * The difference between these two is the thing people get wrong doing
     * it by hand, which is the reason both are offered rather than one.
     */
    assert.equal(asStrand('ATGC', 'bottom-3to5'), 'TACG');
  });

  test('the two bottom forms are reverses of each other', () => {
    const a = asStrand('ATGCCGTA', 'bottom-5to3');
    const b = asStrand('ATGCCGTA', 'bottom-3to5');
    assert.equal(a.split('').reverse().join(''), b);
  });

  test('lower case in, upper case out', () => {
    assert.equal(asStrand('atgc', 'bottom-5to3'), 'GCAT');
  });
});

describe('reading a range as protein', () => {
  test('a clean three-codon range', () => {
    // ATG GCC TAA -> M A *
    const out = asAminoAcids('ATGGCCTAA');
    assert.equal(out.protein, 'MA*');
    assert.equal(out.leftover, 0);
  });

  test('three-letter form is hyphenated', () => {
    assert.equal(asAminoAcids('ATGGCC', 'three').protein, 'Met-Ala');
  });

  test('it translates from the first base of the range, not a guessed frame', () => {
    // Somebody who wanted another frame would have selected from another base.
    assert.notEqual(asAminoAcids('AATGGCC').protein, asAminoAcids('ATGGCC').protein);
  });

  test('a stop in the middle does not truncate what was asked for', () => {
    // The stop is information about the selection, not a reason to return less.
    const out = asAminoAcids('ATGTAAGCC');
    assert.equal(out.protein, 'M*A');
  });

  test('trailing bases that do not fill a codon are reported, not guessed', () => {
    const out = asAminoAcids('ATGGC');
    assert.equal(out.protein, 'M');
    assert.equal(out.leftover, 2);
  });

  test('an empty range gives nothing rather than throwing', () => {
    assert.deepEqual(asAminoAcids(''), { protein: '', leftover: 0 });
  });
});

describe('which features come with a region', () => {
  const features = [
    feat({ id: 'inside', name: 'inside', start: 20, end: 30 }),
    feat({ id: 'before', name: 'before', start: 1, end: 5 }),
    feat({ id: 'after', name: 'after', start: 80, end: 90 }),
    feat({ id: 'straddles', name: 'straddles', start: 5, end: 25 }),
  ];

  test('a feature wholly inside comes along, renumbered to the region', () => {
    const out = clipFeatures(features, 10, 40, 100, { renumber: true });
    const inside = out.find(f => f.id === 'inside')!;
    assert.equal(inside.start, 11);   // base 20 is the 11th base of 10..40
    assert.equal(inside.end, 21);
  });

  test('features outside are left behind', () => {
    const out = clipFeatures(features, 10, 40, 100, { renumber: true });
    assert.ok(!out.some(f => f.id === 'before'));
    assert.ok(!out.some(f => f.id === 'after'));
  });

  test('a feature straddling the edge is cut and says so', () => {
    /*
     * Dropping it loses the fact that the region sits inside a CDS; keeping
     * it whole would claim the new record contains bases it does not.
     */
    const out = clipFeatures(features, 10, 40, 100, { renumber: true });
    const cut = out.find(f => f.id === 'straddles')!;
    assert.equal(cut.start, 1);
    assert.equal(cut.end, 16);        // base 25 is the 16th base of 10..40
    assert.match(cut.name, /partial/);
  });

  test('partial features can be dropped instead', () => {
    const out = clipFeatures(features, 10, 40, 100, { renumber: true, clipPartial: false });
    assert.ok(!out.some(f => f.id === 'straddles'));
  });

  test('the original numbering can be kept', () => {
    const out = clipFeatures(features, 10, 40, 100, { renumber: false });
    const inside = out.find(f => f.id === 'inside')!;
    assert.equal(inside.start, 20);
    assert.equal(inside.end, 30);
  });

  test('a spliced feature loses its segments once it is cut', () => {
    // A join() whose exons have been cut no longer describes this molecule,
    // and carrying the blocks forward would place introns where there are none.
    const spliced = [feat({ id: 's', start: 5, end: 25, segments: [{ start: 5, end: 10 }, { start: 20, end: 25 }] })];
    const out = clipFeatures(spliced, 10, 40, 100, { renumber: true });
    assert.equal(out[0].segments, undefined);
  });

  test('they come back in order along the new record', () => {
    const many = [
      feat({ id: 'c', start: 35, end: 38 }),
      feat({ id: 'a', start: 12, end: 14 }),
      feat({ id: 'b', start: 20, end: 22 }),
    ];
    const out = clipFeatures(many, 10, 40, 100, { renumber: true });
    assert.deepEqual(out.map(f => f.id), ['a', 'b', 'c']);
  });

  test('a region through the origin collects features from both sides', () => {
    const plasmid = [
      feat({ id: 'tail', start: 95, end: 99 }),
      feat({ id: 'head', start: 2, end: 6 }),
      feat({ id: 'middle', start: 40, end: 50 }),
    ];
    const out = clipFeatures(plasmid, 90, 10, 100, { renumber: true });
    assert.deepEqual(out.map(f => f.id).sort(), ['head', 'tail']);
    // 90..10 is 21 bases; base 95 is the 6th, base 2 is the 13th.
    assert.equal(out.find(f => f.id === 'tail')!.start, 6);
    assert.equal(out.find(f => f.id === 'head')!.start, 13);
  });
});

describe('extracting a region', () => {
  const seq = 'AAAACCCCGGGGTTTT';

  test('bases and features together', () => {
    const features = [feat({ id: 'g', name: 'G-run', start: 9, end: 12 })];
    const out = extractRegion(seq, features, 5, 12, { renumber: true });
    assert.equal(out.sequence, 'CCCCGGGG');
    assert.equal(out.features[0].start, 5);
    assert.equal(out.features[0].end, 8);
  });

  test('a region through the origin', () => {
    const out = extractRegion(seq, [], 15, 2, { renumber: true });
    assert.equal(out.sequence, 'TTAA');
  });

  test('the name says where it came from', () => {
    assert.equal(extractedName('pUC19', 100, 250), 'pUC19 100-250');
  });
});
