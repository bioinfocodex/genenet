import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseFeatures, codingLength, intronsOf, colourForType } from '../src/lib/features.ts';
import { parseGenBankFile } from '../src/lib/sequence-import.ts';

describe('reading stored features', () => {
  test('a record written by an importer is shifted to 1-indexed', () => {
    // GenBank printed "1..12"; the parser stored 0..11.
    const [f] = normaliseFeatures(JSON.stringify([
      { name: 'demo', type: 'CDS', start: 0, end: 11, strand: '+' },
    ]));
    assert.equal(f.start, 1, 'must read back as the 1 the file showed');
    assert.equal(f.end, 12);
  });

  test('a record written by the viewer is left where it is', () => {
    const [f] = normaliseFeatures(JSON.stringify([
      { id: 'x', name: 'demo', type: 'CDS', start: 1, end: 12, strand: 1, color: '#fff' },
    ]));
    assert.equal(f.start, 1, 'already 1-indexed: shifting again would corrupt it');
    assert.equal(f.end, 12);
    assert.equal(f.color, '#fff', 'an explicit colour is kept');
    assert.equal(f.id, 'x');
  });

  test("string strand becomes numeric", () => {
    const fs = normaliseFeatures(JSON.stringify([
      { name: 'a', type: 'gene', start: 0, end: 5, strand: '-' },
      { name: 'b', type: 'gene', start: 0, end: 5, strand: '+' },
    ]));
    assert.equal(fs[0].strand, -1);
    assert.equal(fs[1].strand, 1);
  });

  test('missing id and colour are supplied, and stay stable', () => {
    const json = JSON.stringify([{ name: 'a', type: 'CDS', start: 0, end: 5, strand: '+' }]);
    const first = normaliseFeatures(json)[0];
    const again = normaliseFeatures(json)[0];
    assert.ok(first.id);
    assert.ok(first.color);
    assert.equal(first.id, again.id, 'ids must not change between page loads');
    assert.equal(first.color, again.color);
  });

  test('malformed input yields nothing rather than throwing', () => {
    assert.deepEqual(normaliseFeatures(null), []);
    assert.deepEqual(normaliseFeatures('not json'), []);
    assert.deepEqual(normaliseFeatures('{"not":"an array"}'), []);
    assert.deepEqual(normaliseFeatures('[null, 3, "x"]'), []);
    assert.deepEqual(normaliseFeatures('[{"name":"no coords"}]'), []);
  });
});

describe('spliced features', () => {
  const gb = `LOCUS       TEST        60 bp    DNA     linear   UNA 01-JAN-2026
FEATURES             Location/Qualifiers
     CDS             join(1..12,31..42)
                     /gene="demo"
ORIGIN
        1 atgggcaaac cctttgggaa accctttggg aaaccctttg ggaaaccctt tgggaaaccc
//`;

  test('a join() survives import, storage and reading back', () => {
    const parsed = parseGenBankFile(gb)!;
    // exactly what the import action writes
    const stored = JSON.stringify(parsed.features);
    const [f] = normaliseFeatures(stored);

    assert.ok(f.segments, 'segments must reach the viewer');
    assert.equal(f.segments!.length, 2);
    assert.deepEqual(f.segments, [{ start: 1, end: 12 }, { start: 31, end: 42 }]);
    assert.equal(f.start, 1);
    assert.equal(f.end, 42);
  });

  test('coding length counts exons, not the span', () => {
    const [f] = normaliseFeatures(JSON.stringify(parseGenBankFile(gb)!.features));
    assert.equal(f.end - f.start + 1, 42, 'the span includes the intron');
    assert.equal(codingLength(f), 24, 'the exons are 12 + 12');
  });

  test('the intron is derived from the gap between exons', () => {
    const [f] = normaliseFeatures(JSON.stringify(parseGenBankFile(gb)!.features));
    assert.deepEqual(intronsOf(f), [{ start: 13, end: 30 }]);
  });

  test('an unspliced feature has no segments and no introns', () => {
    const [f] = normaliseFeatures(JSON.stringify([
      { name: 'a', type: 'gene', start: 0, end: 9, strand: '+' },
    ]));
    assert.equal(f.segments, undefined, 'one block is not a splice');
    assert.deepEqual(intronsOf(f), []);
    assert.equal(codingLength(f), 10);
  });

  test('a single-segment join is not treated as spliced', () => {
    const [f] = normaliseFeatures(JSON.stringify([
      { name: 'a', type: 'CDS', start: 0, end: 9, strand: '+', segments: [{ start: 0, end: 9 }] },
    ]));
    assert.equal(f.segments, undefined);
  });

  test('segments are ordered, whatever order they were stored in', () => {
    const [f] = normaliseFeatures(JSON.stringify([
      { name: 'a', type: 'CDS', start: 0, end: 41, strand: '+',
        segments: [{ start: 30, end: 41 }, { start: 0, end: 11 }] },
    ]));
    assert.deepEqual(f.segments, [{ start: 1, end: 12 }, { start: 31, end: 42 }]);
    assert.deepEqual(intronsOf(f), [{ start: 13, end: 30 }]);
  });
});

describe('colours', () => {
  test('the same type always gets the same colour', () => {
    assert.equal(colourForType('CDS'), colourForType('CDS'));
  });
  test('the types that share a map do not share a colour', () => {
    // These co-occur constantly; a collision between any two is a real defect,
    // and CDS/promoter did collide before they were pinned.
    const common = ['CDS', 'gene', 'promoter', 'terminator', 'rep_origin', 'primer_bind'];
    const seen = new Set(common.map(colourForType));
    assert.equal(seen.size, common.length, 'every common feature type needs its own colour');
  });
});
