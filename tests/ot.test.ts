import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  apply, applyAll, transform, transformOver, commit, diff,
  stillHere, slidePresence, PRESENCE_TIMEOUT_MS,
  type Op, type Committed, type Presence,
} from '../src/lib/ot.ts';

const ins = (at: number, insert: string): Op => ({ at, insert });
const del = (at: number, remove: number): Op => ({ at, remove });

describe('applying one change', () => {
  test('insert and remove', () => {
    assert.equal(apply('hello', ins(5, ' world')), 'hello world');
    assert.equal(apply('hello world', del(5, 6)), 'hello');
    assert.equal(apply('abc', ins(0, 'X')), 'Xabc');
  });

  test('a position past the end is clamped rather than thrown', () => {
    // An op describing a longer document is a bug somewhere, and losing the
    // whole entry to an exception is a worse answer than appending.
    assert.equal(apply('abc', ins(99, 'X')), 'abcX');
    assert.equal(apply('abc', del(1, 99)), 'a');
    assert.equal(apply('abc', del(99, 2)), 'abc');
  });

  test('a run of changes applies in order', () => {
    assert.equal(applyAll('abc', [ins(3, 'd'), del(0, 1)]), 'bcd');
  });
});

describe('rebasing one change over another', () => {
  test('an insert after another insert moves along', () => {
    assert.deepEqual(transform(ins(5, 'x'), ins(2, 'ab')), [ins(7, 'x')]);
  });

  test('an insert before another is untouched', () => {
    assert.deepEqual(transform(ins(1, 'x'), ins(5, 'ab')), [ins(1, 'x')]);
  });

  test('two inserts at the same spot are ordered by the tie-break', () => {
    // Without one, two people typing at the same position see each other's
    // characters interleaved differently on each screen.
    assert.deepEqual(transform(ins(3, 'x'), ins(3, 'ab'), 'left'), [ins(3, 'x')]);
    assert.deepEqual(transform(ins(3, 'x'), ins(3, 'ab'), 'right'), [ins(5, 'x')]);
  });

  test('an insert inside deleted text collapses to the hole', () => {
    assert.deepEqual(transform(ins(5, 'x'), del(3, 4)), [ins(3, 'x')]);
  });

  test('an insert after deleted text moves back', () => {
    assert.deepEqual(transform(ins(10, 'x'), del(3, 4)), [ins(6, 'x')]);
  });

  test('a delete after an insert moves along', () => {
    assert.deepEqual(transform(del(5, 2), ins(1, 'abc')), [del(8, 2)]);
  });

  test('a delete spanning an insert splits around it, keeping the typing', () => {
    /*
     * Deleting through would be simpler and is what several well-known
     * implementations do. It also means a colleague's sentence vanishes
     * because somebody happened to be deleting a paragraph around it.
     */
    const out = transform(del(2, 6), ins(5, 'NEW'));
    // The second piece is positioned after the first has been applied, not
    // against the document both were computed from.
    assert.deepEqual(out, [del(2, 3), del(5, 3)]);

    const afterInsert = apply('abcdefghij', ins(5, 'NEW'));
    assert.equal(afterInsert, 'abcdeNEWfghij');
    assert.equal(applyAll(afterInsert, out), 'abNEWij', 'the typing survives, the deletion happens');
  });

  test('overlapping deletes remove only what is left', () => {
    // a wants 4..10, b already took 6..12. Four characters remain to remove.
    assert.deepEqual(transform(del(4, 6), del(6, 6)), [del(4, 2)]);
  });

  test('a delete of text already gone has nothing to do', () => {
    assert.deepEqual(transform(del(4, 2), del(2, 8)), []);
    assert.deepEqual(transform(del(4, 2), del(4, 2)), []);
  });

  test('an empty change is no change', () => {
    assert.deepEqual(transform(ins(3, ''), ins(1, 'a')), []);
    assert.deepEqual(transform(del(3, 0), ins(1, 'a')), []);
  });

  test('rebasing over a run applies each in turn', () => {
    assert.deepEqual(transformOver(ins(5, 'x'), [ins(1, 'ab'), del(0, 1)]), [ins(6, 'x')]);
  });
});

describe('convergence', () => {
  /**
   * The property that matters, checked by brute force rather than asserted.
   *
   * Two people start from the same text and each make one change without
   * seeing the other's. Whichever order the server happens to receive them
   * in, both must end up looking at the same document -- otherwise two
   * scientists are editing what they believe is one entry and is not.
   */
  const applyBoth = (text: string, a: Op, b: Op): [string, string] => {
    // a first, then b rebased over a.
    const left = applyAll(apply(text, a), transform(b, a, 'right'));
    // b first, then a rebased over b.
    const right = applyAll(apply(text, b), transform(a, b, 'left'));
    return [left, right];
  };

  test('every pair of concurrent changes converges', () => {
    const text = 'the quick brown fox jumps';
    const candidates: Op[] = [];
    for (let at = 0; at <= text.length; at += 3) {
      candidates.push(ins(at, 'X'), ins(at, 'LONGER'));
      for (const n of [1, 4, 9]) candidates.push(del(at, n));
    }

    let checked = 0;
    for (const a of candidates) {
      for (const b of candidates) {
        const [left, right] = applyBoth(text, a, b);
        assert.equal(left, right, `diverged on ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        checked++;
      }
    }
    assert.ok(checked > 1000, `only ${checked} pairs checked`);
  });

  test('it converges on random changes too', () => {
    // A deterministic pseudo-random walk, so a failure can be reproduced.
    let state = 20261023;
    const rnd = () => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;

    for (let trial = 0; trial < 400; trial++) {
      const len = 5 + Math.floor(rnd() * 25);
      const text = Array.from({ length: len }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
      const pick = (): Op => {
        const at = Math.floor(rnd() * (text.length + 1));
        return rnd() < 0.5
          ? ins(at, 'xyz'.slice(0, 1 + Math.floor(rnd() * 3)))
          : del(Math.min(at, text.length), 1 + Math.floor(rnd() * 5));
      };
      const [a, b] = [pick(), pick()];
      const [left, right] = applyBoth(text, a, b);
      assert.equal(left, right, `trial ${trial}: ${JSON.stringify([text, a, b])}`);
    }
  });
});

describe('what the server does with a change', () => {
  const base = (text: string) => ({ text, version: 0, history: [] as Committed[] });

  test('a change against the current version just applies', () => {
    const { text, version, history } = base('hello');
    const r = commit(text, version, history, { base: 0, ops: [ins(5, ' world')], author: 'jane' });
    assert.equal(r.text, 'hello world');
    assert.equal(r.version, 1);
  });

  test('a change written against an older version is rebased', () => {
    // Jane typed at the start while John was typing at the end.
    const history: Committed[] = [{ version: 1, ops: [ins(0, 'oh ')], author: 'jane' }];
    const r = commit('oh hello', 1, history, { base: 0, ops: [ins(5, ' world')], author: 'john' });
    assert.equal(r.text, 'oh hello world');
    assert.deepEqual(r.applied, [ins(8, ' world')]);
  });

  test('both orders of arrival give the same document', () => {
    const a = { base: 0, ops: [ins(0, 'A')], author: 'aaa' };
    const b = { base: 0, ops: [ins(0, 'B')], author: 'bbb' };

    const first = commit('x', 0, [], a);
    const thenB = commit(first.text, first.version,
      [{ version: 1, ops: first.applied, author: a.author }], b);

    const other = commit('x', 0, [], b);
    const thenA = commit(other.text, other.version,
      [{ version: 1, ops: other.applied, author: b.author }], a);

    assert.equal(thenB.text, thenA.text);
  });

  test('several ops in one change are rebased over each other as well', () => {
    // The bug this catches: a two-op paste landing in the wrong order because
    // the second op was positioned against the text before the first.
    const r = commit('abc', 0, [], { base: 0, ops: [del(0, 1), ins(0, 'X')], author: 'jane' });
    assert.equal(r.text, 'Xbc');
  });

  test('a change against a version the server has lost is refused, not guessed', () => {
    // Silently applying stale positions is how a paragraph lands in the
    // middle of a word.
    const r = commit('hello', 5, [], { base: 0, ops: [ins(0, 'x')], author: 'jane' });
    assert.equal(r.tooOld, true);
    assert.equal(r.text, 'hello', 'and nothing is changed');
  });

  test('a change claiming a version ahead of the server is refused too', () => {
    const r = commit('hello', 1, [], { base: 9, ops: [ins(0, 'x')], author: 'jane' });
    assert.equal(r.tooOld, true);
  });

  test('a change that rebases away leaves the text alone but still advances', () => {
    const history: Committed[] = [{ version: 1, ops: [del(0, 5)], author: 'jane' }];
    const r = commit('', 1, history, { base: 0, ops: [del(0, 5)], author: 'john' });
    assert.deepEqual(r.applied, []);
    assert.equal(r.text, '');
  });
});

describe('turning a textarea into changes', () => {
  test('typing a character', () => {
    assert.deepEqual(diff('hello', 'hellxo'), [ins(4, 'x')]);
  });

  test('deleting a selection', () => {
    assert.deepEqual(diff('hello world', 'hello'), [del(5, 6)]);
  });

  test('replacing a selection is a delete and an insert at the same place', () => {
    assert.deepEqual(diff('hello world', 'hello there'), [del(6, 5), ins(6, 'there')]);
  });

  test('no change is no ops', () => {
    assert.deepEqual(diff('same', 'same'), []);
  });

  test('from nothing, and to nothing', () => {
    assert.deepEqual(diff('', 'abc'), [ins(0, 'abc')]);
    assert.deepEqual(diff('abc', ''), [del(0, 3)]);
  });

  test('the ops it finds actually turn one into the other', () => {
    const pairs = [
      ['hello', 'hello world'], ['hello world', 'hello'], ['abc', 'axc'],
      ['', 'x'], ['x', ''], ['aaa', 'aa'], ['aa', 'aaa'],
      ['the quick fox', 'the slow brown fox'], ['repeat repeat', 'repeat'],
    ];
    for (const [before, after] of pairs) {
      assert.equal(applyAll(before, diff(before, after)), after, `${before} -> ${after}`);
    }
  });
});

describe('who else is here', () => {
  const now = 1_700_000_000_000;
  const person = (id: string, name: string, seen: number, at?: number, userId = id): Presence =>
    ({ id, userId, name, seen, ...(at === undefined ? {} : { at }) });

  test('somebody heard from recently is here', () => {
    const out = stillHere([person('a', 'Ann', now - 1000)], now);
    assert.equal(out.length, 1);
  });

  test('somebody who closed a laptop lid is not', () => {
    // A browser never says goodbye, so absence has to be inferred. Reporting
    // somebody present ten minutes after they left makes the whole indicator
    // untrustworthy.
    const out = stillHere([person('a', 'Ann', now - PRESENCE_TIMEOUT_MS - 1)], now);
    assert.deepEqual(out, []);
  });

  test('they come back in a stable order', () => {
    const out = stillHere([person('b', 'Zoe', now), person('a', 'Ann', now)], now);
    assert.deepEqual(out.map(p => p.name), ['Ann', 'Zoe']);
  });

  test('cursors move along with an edit', () => {
    const people = [person('a', 'Ann', now, 10), person('b', 'Bob', now, 2)];
    const out = slidePresence(people, ins(5, 'abc'));
    assert.equal(out[0].at, 13);
    assert.equal(out[1].at, 2, 'a cursor before the edit does not move');
  });

  test('a cursor inside deleted text lands at the hole', () => {
    const out = slidePresence([person('a', 'Ann', now, 7)], del(5, 4));
    assert.equal(out[0].at, 5);
  });

  test('somebody with no cursor yet is left alone', () => {
    const out = slidePresence([person('a', 'Ann', now)], ins(0, 'x'));
    assert.equal(out[0].at, undefined);
  });
});

describe('one person, two tabs', () => {
  const now = 1_700_000_000_000;
  const conn = (id: string, userId: string, name: string, seen: number, at?: number): Presence =>
    ({ id, userId, name, seen, ...(at === undefined ? {} : { at }) });

  test('a colleague with the entry open twice is shown once', () => {
    // "Ann, Ann is editing this too" reads as a bug.
    const out = stillHere([
      conn('tab-1', 'u-ann', 'Ann', now - 5000, 3),
      conn('tab-2', 'u-ann', 'Ann', now, 42),
      conn('tab-3', 'u-bob', 'Bob', now),
    ], now);
    assert.deepEqual(out.map(p => p.name), ['Ann', 'Bob']);
  });

  test('the tab she is actually typing in is the one kept', () => {
    const out = stillHere([
      conn('tab-1', 'u-ann', 'Ann', now - 5000, 3),
      conn('tab-2', 'u-ann', 'Ann', now, 42),
    ], now);
    assert.equal(out[0].at, 42);
  });

  test('two tabs of one person are two authors, so neither skips the other', () => {
    /*
     * The bug the browser found. With the person as the author, the second
     * tab sees the first tab's change, decides it is its own, skips applying
     * it -- and the two tabs silently diverge.
     */
    const a = { base: 0, ops: [ins(0, 'A')], author: 'tab-1' };
    const first = commit('x', 0, [], a);
    const b = { base: 0, ops: [ins(0, 'B')], author: 'tab-2' };
    const second = commit(first.text, first.version,
      [{ version: 1, ops: first.applied, author: a.author }], b);
    assert.equal(second.text.length, 3, 'both insertions survive');
    assert.notEqual(a.author, b.author);
  });
});
