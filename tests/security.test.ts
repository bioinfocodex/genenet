import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICIES, checkLimit, recordFailure, recordSuccess, describeWait, clientKey,
} from '../src/lib/rate-limit.ts';
import {
  isCloudSynced, cloudProvider, defaultDatabasePath, describeDatabaseLocationRisk,
} from '../src/lib/db-location.ts';

/**
 * The security-shaped behaviour: rate limiting and where the database is
 * allowed to live. Both were written in response to a specific way of losing
 * data, so both need a test that fails if the behaviour is ever relaxed.
 */

describe('rate limiting', () => {
  test('a fresh caller has the full allowance', () => {
    const s = checkLimit('login:fresh-1', POLICIES.login);
    assert.equal(s.allowed, true);
    assert.equal(s.remaining, POLICIES.login.limit);
  });

  test('failures below the limit stay allowed', () => {
    const k = 'login:below-limit';
    for (let i = 1; i < POLICIES.login.limit; i++) {
      assert.equal(recordFailure(k, POLICIES.login).allowed, true, `failure ${i} should still be allowed`);
    }
    assert.equal(checkLimit(k, POLICIES.login).allowed, true);
  });

  test('the failure that reaches the limit locks the caller out', () => {
    const k = 'login:at-limit';
    for (let i = 1; i < POLICIES.login.limit; i++) recordFailure(k, POLICIES.login);
    const last = recordFailure(k, POLICIES.login);
    assert.equal(last.allowed, false);
    assert.ok(last.retryAfterMs > 0);
    assert.equal(checkLimit(k, POLICIES.login).allowed, false);
  });

  test('a correct answer clears the record', () => {
    const k = 'login:cleared';
    for (let i = 0; i < 5; i++) recordFailure(k, POLICIES.login);
    recordSuccess(k);
    assert.equal(checkLimit(k, POLICIES.login).remaining, POLICIES.login.limit);
  });

  test('callers are isolated from each other', () => {
    const victim = 'login:1.1.1.1';
    for (let i = 0; i < POLICIES.login.limit; i++) recordFailure(victim, POLICIES.login);
    assert.equal(checkLimit(victim, POLICIES.login).allowed, false);
    assert.equal(checkLimit('login:2.2.2.2', POLICIES.login).allowed, true,
      "one caller's lockout must not affect another");
  });

  test('actions are isolated from each other', () => {
    const ip = '3.3.3.3';
    for (let i = 0; i < POLICIES.login.limit; i++) recordFailure(`login:${ip}`, POLICIES.login);
    assert.equal(checkLimit(`login:${ip}`, POLICIES.login).allowed, false);
    assert.equal(checkLimit(`connection-code:${ip}`, POLICIES.connectionCode).allowed, true,
      'being locked out of login must not lock the connection code');
  });

  test('lockouts double and then cap', () => {
    const k = 'connection-code:escalating';
    const waits: number[] = [];
    for (let round = 0; round < 9; round++) {
      for (let i = 1; i < POLICIES.connectionCode.limit; i++) recordFailure(k, POLICIES.connectionCode);
      waits.push(recordFailure(k, POLICIES.connectionCode).retryAfterMs);
    }
    assert.ok(waits[1] > waits[0], 'the second lockout should be longer than the first');
    assert.ok(waits[2] > waits[1], 'and the third longer again');
    const cap = POLICIES.connectionCode.maxLockoutMs!;
    assert.ok(waits.every(w => w <= cap), `no lockout should exceed the cap of ${cap}ms`);
    assert.equal(waits[waits.length - 1], cap, 'it should reach the cap, not grow forever');
  });

  test('the connection code policy is strict enough to matter', () => {
    // LAB-##### is 90,000 possibilities. With this policy an attacker gets
    // `limit` guesses per lockout, and the lockout grows: exhausting the space
    // must take years, not minutes.
    const perRound = POLICIES.connectionCode.limit;
    const cap = POLICIES.connectionCode.maxLockoutMs!;
    const roundsNeeded = 90_000 / perRound;
    const yearsAtCap = (roundsNeeded * cap) / 1000 / 3600 / 24 / 365;
    assert.ok(yearsAtCap > 1, `expected over a year to exhaust the space, got ${yearsAtCap.toFixed(2)}`);
  });

  test('describeWait reads as something a person can act on', () => {
    assert.equal(describeWait(1_000), '1 second');
    assert.equal(describeWait(45_000), '45 seconds');
    assert.equal(describeWait(60_000), '1 minute');
    assert.equal(describeWait(90_000), '2 minutes');
  });

  test('clientKey prefers the first forwarded address', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' });
    assert.equal(clientKey(h, 'login'), 'login:203.0.113.5');
  });

  test('clientKey falls back rather than throwing', () => {
    assert.equal(clientKey(new Headers(), 'login'), 'login:unknown');
    assert.equal(clientKey(new Headers({ 'x-real-ip': '198.51.100.9' }), 'login'), 'login:198.51.100.9');
  });
});

describe('database location', () => {
  const SYNCED = [
    '/Users/x/Library/CloudStorage/OneDrive-Company/GeneNet/database/genenet.db',
    '/Users/x/Dropbox/Lab/genenet.db',
    '/Users/x/Google Drive/GeneNet/genenet.db',
    'C:\\Users\\x\\OneDrive\\GeneNet\\genenet.db',
    '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/g.db',
    '/Users/x/Nextcloud/lab/g.db',
    '/Users/x/Box Sync/g.db',
  ];
  const LOCAL = [
    '/Users/x/Library/Application Support/GeneNet/genenet.db',
    '/var/lib/genenet/genenet.db',
    '/mnt/lab-nas/GeneNet/genenet.db',
    '/Users/x/Documents/GeneNet/genenet.db',
    '/home/x/.local/share/GeneNet/genenet.db',
  ];

  test('recognises the sync folders that lose data', () => {
    for (const p of SYNCED) {
      assert.equal(isCloudSynced(`file:${p}`), true, `${p} should be detected as synced`);
    }
  });

  test('does not cry wolf on ordinary paths', () => {
    for (const p of LOCAL) {
      assert.equal(isCloudSynced(`file:${p}`), false, `${p} should be treated as local`);
    }
  });

  test('names the provider so the message can be acted on', () => {
    assert.equal(cloudProvider('file:/x/CloudStorage/OneDrive-Co/db'), 'OneDrive');
    assert.equal(cloudProvider('file:/x/Dropbox/db'), 'Dropbox');
    assert.equal(cloudProvider('file:/x/Google Drive/db'), 'Google Drive');
    assert.equal(cloudProvider('file:/var/lib/db'), null);
  });

  test('the default path is per-machine and not synced', () => {
    const p = defaultDatabasePath();
    assert.ok(p.includes('GeneNet'), 'should be namespaced to the app');
    assert.equal(isCloudSynced(p), false, 'the default must never be a synced location');
  });

  test('warns for a synced database', () => {
    const w = describeDatabaseLocationRisk('file:/Users/x/OneDrive/GeneNet/g.db');
    assert.ok(w, 'expected a warning');
    assert.ok(w.includes('OneDrive'), 'the warning should name the provider');
    assert.ok(w.includes(defaultDatabasePath()), 'and say where to move it');
  });

  test('stays quiet for a local database', () => {
    assert.equal(describeDatabaseLocationRisk(`file:${defaultDatabasePath()}`), null);
  });

  test('stays quiet for a non-file datasource', () => {
    // Postgres manages its own storage; the warning would be nonsense.
    assert.equal(describeDatabaseLocationRisk('postgresql://user@host:5432/genenet'), null);
    assert.equal(describeDatabaseLocationRisk(undefined), null);
  });
});
