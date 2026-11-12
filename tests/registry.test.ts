import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUniqueViolation, withCodeRetry, describeWriteError,
  RegistryBusyError, MAX_CODE_ATTEMPTS,
} from '../src/lib/registry.ts';

/**
 * Two people registering at the same second.
 *
 * A code is read off the records that exist and then written. Two people
 * reading at the same moment read the same highest number, and the unique
 * column lets exactly one of them have it. Measured against a real database,
 * three registrations at once gave two records and one raw Prisma error shown
 * where the confirmation should have been.
 *
 * Retrying is the fix, and the thing worth testing about a retry is that it
 * re-reads rather than repeating a write that cannot succeed, and that it
 * gives up.
 */

/** A P2002 as Prisma reports one. */
const clash = (target: string[] = ['code']) =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });

describe('recognising the database refusing a duplicate', () => {
  test('a P2002 on the column we asked about', () => {
    assert.ok(isUniqueViolation(clash(['code']), 'code'));
  });

  test('a P2002 on some other column is not ours', () => {
    /*
     * Retrying a clash on, say, a name would loop until it gave up and then
     * report the wrong thing, because re-reading the code cannot fix a
     * duplicate name.
     */
    assert.ok(!isUniqueViolation(clash(['name']), 'code'));
  });

  test('a P2002 with no column named is treated as ours', () => {
    // Some drivers do not say. The retry is bounded, so guessing this way
    // round costs a few attempts; guessing the other way shows somebody a raw
    // database error.
    assert.ok(isUniqueViolation(Object.assign(new Error('x'), { code: 'P2002' }), 'code'));
    assert.ok(isUniqueViolation(clash([]), 'code'));
  });

  test('any other error is not a duplicate', () => {
    assert.ok(!isUniqueViolation(new Error('disk full'), 'code'));
    assert.ok(!isUniqueViolation(Object.assign(new Error('x'), { code: 'P2025' }), 'code'));
    assert.ok(!isUniqueViolation(null));
    assert.ok(!isUniqueViolation('P2002'));
  });

  test('with no column asked for, any P2002 counts', () => {
    assert.ok(isUniqueViolation(clash(['anything'])));
  });
});

describe('retrying a registration', () => {
  test('a write that works first time is not retried', async () => {
    let calls = 0;
    const out = await withCodeRetry(async () => { calls++; return 'STR-001'; });
    assert.equal(out, 'STR-001');
    assert.equal(calls, 1);
  });

  test('a loser tries again and succeeds', async () => {
    let calls = 0;
    const out = await withCodeRetry(async () => {
      calls++;
      if (calls < 3) throw clash();
      return `STR-00${calls}`;
    }, { field: 'code' });
    assert.equal(out, 'STR-003');
    assert.equal(calls, 3);
  });

  test('each attempt is told which one it is, so it can re-read', async () => {
    /*
     * The point of retrying is that the code is worked out again from what is
     * there now. An attempt that repeated the same code would fail forever.
     */
    const seen: number[] = [];
    await withCodeRetry(async (n) => {
      seen.push(n);
      if (n < 2) throw clash();
      return n;
    });
    assert.deepEqual(seen, [0, 1, 2]);
  });

  test('an error that is not a collision is not retried', async () => {
    // Retrying a real failure eight times turns one error into eight, and
    // delays the message by the time of eight writes.
    let calls = 0;
    await assert.rejects(
      withCodeRetry(async () => { calls++; throw new Error('disk full'); }),
      /disk full/,
    );
    assert.equal(calls, 1);
  });

  test('it gives up rather than looping', async () => {
    let calls = 0;
    await assert.rejects(
      withCodeRetry(async () => { calls++; throw clash(); }, { max: 4 }),
      (e: unknown) => e instanceof RegistryBusyError && e.attempts === 4,
    );
    assert.equal(calls, 4);
  });

  test('giving up says something a person can act on', async () => {
    const e = await withCodeRetry(async () => { throw clash(); }, { max: 2 })
      .catch((err: unknown) => err as RegistryBusyError);
    assert.match(e.message, /Try saving again/);
    assert.ok(!/P2002/.test(e.message), 'the database error should not reach a form field');
  });

  test('the default is a few attempts, not one and not forever', () => {
    assert.ok(MAX_CODE_ATTEMPTS >= 3 && MAX_CODE_ATTEMPTS <= 20);
  });
});

describe('what a failed write says', () => {
  test('a code clash reads as a clash, not as Prisma', () => {
    const msg = describeWriteError(clash(['code']), 'record');
    assert.match(msg, /registered at the same moment/);
    assert.ok(!/Prisma|P2002|invocation/.test(msg), msg);
  });

  test('a clash on something else names what it was', () => {
    assert.match(describeWriteError(clash(['name']), 'strain'), /strain with that name already exists/);
  });

  test('giving up keeps its own sentence', () => {
    assert.match(describeWriteError(new RegistryBusyError(8)), /Try saving again/);
  });

  test('an ordinary error is passed through, because it was written for a person', () => {
    assert.equal(describeWriteError(new Error('Give the type a name.')), 'Give the type a name.');
  });

  test('something that is not an error still gives a sentence', () => {
    assert.equal(describeWriteError('oops', 'oligo'), 'Could not save the oligo.');
  });
});
