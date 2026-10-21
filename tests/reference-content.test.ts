import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_VECTORS, STANDARD_PRIMERS, mergeAnnotations } from '../src/lib/reference-content.ts';
import type { SequenceFeature } from '../src/lib/features.ts';
import type { Annotation } from '../src/lib/annotation.ts';

describe('the reference lists', () => {
  test('each vector is a distinct GenBank accession with a distinct name', () => {
    const acc = REFERENCE_VECTORS.map(v => v.accession);
    assert.equal(new Set(acc).size, acc.length);
    assert.equal(new Set(REFERENCE_VECTORS.map(v => v.name)).size, acc.length);
    for (const a of acc) assert.match(a, /^[A-Z]{1,2}\d{5,6}$/, `${a} is a nucleotide accession`);
  });

  test('every primer is plain DNA, unique, and names the vectors it was checked on', () => {
    const known = new Set(REFERENCE_VECTORS.map(v => v.accession));
    assert.equal(new Set(STANDARD_PRIMERS.map(p => p.sequence)).size, STANDARD_PRIMERS.length);
    for (const p of STANDARD_PRIMERS) {
      assert.match(p.sequence, /^[ACGT]{16,25}$/, p.name);
      assert.ok(p.verifiedOn.length > 0, `${p.name} was checked against something`);
      for (const a of p.verifiedOn) assert.ok(known.has(a), `${p.name}: ${a} is one of the reference vectors`);
    }
  });
});

describe('filling out a sparse GenBank record', () => {
  const f = (name: string, type: string, start: number, end: number): SequenceFeature =>
    ({ id: `${name}-${start}`, name, type, start, end, strand: 1, color: '#000' });
  const a = (name: string, type: string, start: number, end: number, identity = 1): Annotation =>
    ({ name, type, start, end, strand: 1, identity, color: '#123' });

  test('a bare record gets every detected part', () => {
    const merged = mergeAnnotations([], [a('AmpR', 'CDS', 1626, 2486), a('ori', 'rep_origin', 867, 1455)]);
    assert.deepEqual(merged.map(m => m.name), ['ori', 'AmpR'], 'sorted along the sequence');
    assert.equal(merged[1].notes, 'Detected');
  });

  test("the record's own feature wins over a detection of the same part", () => {
    const merged = mergeAnnotations([f('bla', 'CDS', 1626, 2486)], [a('AmpR', 'CDS', 1628, 2486)]);
    assert.deepEqual(merged.map(m => m.name), ['bla']);
  });

  test('a partial detection inside a longer record feature of the same type is not a second copy', () => {
    const merged = mergeAnnotations([f('nptII', 'CDS', 2136, 2930)], [a('KanR', 'CDS', 2136, 2288, 0.86)]);
    assert.deepEqual(merged.map(m => m.name), ['nptII']);
  });

  test('a detection elsewhere, or of another type, is still added, with its identity', () => {
    const merged = mergeAnnotations([f('bla', 'CDS', 1626, 2486)], [a('lacZα', 'CDS', 146, 469, 0.97), a('lac promoter', 'promoter', 1600, 1630)]);
    assert.equal(merged.length, 3);
    assert.match(merged.find(m => m.name === 'lacZα')!.notes!, /97% identity/);
  });
});
