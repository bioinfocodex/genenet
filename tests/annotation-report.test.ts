import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { annotationReport, uncovered } from '../src/lib/annotation-report.ts';
import type { SequenceFeature } from '../src/lib/features.ts';
import type { Annotation } from '../src/lib/annotation.ts';

const feat = (name: string, type: string, start: number, end: number): SequenceFeature =>
  ({ id: `${name}-${start}`, name, type, start, end, strand: 1, color: '#000' });
const hit = (name: string, type: string, start: number, end: number, identity = 1): Annotation =>
  ({ name, type, start, end, strand: 1, identity, color: '#123' });

describe('what auto-annotation reports', () => {
  test('new parts are added; ones already on the map are counted, not repeated', () => {
    const r = annotationReport(3000, true, [feat('bla', 'CDS', 1000, 1860)], [
      hit('AmpR', 'CDS', 1000, 1860),
      hit('pMB1 ori', 'rep_origin', 200, 814),
    ]);
    assert.deepEqual(r.added.map(f => f.name), ['pMB1 ori']);
    assert.equal(r.alreadyThere, 1);
  });

  test('approximate matches are listed with their identity', () => {
    const r = annotationReport(3000, true, [], [hit('KanR', 'CDS', 100, 894, 0.86), hit('lac operator', 'regulatory', 1000, 1022)]);
    assert.deepEqual(r.partial.map(p => [p.name, p.identity]), [['KanR', 0.86]]);
  });

  test('long stretches nothing covers are reported, longest first', () => {
    const r = annotationReport(5000, false, [feat('a', 'CDS', 1, 1000)], [hit('ori', 'rep_origin', 2000, 2600)]);
    assert.deepEqual(r.unannotated.map(u => [u.start, u.end]), [[2601, 5000], [1001, 1999]]);
  });
});

describe('uncovered stretches', () => {
  test('on a circle, the gap through the origin is one gap', () => {
    const gaps = uncovered(1000, true, [{ start: 200, end: 700 }], 100);
    assert.deepEqual(gaps, [{ start: 701, end: 199, length: 499 }]);
  });

  test('short gaps are not news', () => {
    assert.deepEqual(uncovered(1000, false, [{ start: 1, end: 450 }, { start: 500, end: 1000 }], 100), []);
  });
});
