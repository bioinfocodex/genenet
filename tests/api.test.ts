import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, hashToken } from '../src/lib/api-token.ts';
import { RESOURCES, project, acceptInput } from '../src/lib/api-resources.ts';

/**
 * The API's guarantees, tested where they are decided rather than over HTTP.
 *
 * Two of these matter more than the rest: a caller must not be able to set a
 * field the spec does not allow, and a response must not carry one the spec
 * does not declare. Both are quiet failures -- nothing errors, the request
 * simply does more or says more than it should.
 */

describe('tokens', () => {
  test('a token is prefixed, long, and unguessable', () => {
    const { token, prefix } = generateToken();
    assert.ok(token.startsWith('gn_'), token.slice(0, 8));
    assert.ok(token.length > 40, `token is only ${token.length} characters`);
    assert.ok(token.startsWith(prefix));
  });

  test('two tokens are never the same', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken().token));
    assert.equal(seen.size, 200);
  });

  test('the stored hash does not contain the token', () => {
    // A copy of the database must not be a set of working credentials.
    const { token, hash } = generateToken();
    assert.notEqual(hash, token);
    assert.ok(!hash.includes(token.slice(3)));
    assert.equal(hash.length, 64, 'expected a sha256 hex digest');
    assert.equal(hash, hashToken(token), 'hash must be reproducible from the token');
  });

  test('the prefix is short enough to be safe to display', () => {
    const { token, prefix } = generateToken();
    assert.ok(prefix.length <= 12, prefix);
    assert.ok(prefix.length < token.length / 3, 'prefix reveals too much of the token');
  });
});

describe('field exposure', () => {
  test('a response carries only declared fields', () => {
    const spec = RESOURCES.samples;
    const row = {
      id: '1', sampleId: 'SAM-001', name: 'x', type: 'PLASMID',
      createdById: 'secret-user-id',        // real column, not declared
      internalNote: 'should never appear',  // hypothetical future column
    };
    const out = project(spec, row as never);
    assert.ok(!('createdById' in out), 'createdById leaked');
    assert.ok(!('internalNote' in out), 'an undeclared column leaked');
    assert.equal(out.sampleId, 'SAM-001');
  });

  test('every declared field list includes id', () => {
    for (const [name, spec] of Object.entries(RESOURCES)) {
      assert.ok(spec.fields.includes('id'), `${name} does not expose id`);
    }
  });

  test('writable fields are a subset of exposed fields', () => {
    // Otherwise a caller could set something they can never read back.
    for (const [name, spec] of Object.entries(RESOURCES)) {
      for (const w of spec.writable) {
        assert.ok(spec.fields.includes(w), `${name}: ${w} is writable but not exposed`);
      }
    }
  });

  test('required fields are writable', () => {
    for (const [name, spec] of Object.entries(RESOURCES)) {
      for (const r of spec.required) {
        assert.ok(spec.writable.includes(r), `${name}: ${r} is required but not writable`);
      }
    }
  });
});

describe('input filtering', () => {
  test('fields outside the allow-list are dropped', () => {
    const spec = RESOURCES.samples;
    const got = acceptInput(spec, {
      name: 'legitimate',
      id: 'i-picked-this',
      sampleId: 'HACK-999',
      createdById: 'someone-else',
      createdAt: '1999-01-01',
    });
    assert.deepEqual(Object.keys(got), ['name']);
  });

  test('a non-object body is refused', () => {
    assert.throws(() => acceptInput(RESOURCES.samples, 'a string'), /JSON object/);
    assert.throws(() => acceptInput(RESOURCES.samples, [1, 2]), /JSON object/);
    assert.throws(() => acceptInput(RESOURCES.samples, null), /JSON object/);
  });

  test('undefined values are not treated as an instruction to clear', () => {
    const got = acceptInput(RESOURCES.samples, { name: 'x', notes: undefined });
    assert.ok(!('notes' in got));
  });
});
