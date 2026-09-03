import test from 'node:test';
import assert from 'node:assert/strict';
import { openTab, closeTab, readDesk, writeDesk, MAX_TABS } from '../src/lib/workspace.ts';

test('opening a file that is already open focuses it instead of duplicating it', () => {
  const desk = { open: ['a', 'b'], active: 'a' };
  assert.deepEqual(openTab(desk, 'b'), { open: ['a', 'b'], active: 'b' });
});

test('past the ceiling the oldest tab goes, not the new one', () => {
  // Refusing the new file is what makes people think the tree is broken.
  let desk = { open: [] as string[], active: null as string | null };
  for (let i = 0; i < MAX_TABS + 3; i++) desk = openTab(desk, `s${i}`);
  assert.equal(desk.open.length, MAX_TABS);
  assert.equal(desk.active, `s${MAX_TABS + 2}`);
  assert.ok(!desk.open.includes('s0'));
});

test('closing the active tab lands on its left neighbour', () => {
  assert.deepEqual(closeTab({ open: ['a', 'b', 'c'], active: 'b' }, 'b'), { open: ['a', 'c'], active: 'a' });
});

test('closing the leftmost active tab lands on the new leftmost', () => {
  assert.deepEqual(closeTab({ open: ['a', 'b', 'c'], active: 'a' }, 'a'), { open: ['b', 'c'], active: 'b' });
});

test('closing a tab you are not looking at leaves your place alone', () => {
  assert.deepEqual(closeTab({ open: ['a', 'b', 'c'], active: 'c' }, 'a'), { open: ['b', 'c'], active: 'c' });
});

test('closing the last tab leaves nothing active rather than a dangling id', () => {
  assert.deepEqual(closeTab({ open: ['a'], active: 'a' }, 'a'), { open: [], active: null });
});

test('closing something that is not open changes nothing', () => {
  const desk = { open: ['a'], active: 'a' };
  assert.deepEqual(closeTab(desk, 'zzz'), desk);
});

test('a hand-edited URL cannot open the same file twice or point at a closed one', () => {
  assert.deepEqual(readDesk('a,b,a', 'b'), { open: ['a', 'b'], active: 'b' });
  // active naming a file that is not open falls back to the first.
  assert.deepEqual(readDesk('a,b', 'zzz'), { open: ['a', 'b'], active: 'a' });
  assert.deepEqual(readDesk('', null), { open: [], active: null });
  assert.deepEqual(readDesk(' a , , b ', null), { open: ['a', 'b'], active: 'a' });
});

test('a desk survives a round trip through the URL', () => {
  const desk = { open: ['x', 'y', 'z'], active: 'y' };
  const q = new URLSearchParams(writeDesk(desk).slice(1));
  assert.deepEqual(readDesk(q.get('open'), q.get('active')), desk);
  assert.equal(writeDesk({ open: [], active: null }), '');
});
