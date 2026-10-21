import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOut, overdueBy, outFor, describeSpan, describeCustody,
  canCheckOut, canCheckIn, problemWithDueDate, formatDueDate, type Custody,
} from '../src/lib/custody.ts';

const inFreezer: Custody = { heldBy: null, heldSince: null, dueBack: null };
const at = (s: string) => new Date(s);

const held = (over: Partial<Custody> = {}): Custody => ({
  heldBy: 'Jane Smith',
  heldSince: '2026-10-01T09:00:00.000Z',
  dueBack: null,
  ...over,
});

describe('whether it is in the freezer', () => {
  test('a sample nobody holds is in', () => {
    assert.equal(isOut(inFreezer), false);
    assert.equal(isOut(held()), true);
  });
});

describe('how late it is', () => {
  test('nothing is late without a due date', () => {
    assert.equal(overdueBy(held(), at('2027-01-01T00:00:00Z')), null);
  });

  test('a tube in the freezer is never late, whatever its old due date said', () => {
    assert.equal(overdueBy({ ...inFreezer, dueBack: '2020-01-01' }, at('2026-10-21T12:00:00Z')), null);
  });

  test('a date-only due date means the end of that day, not the start of it', () => {
    // A tube due back on Friday is not late at one minute past midnight on
    // Friday morning. Reporting it as such teaches everybody to ignore the
    // flag, which is the whole value of having one.
    const c = held({ dueBack: '2026-10-23' });
    assert.equal(overdueBy(c, at('2026-10-23T00:01:00Z')), null);
    assert.equal(overdueBy(c, at('2026-10-23T23:59:00Z')), null);
    assert.ok(overdueBy(c, at('2026-10-24T00:30:00Z'))! > 0);
  });

  test('a due date with a time on it is taken at that time', () => {
    const c = held({ dueBack: '2026-10-23T14:00:00.000Z' });
    assert.equal(overdueBy(c, at('2026-10-23T13:00:00Z')), null);
    assert.ok(overdueBy(c, at('2026-10-23T15:00:00Z'))! > 0);
  });

  test('an unreadable due date is not a lateness', () => {
    assert.equal(overdueBy(held({ dueBack: 'next Tuesday' }), at('2026-10-21T12:00:00Z')), null);
  });
});

describe('how long it has been out', () => {
  test('from when it left', () => {
    const ms = outFor(held(), at('2026-10-01T12:00:00Z'))!;
    assert.equal(ms, 3 * 60 * 60 * 1000);
  });

  test('a clock that disagrees does not give a negative span', () => {
    assert.equal(outFor(held(), at('2026-09-30T00:00:00Z')), 0);
  });

  test('nothing to measure when it is in the freezer', () => {
    assert.equal(outFor(inFreezer), null);
    assert.equal(outFor(held({ heldSince: null })), null);
  });
});

describe('saying how long', () => {
  const m = 60_000, h = 60 * m, d = 24 * h;
  test('one unit, which is all anybody reads', () => {
    assert.equal(describeSpan(30_000), 'less than a minute');
    assert.equal(describeSpan(m), '1 minute');
    assert.equal(describeSpan(45 * m), '45 minutes');
    assert.equal(describeSpan(h), '1 hour');
    assert.equal(describeSpan(5 * h), '5 hours');
    assert.equal(describeSpan(d), '1 day');
    assert.equal(describeSpan(3 * d), '3 days');
    assert.equal(describeSpan(10 * d), '1 week');
    assert.equal(describeSpan(90 * d), '3 months');
  });
});

describe('the sentence on the page', () => {
  test('a sample in the freezer has nothing to say', () => {
    assert.equal(describeCustody(inFreezer), null);
  });

  test('who has it, and for how long', () => {
    const s = describeCustody(held(), at('2026-10-03T09:00:00Z'))!;
    assert.equal(s, 'Jane Smith has had it for 2 days');
  });

  test('with a due date still ahead, the date is given', () => {
    const s = describeCustody(held({ dueBack: '2026-10-30' }), at('2026-10-03T09:00:00Z'))!;
    assert.match(s, /due back/);
    assert.ok(!s.includes('ago'));
  });

  test('once it is late, how late comes first', () => {
    const s = describeCustody(held({ dueBack: '2026-10-05' }), at('2026-10-12T09:00:00Z'))!;
    assert.match(s, /due back \d+ days ago/);
  });
});

describe('taking it and putting it back', () => {
  test('anybody may take one that is in', () => {
    assert.deepEqual(canCheckOut(inFreezer, 'Jane Smith'), { ok: true });
  });

  test('somebody else holding it is a refusal that says who', () => {
    const r = canCheckOut(held(), 'John Doe');
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /Jane Smith has it/);
  });

  test('taking one you already have is refused, so the clock is not reset', () => {
    // Not pedantry: checking out twice would move "since" forward and lose
    // how long it has really been gone, which is the number that matters
    // when a tube has been out for three weeks.
    const r = canCheckOut(held(), 'Jane Smith');
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /already have/);
  });

  test('anybody may put one back, not only whoever took it', () => {
    // Tubes come back in somebody else's rack. A rule that only the borrower
    // can return one leaves the record wrong until they are next at a desk.
    assert.deepEqual(canCheckIn(held()), { ok: true });
  });

  test('putting back one that is already in is refused', () => {
    const r = canCheckIn(inFreezer);
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /not out/);
  });
});

describe('the due date somebody types', () => {
  const now = at('2026-10-21T12:00:00Z');

  test('no date is fine', () => assert.equal(problemWithDueDate('', now), null));

  test('a sensible date is fine', () => {
    assert.equal(problemWithDueDate('2026-10-28', now), null);
  });

  test('today is fine, because a tube due back today is not late yet', () => {
    assert.equal(problemWithDueDate('2026-10-21', now), null);
  });

  test('a date already gone is caught while it can still be corrected', () => {
    assert.match(problemWithDueDate('2026-10-01', now)!, /already passed/);
  });

  test('a typo in the year is caught', () => {
    assert.match(problemWithDueDate('2126-10-28', now)!, /two years/);
  });

  test('something that is not a date at all', () => {
    assert.match(problemWithDueDate('soon', now)!, /not a date/);
  });
});

describe('showing the day it is due', () => {
  test('a date-only due date is shown as the day it was chosen, in any timezone', () => {
    // It parses as midnight UTC, and formatting that in local time shows the
    // day before to anybody west of Greenwich: a tube due Saturday read as
    // due Friday. A test machine on UTC never sees it, so this pins the day
    // number rather than trusting the default formatting.
    assert.match(formatDueDate('2026-10-24'), /24/);
    assert.match(formatDueDate('2026-01-01'), /1/);
  });

  test('the sentence carries the same day', () => {
    const s = describeCustody(held({ dueBack: '2026-10-24' }), at('2026-10-02T09:00:00Z'))!;
    assert.match(s, /24/);
  });

  test('something unreadable is given back as it came', () => {
    assert.equal(formatDueDate('not a date'), 'not a date');
  });
});
