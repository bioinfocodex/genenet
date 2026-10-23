import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  readDiscovery, sameIssuer, problemWithHttpsUrl, startUrl,
  checkClaims, decideLink, safeReturnTo,
  type Claims, type LocalUser, type OidcConfig,
} from '../src/lib/oidc.ts';

const ISSUER = 'https://login.example.ac.uk';
const CLIENT = 'genenet-lab';
const NOW = Date.parse('2026-10-23T12:00:00.000Z');

const config: OidcConfig = {
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/authorize`,
  tokenEndpoint: `${ISSUER}/token`,
  jwksUri: `${ISSUER}/jwks`,
  clientId: CLIENT,
  redirectUri: 'https://genenet.example.ac.uk/api/auth/sso/callback',
};

const claims = (over: Claims = {}): Claims => ({
  iss: ISSUER,
  aud: CLIENT,
  sub: 'provider-subject-42',
  exp: Math.floor(NOW / 1000) + 300,
  iat: Math.floor(NOW / 1000) - 10,
  nonce: 'the-nonce',
  email: 'Jane.Smith@example.ac.uk',
  email_verified: true,
  name: 'Jane Smith',
  ...over,
});

const expect = { issuer: ISSUER, clientId: CLIENT, nonce: 'the-nonce' };

describe('the discovery document', () => {
  const good = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
  };

  test('a complete one is accepted', () => {
    const d = readDiscovery(good, ISSUER);
    assert.ok(!('error' in d));
  });

  test('a document naming a different issuer is refused', () => {
    /*
     * The document is fetched from a URL somebody configured. If it may name
     * a different issuer, whoever gets their URL configured can have tokens
     * accepted that were issued somewhere else entirely.
     */
    const d = readDiscovery({ ...good, issuer: 'https://evil.example.com' }, ISSUER);
    assert.ok('error' in d);
    assert.match((d as { error: string }).error, /calls itself/);
  });

  test('a trailing slash is not a different issuer', () => {
    assert.ok(sameIssuer(`${ISSUER}/`, ISSUER));
    assert.ok(!('error' in readDiscovery({ ...good, issuer: `${ISSUER}/` }, ISSUER)));
  });

  test('a missing endpoint is refused rather than defaulted', () => {
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      const d = readDiscovery({ ...good, [field]: undefined }, ISSUER);
      assert.ok('error' in d, field);
    }
  });

  test('an http endpoint is refused: the client secret travels over it', () => {
    const d = readDiscovery({ ...good, token_endpoint: 'http://login.example.ac.uk/token' }, ISSUER);
    assert.ok('error' in d);
    assert.match((d as { error: string }).error, /https/);
  });

  test('an endpoint inside this network is refused', () => {
    // The same reasoning as the webhook guard: a configured URL this server
    // then fetches.
    for (const url of ['https://localhost/token', 'https://169.254.169.254/token', 'https://10.0.0.5/token']) {
      assert.ok(problemWithHttpsUrl(url), url);
    }
  });

  test('something that is not a document at all', () => {
    for (const bad of [null, 'a string', 42, []]) {
      assert.ok('error' in readDiscovery(bad, ISSUER), JSON.stringify(bad));
    }
  });
});

describe('the URL that starts a sign-in', () => {
  const url = new URL(startUrl(config, { state: 'st', nonce: 'no', codeChallenge: 'ch' }));

  test('it asks for a code, with PKCE', () => {
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge'), 'ch');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  });

  test('it carries the state and the nonce', () => {
    assert.equal(url.searchParams.get('state'), 'st');
    assert.equal(url.searchParams.get('nonce'), 'no');
  });

  test('it asks for enough to identify somebody', () => {
    const scopes = url.searchParams.get('scope')!.split(' ');
    for (const s of ['openid', 'email', 'profile']) assert.ok(scopes.includes(s), s);
  });

  test('extra scopes are added without duplicating the standard ones', () => {
    const u = new URL(startUrl({ ...config, scopes: ['groups', 'email'] }, { state: 's', nonce: 'n', codeChallenge: 'c' }));
    const scopes = u.searchParams.get('scope')!.split(' ');
    assert.equal(scopes.filter(s => s === 'email').length, 1);
    assert.ok(scopes.includes('groups'));
  });
});

describe('checking an id token', () => {
  test('a good one yields an identity', () => {
    const out = checkClaims(claims(), expect, NOW);
    assert.ok(!('error' in out));
    assert.deepEqual(out, { subject: 'provider-subject-42', email: 'jane.smith@example.ac.uk', name: 'Jane Smith' });
  });

  test('a token from another issuer is refused', () => {
    const out = checkClaims(claims({ iss: 'https://elsewhere.example' }), expect, NOW);
    assert.match((out as { error: string }).error, /issued by somebody else/);
  });

  test('a token for another client of the same provider is refused', () => {
    /*
     * It is genuine and correctly signed and not for us. Accepting it would
     * let any other application at that provider sign people in here.
     */
    const out = checkClaims(claims({ aud: 'some-other-app' }), expect, NOW);
    assert.match((out as { error: string }).error, /different application/);
  });

  test('an audience list counts if we are in it', () => {
    assert.ok(!('error' in checkClaims(claims({ aud: ['other', CLIENT] }), expect, NOW)));
    assert.ok('error' in checkClaims(claims({ aud: ['other', 'another'] }), expect, NOW));
  });

  test('an expired token is refused', () => {
    const out = checkClaims(claims({ exp: Math.floor(NOW / 1000) - 1 }), expect, NOW);
    assert.match((out as { error: string }).error, /expired/);
  });

  test('a token with no expiry is refused rather than treated as eternal', () => {
    assert.ok('error' in checkClaims(claims({ exp: undefined }), expect, NOW));
  });

  test('a token issued well in the future is refused', () => {
    const out = checkClaims(claims({ iat: Math.floor(NOW / 1000) + 600 }), expect, NOW);
    assert.match((out as { error: string }).error, /issued in the future/);
  });

  test('a minute of clock skew is tolerated', () => {
    assert.ok(!('error' in checkClaims(claims({ iat: Math.floor(NOW / 1000) + 30 }), expect, NOW)));
  });

  test('a token from a different sign-in is refused', () => {
    // Replay: a token captured from another flow, correctly signed.
    const out = checkClaims(claims({ nonce: 'somebody-elses-nonce' }), expect, NOW);
    assert.match((out as { error: string }).error, /different sign-in/);
  });

  test('a token with no nonce at all does not pass', () => {
    assert.ok('error' in checkClaims(claims({ nonce: undefined }), expect, NOW));
  });

  test('an unverified email is refused, which is the check most often skipped', () => {
    /*
     * An address is how an account here is matched, and several providers --
     * including free tiers of well-known ones -- let somebody set one without
     * proving it. Trusting it would let anybody type a colleague's address
     * and be signed into their account.
     */
    for (const value of [false, undefined, 'true', null]) {
      const out = checkClaims(claims({ email_verified: value }), expect, NOW);
      assert.ok('error' in out, String(value));
      assert.match((out as { error: string }).error, /not verified/);
    }
  });

  test('no email at all says what to do about it', () => {
    const out = checkClaims(claims({ email: undefined }), expect, NOW);
    assert.match((out as { error: string }).error, /email scope/);
  });

  test('the address is lower-cased, because matching an account on it is not case-sensitive', () => {
    const out = checkClaims(claims({ email: 'JANE.SMITH@EXAMPLE.AC.UK' }), expect, NOW);
    assert.equal((out as { email: string }).email, 'jane.smith@example.ac.uk');
  });

  test('a provider that sends no name falls back to something usable', () => {
    const out = checkClaims(claims({ name: undefined, preferred_username: 'jsmith' }), expect, NOW);
    assert.equal((out as { name: string }).name, 'jsmith');
    const bare = checkClaims(claims({ name: undefined, preferred_username: undefined }), expect, NOW);
    assert.equal((bare as { name: string }).name, 'jane.smith');
  });

  test('a token identifying nobody is refused', () => {
    assert.ok('error' in checkClaims(claims({ sub: undefined }), expect, NOW));
    assert.ok('error' in checkClaims(claims({ sub: '' }), expect, NOW));
  });
});

describe('matching an identity to an account here', () => {
  const identity = { subject: 'sub-1', email: 'jane@example.ac.uk', name: 'Jane' };
  const user = (over: Partial<LocalUser> = {}): LocalUser =>
    ({ id: 'u1', email: 'jane@example.ac.uk', status: 'ACTIVE', ssoSubject: null, ...over });

  test('an account already linked to this subject just signs in', () => {
    const out = decideLink(identity, [user({ ssoSubject: 'sub-1' })], { allowCreate: false });
    assert.deepEqual(out, { action: 'sign-in', userId: 'u1' });
  });

  test('the subject is matched before the address', () => {
    /*
     * An institution that lets somebody change their address should not
     * strand their account, and one that reissues a departed person's address
     * must not hand the new joiner the old account. Matching on the subject
     * gets both right; matching on the address gets both wrong.
     */
    const users = [
      user({ id: 'old', email: 'changed@example.ac.uk', ssoSubject: 'sub-1' }),
      user({ id: 'new', email: 'jane@example.ac.uk', ssoSubject: null }),
    ];
    assert.deepEqual(decideLink(identity, users, { allowCreate: false }), { action: 'sign-in', userId: 'old' });
  });

  test('an unlinked account with that address is linked', () => {
    assert.deepEqual(decideLink(identity, [user()], { allowCreate: false }), { action: 'link', userId: 'u1' });
  });

  test('an address belonging to somebody else’s linked account is refused', () => {
    // The takeover the verified-email check prevents, arriving by another route.
    const out = decideLink(identity, [user({ ssoSubject: 'a-different-subject' })], { allowCreate: false });
    assert.equal(out.action, 'refuse');
    assert.match((out as { why: string }).why, /unlink/);
  });

  test('a blocked or removed account does not sign in', () => {
    for (const status of ['BLOCKED', 'REMOVED']) {
      const out = decideLink(identity, [user({ status, ssoSubject: 'sub-1' })], { allowCreate: false });
      assert.equal(out.action, 'refuse', status);
    }
  });

  test('an unknown person is created only where the installation allows it', () => {
    assert.deepEqual(decideLink(identity, [], { allowCreate: true }), { action: 'create' });
    const refused = decideLink(identity, [], { allowCreate: false });
    assert.equal(refused.action, 'refuse');
    assert.match((refused as { why: string }).why, /does not create them automatically/);
  });

  test('the address is matched without regard to case', () => {
    const out = decideLink(identity, [user({ email: 'Jane@Example.ac.uk' })], { allowCreate: false });
    assert.equal(out.action, 'link');
  });
});

describe('where somebody is sent afterwards', () => {
  test('a path on this site is kept', () => {
    assert.equal(safeReturnTo('/notebook/abc'), '/notebook/abc');
    assert.equal(safeReturnTo('/'), '/');
  });

  test('anywhere else is not', () => {
    /*
     * An open redirect at the end of a login flow is the classic way to make
     * a phishing link look legitimate: the victim really does sign in to the
     * real site, and is then handed somewhere else.
     */
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      assert.equal(safeReturnTo(bad), '/', bad);
    }
  });

  test('a header injection attempt is refused', () => {
    assert.equal(safeReturnTo('/ok\r\nSet-Cookie: a=b'), '/');
  });

  test('nothing given goes home', () => {
    assert.equal(safeReturnTo(null), '/');
    assert.equal(safeReturnTo(undefined), '/');
    assert.equal(safeReturnTo(''), '/');
  });
});
