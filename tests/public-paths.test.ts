import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reachableWithoutSession } from '../src/lib/public-paths.ts';

/**
 * What is reachable before signing in.
 *
 * This is the boundary that decides what the application exposes to somebody
 * with no session, and a mistake is silent in both directions: too narrow and
 * nobody can sign in at all, too wide and the API is open. Both have happened
 * here, so both are tested.
 */
describe('reachable without a session', () => {
  test('the pages somebody needs before they have an account', () => {
    for (const p of ['/login', '/register', '/setup', '/connect', '/download']) {
      assert.ok(reachableWithoutSession(p), p);
    }
  });

  test('the single sign-on handshake, both halves', () => {
    /*
     * The browser is sent to the provider and comes back with a code, and
     * both necessarily happen while signed out. Guarding these made single
     * sign-on impossible to complete -- the callback answered 401 and the
     * person was never signed in -- and no unit test caught it, because every
     * test called the route's handler directly and never went through here.
     */
    assert.ok(reachableWithoutSession('/api/auth/sso/start'));
    assert.ok(reachableWithoutSession('/api/auth/sso/callback'));
  });

  test('the rest of the API is not', () => {
    for (const p of ['/api/entries', '/api/coedit/abc', '/api/export/report', '/api/admin/users']) {
      assert.ok(!reachableWithoutSession(p), p);
    }
  });

  test('the exemption does not spread to its neighbours', () => {
    // A prefix match on '/api/auth' rather than '/api/auth/sso' would open
    // every other authentication endpoint along with the handshake.
    assert.ok(!reachableWithoutSession('/api/auth'));
    assert.ok(!reachableWithoutSession('/api/auth/password'));
    assert.ok(!reachableWithoutSession('/api/auth/sso-admin'));
  });

  test('a path that merely starts with an exempt one is not exempt', () => {
    assert.ok(!reachableWithoutSession('/api/validate-codes-export'));
  });

  test('the token API is reachable, because it authenticates itself', () => {
    // Not public: every route under it checks a bearer token. It must not be
    // redirected to a login page, because a script cannot act on 302 to HTML.
    assert.ok(reachableWithoutSession('/api/v1'));
    assert.ok(reachableWithoutSession('/api/v1/sequences'));
  });
});
