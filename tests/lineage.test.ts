import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, type LineageNode } from '../src/lib/lineage.ts';

/**
 * The database-backed walk is exercised against the real schema elsewhere; what
 * is worth pinning here is the shape it produces, because the rendering depends
 * on it and the distinction between a parent that is gone and one that was never
 * linked is easy to collapse by accident.
 */
const node = (over: Partial<LineageNode>): LineageNode => ({
  id: 'x', name: 'x', depth: 0, missing: false, unlinked: false, parents: [], ...over,
});

describe('lineage shape', () => {
  test('flatten walks parents depth-first, under their child', () => {
    const tree = node({
      id: 'c', name: 'construct', parents: [
        node({ id: 'a', name: 'vector', depth: 1, method: 'Gibson', parents: [
          node({ id: 'a0', name: 'older backbone', depth: 2, method: 'Golden Gate' }),
        ] }),
        node({ id: 'b', name: 'insert', depth: 1, method: 'Gibson' }),
      ],
    });
    assert.deepEqual(flatten(tree).map(n => n.name),
      ['construct', 'vector', 'older backbone', 'insert']);
  });

  test('depth carries the generation, which is what the indentation draws', () => {
    const tree = node({
      name: 'c', parents: [node({ name: 'p', depth: 1, parents: [node({ name: 'g', depth: 2 })] })],
    });
    assert.deepEqual(flatten(tree).map(n => n.depth), [0, 1, 2]);
  });

  test('a deleted parent and an unlinked one are different states', () => {
    // Both render greyed, but one means "this record is gone" and the other
    // means "we only ever knew the name". Collapsing them would report a
    // present part as deleted.
    const deleted = node({ id: 'gone', name: 'old vector', missing: true, unlinked: false });
    const byName = node({ id: null, name: 'a gel band', missing: false, unlinked: true });
    assert.notEqual(deleted.missing, byName.missing);
    assert.notEqual(deleted.unlinked, byName.unlinked);
  });

  test('a node with no parents flattens to itself', () => {
    assert.deepEqual(flatten(node({ name: 'lone' })).map(n => n.name), ['lone']);
  });
});
