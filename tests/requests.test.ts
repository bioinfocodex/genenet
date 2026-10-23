import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUEST_STATES, REQUEST_KINDS, kindById, bodyFor, isOpen,
  allowedMoves, canMove, roleOf, rolesOf, lateBy, queueOrder, queueSummary,
  type RequestState, type QueueItem,
} from '../src/lib/requests.ts';

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'r1', state: 'OPEN', createdAt: '2026-10-01T00:00:00.000Z',
  neededBy: null, requesterName: 'Jane', assigneeName: null, ...over,
});
const at = (s: string) => new Date(s);

describe('which way a request can go', () => {
  test('the open states are the ones still somebody\'s problem', () => {
    assert.ok(isOpen('OPEN'));
    assert.ok(isOpen('ACCEPTED'));
    for (const s of ['DONE', 'DECLINED', 'WITHDRAWN'] as RequestState[]) assert.equal(isOpen(s), false);
  });

  test('a finished request does not move again', () => {
    // One that was declined and then reopened is a new request. Saying so
    // keeps the first one's history honest.
    for (const s of ['DONE', 'DECLINED', 'WITHDRAWN'] as RequestState[]) {
      assert.deepEqual(allowedMoves(s, 'requester'), []);
      assert.deepEqual(allowedMoves(s, 'assignee'), []);
    }
  });

  test('the person who asked may withdraw and may not decline', () => {
    // Different acts: "I no longer need this" against "I am not going to do
    // this". A lab where those read the same cannot tell why a thing did not
    // happen.
    const moves = allowedMoves('OPEN', 'requester').map(m => m.to).sort();
    assert.deepEqual(moves, ['ACCEPTED', 'WITHDRAWN'], 'they may also do it themselves');
    assert.equal(canMove('OPEN', 'DECLINED', 'requester').ok, false);
  });

  test('the person doing the work may decline and may not withdraw', () => {
    const moves = allowedMoves('OPEN', 'assignee').map(m => m.to).sort();
    assert.deepEqual(moves, ['ACCEPTED', 'DECLINED']);
    assert.equal(canMove('OPEN', 'WITHDRAWN', 'assignee').ok, false);
  });

  test('anybody may take an open request on, including whoever asked', () => {
    // A queue nobody but the named assignee can pick from is not a queue --
    // and somebody who asked, waited, and ended up doing it themselves must
    // be able to say so rather than only withdraw.
    for (const role of ['other', 'assignee', 'requester'] as const) {
      assert.ok(allowedMoves('OPEN', role).some(m => m.to === 'ACCEPTED'), role);
    }
  });

  test('holding both sides gets both sets of moves', () => {
    const both = allowedMoves('ACCEPTED', ['requester', 'assignee']).map(m => m.to).sort();
    assert.deepEqual(both, ['DECLINED', 'DONE', 'OPEN']);
    assert.ok(canMove('ACCEPTED', 'DONE', ['requester', 'assignee']).ok);
  });

  test('taken on, it can be finished or put back', () => {
    const moves = allowedMoves('ACCEPTED', 'assignee').map(m => m.to).sort();
    assert.deepEqual(moves, ['DECLINED', 'DONE', 'OPEN']);
  });

  test('a move nobody allows says which side can do it', () => {
    const r = canMove('OPEN', 'WITHDRAWN', 'assignee');
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /the person who asked/);
  });

  test('a move to where it already is is refused plainly', () => {
    const r = canMove('OPEN', 'OPEN', 'requester');
    assert.match((r as { why: string }).why, /already waiting/);
  });

  test('a jump that skips the middle is refused', () => {
    assert.equal(canMove('OPEN', 'DONE', 'assignee').ok, false);
    assert.equal(canMove('ACCEPTED', 'DONE', 'assignee').ok, true);
  });

  test('every state is reachable in the graph or is a start', () => {
    const reachable = new Set<string>(['OPEN']);
    for (const from of REQUEST_STATES) {
      for (const role of ['requester', 'assignee', 'other'] as const) {
        for (const m of allowedMoves(from, role)) reachable.add(m.to);
      }
    }
    for (const s of REQUEST_STATES) assert.ok(reachable.has(s), s);
  });
});

describe('which side of a request somebody is on', () => {
  const r = { requesterId: 'u1', assigneeId: 'u2' };
  test('the asker, the doer, and everybody else', () => {
    assert.equal(roleOf(r, 'u1'), 'requester');
    assert.equal(roleOf(r, 'u2'), 'assignee');
    assert.equal(roleOf(r, 'u3'), 'other');
  });

  test('unassigned, nobody is the assignee', () => {
    assert.equal(roleOf({ requesterId: 'u1', assigneeId: null }, 'u2'), 'other');
  });

  test('asking and then doing it makes somebody both', () => {
    // With one role they could only withdraw their own request, which loses
    // the record that the work was actually done.
    assert.deepEqual(rolesOf({ requesterId: 'u1', assigneeId: 'u1' }, 'u1'), ['requester', 'assignee']);
    assert.equal(roleOf({ requesterId: 'u1', assigneeId: 'u1' }, 'u1'), 'requester', 'the stronger one, where only one fits');
    assert.deepEqual(rolesOf({ requesterId: 'u1', assigneeId: 'u2' }, 'u3'), ['other']);
  });
});

describe('how late a request is', () => {
  test('the day it is wanted counts as a whole day', () => {
    // Something wanted on Friday is not late on Friday morning, and flagging
    // it then teaches people to ignore the flag.
    const i = item({ neededBy: '2026-10-23' });
    assert.equal(lateBy(i, at('2026-10-23T09:00:00Z')), null);
    assert.ok(lateBy(i, at('2026-10-24T01:00:00Z'))! > 0);
  });

  test('a finished request is never late', () => {
    assert.equal(lateBy(item({ neededBy: '2020-01-01', state: 'DONE' }), at('2026-10-21T00:00:00Z')), null);
    assert.equal(lateBy(item({ neededBy: '2020-01-01', state: 'WITHDRAWN' }), at('2026-10-21T00:00:00Z')), null);
  });

  test('no date is never late', () => {
    assert.equal(lateBy(item(), at('2030-01-01T00:00:00Z')), null);
  });
});

describe('the order a queue is worked in', () => {
  const now = at('2026-10-21T12:00:00Z');

  test('late first, then by when it is wanted, then oldest', () => {
    const items = [
      item({ id: 'nodate', neededBy: null, createdAt: '2026-10-02T00:00:00Z' }),
      item({ id: 'soon', neededBy: '2026-10-25' }),
      item({ id: 'late', neededBy: '2026-10-18' }),
      item({ id: 'later', neededBy: '2026-10-30' }),
      item({ id: 'older-nodate', neededBy: null, createdAt: '2026-10-01T00:00:00Z' }),
    ];
    assert.deepEqual(queueOrder(items, now).map(i => i.id), [
      'late', 'soon', 'later', 'older-nodate', 'nodate',
    ]);
  });

  test('two late ones put the latest first', () => {
    const items = [
      item({ id: 'a', neededBy: '2026-10-19' }),
      item({ id: 'b', neededBy: '2026-10-10' }),
    ];
    assert.deepEqual(queueOrder(items, now).map(i => i.id), ['b', 'a']);
  });

  test('a request with no date sorts after one with a date, not before', () => {
    // A date is somebody saying when they need it. A queue that ignored that
    // would make everybody put a fake date on everything.
    const items = [item({ id: 'none', neededBy: null }), item({ id: 'dated', neededBy: '2026-12-01' })];
    assert.deepEqual(queueOrder(items, now).map(i => i.id), ['dated', 'none']);
  });

  test('sorting does not alter what it was given', () => {
    const items = [item({ id: 'b', neededBy: '2026-12-01' }), item({ id: 'a', neededBy: '2026-11-01' })];
    const before = items.map(i => i.id);
    queueOrder(items, now);
    assert.deepEqual(items.map(i => i.id), before);
  });
});

describe('the line at the top of a queue', () => {
  const now = at('2026-10-21T12:00:00Z');

  test('nothing waiting says so', () => {
    assert.equal(queueSummary([item({ state: 'DONE' })], now), 'Nothing waiting.');
    assert.equal(queueSummary([], now), 'Nothing waiting.');
  });

  test('what is open, unclaimed and late', () => {
    const s = queueSummary([
      item({ id: '1', state: 'OPEN', neededBy: '2026-10-10' }),
      item({ id: '2', state: 'ACCEPTED' }),
      item({ id: '3', state: 'OPEN' }),
      item({ id: '4', state: 'DONE' }),
    ], now);
    assert.match(s, /3 open/);
    assert.match(s, /2 nobody has taken on/);
    assert.match(s, /1 past the day it was wanted/);
  });
});

describe('what a request is for', () => {
  test('each kind has an id nothing else uses and prompts to fill in', () => {
    const ids = REQUEST_KINDS.map(k => k.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const k of REQUEST_KINDS) assert.ok(k.prompts.length > 0, k.id);
  });

  test('a body starts as one heading per prompt', () => {
    const k = kindById('sequencing')!;
    const body = bodyFor(k);
    for (const p of k.prompts) assert.ok(body.includes(`## ${p}`), p);
  });

  test('an unknown kind is not invented', () => {
    assert.equal(kindById('nonsense'), null);
  });
});
