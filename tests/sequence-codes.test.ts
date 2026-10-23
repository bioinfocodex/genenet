import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prefixFor, planBackfill, looksLikeCode, type Codeable } from '../src/lib/sequence-codes.ts';
import { nextCode } from '../src/lib/fields.ts';

const rec = (id: string, type: string, createdAt: string, code: string | null = null): Codeable =>
  ({ id, type, createdAt, code });

describe('which prefix a construct gets', () => {
  test('plasmids and genes are told apart', () => {
    assert.equal(prefixFor('plasmid'), 'PL');
    assert.equal(prefixFor('gene'), 'GN');
  });

  test('case does not matter, since imports set it in several ways', () => {
    assert.equal(prefixFor('Plasmid'), 'PL');
    assert.equal(prefixFor('PLASMID'), 'PL');
  });

  test('a type nobody planned for still gets a code', () => {
    // Refusing to issue one would leave the record with no identifier at all,
    // which is worse than filing it under the general prefix.
    assert.equal(prefixFor('mRNA'), 'GN');
    assert.equal(prefixFor(''), 'GN');
    assert.equal(prefixFor(null), 'GN');
    assert.equal(prefixFor(undefined), 'GN');
  });
});

describe('handing out codes to everything already there', () => {
  test('oldest first, so the numbers run in the order the lab made things', () => {
    // It matters only once -- but it is the once that decides what PL-001 is
    // for ever.
    const plan = planBackfill([
      rec('c', 'plasmid', '2026-03-01T00:00:00Z'),
      rec('a', 'plasmid', '2026-01-01T00:00:00Z'),
      rec('b', 'plasmid', '2026-02-01T00:00:00Z'),
    ]);
    assert.deepEqual(plan.assignments, [
      { id: 'a', code: 'PL-001' },
      { id: 'b', code: 'PL-002' },
      { id: 'c', code: 'PL-003' },
    ]);
  });

  test('each prefix counts on its own', () => {
    const plan = planBackfill([
      rec('a', 'plasmid', '2026-01-01T00:00:00Z'),
      rec('b', 'gene', '2026-01-02T00:00:00Z'),
      rec('c', 'plasmid', '2026-01-03T00:00:00Z'),
      rec('d', 'gene', '2026-01-04T00:00:00Z'),
    ]);
    assert.deepEqual(plan.assignments.map(a => a.code), ['PL-001', 'GN-001', 'PL-002', 'GN-002']);
  });

  test('records that already have a code are left alone and counted', () => {
    const plan = planBackfill([
      rec('a', 'plasmid', '2026-01-01T00:00:00Z', 'PL-007'),
      rec('b', 'plasmid', '2026-01-02T00:00:00Z'),
    ]);
    assert.equal(plan.alreadyCoded, 1);
    assert.deepEqual(plan.assignments, [{ id: 'b', code: 'PL-008' }]);
  });

  test('running it twice hands out nothing the second time', () => {
    const records = [
      rec('a', 'plasmid', '2026-01-01T00:00:00Z'),
      rec('b', 'gene', '2026-01-02T00:00:00Z'),
    ];
    const first = planBackfill(records);
    const after = records.map(r => ({
      ...r,
      code: first.assignments.find(x => x.id === r.id)?.code ?? r.code,
    }));
    const second = planBackfill(after);
    assert.deepEqual(second.assignments, []);
    assert.equal(second.alreadyCoded, 2);
  });

  test('a code issued by hand is not collided with', () => {
    const plan = planBackfill([
      rec('hand', 'plasmid', '2026-05-01T00:00:00Z', 'PL-100'),
      rec('a', 'plasmid', '2026-01-01T00:00:00Z'),
    ]);
    assert.deepEqual(plan.assignments, [{ id: 'a', code: 'PL-101' }]);
  });

  test('records made at the same instant still get a stable order', () => {
    // Two rows written by one import share a timestamp. Falling back to the
    // id keeps the result the same whichever order the database returns.
    const same = '2026-01-01T00:00:00Z';
    const one = planBackfill([rec('z', 'gene', same), rec('a', 'gene', same)]);
    const two = planBackfill([rec('a', 'gene', same), rec('z', 'gene', same)]);
    assert.deepEqual(one.assignments, two.assignments);
    assert.equal(one.assignments[0].id, 'a');
  });

  test('nothing to do is not an error', () => {
    assert.deepEqual(planBackfill([]), { assignments: [], alreadyCoded: 0 });
  });
});

describe('a deleted record does not give its code away again', () => {
  test('numbering counts from the highest used, not from how many there are', () => {
    // Reusing a deleted record's code would put two different things under
    // one identifier on two different tubes.
    assert.equal(nextCode('PL', ['PL-001', 'PL-003']), 'PL-004');
  });
});

describe('telling a scan from a search', () => {
  test('a code is recognised', () => {
    assert.ok(looksLikeCode('PL-001'));
    assert.ok(looksLikeCode('pl-001'));
    assert.ok(looksLikeCode(' GN-42 '));
  });

  test('a name is not', () => {
    for (const s of ['pEGFP-N1', 'pUC19', 'EGFP', '', 'PL001', 'PL-', '-001', 'PLASMID-ONE']) {
      assert.equal(looksLikeCode(s), false, s);
    }
  });
});
