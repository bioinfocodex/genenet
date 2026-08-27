import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/lib/password.ts';
import { MEANINGS, isMeaning } from '../src/lib/signature-types.ts';

/**
 * Signing.
 *
 * Two things have to hold for a signature to be worth anything. Nobody may sign
 * as someone else, and a signature must not silently come to endorse text the
 * signer never saw. The first is password verification; the second is the
 * content hash, which is exercised against a live database in the integration
 * check rather than here.
 */

describe('password verification', () => {
  test('accepts the right password', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('correct horse battery staple', stored), true);
  });

  test('rejects the wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('Correct horse battery staple', stored), false);
    assert.equal(verifyPassword('', stored), false);
    assert.equal(verifyPassword('correct horse battery stapl', stored), false);
  });

  test('two hashes of the same password differ', () => {
    // Per-hash random salt: identical passwords must not produce identical
    // stored values, or the hash file reveals who shares a password.
    assert.notEqual(hashPassword('same'), hashPassword('same'));
  });

  test('a malformed stored value is a failure, not an exception', () => {
    // timingSafeEqual throws on a length mismatch, which would surface as a
    // 500 rather than "wrong password".
    for (const bad of ['', 'nocolon', 'salt:', ':hash', 'salt:zzzz', 'a:b:c']) {
      assert.doesNotThrow(() => verifyPassword('anything', bad), `threw on ${JSON.stringify(bad)}`);
      assert.equal(verifyPassword('anything', bad), false, `should reject ${bad}`);
    }
  });
});

describe('signature meanings', () => {
  test('the four Part 11 meanings are distinct claims', () => {
    assert.deepEqual(Object.keys(MEANINGS), ['authored', 'reviewed', 'approved', 'witnessed']);
  });

  test('each meaning reads as a statement the signer is making', () => {
    for (const [key, text] of Object.entries(MEANINGS)) {
      assert.match(text, /^I /, `${key} should be phrased in the first person`);
    }
  });

  test('isMeaning accepts only the defined meanings', () => {
    assert.equal(isMeaning('approved'), true);
    assert.equal(isMeaning('reviewed'), true);
    assert.equal(isMeaning('rubber-stamped'), false);
    assert.equal(isMeaning(''), false);
    assert.equal(isMeaning('toString'), false); // not fooled by prototype keys
  });
});
