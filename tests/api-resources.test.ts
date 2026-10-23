import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES, project, acceptInput } from '../src/lib/api-resources.ts';

/**
 * These check the shape of the resource table rather than the database.
 *
 * Every mistake this catches is one that quietly widens what the API exposes
 * or accepts, which is the kind that does not show up until somebody's token
 * has already read something it should not have.
 */

describe('the resources on offer', () => {
  test('the ones Phase 7 asked for are all there', () => {
    for (const name of ['oligos', 'plates', 'requests', 'reads']) {
      assert.ok(RESOURCES[name], name);
    }
  });

  test('each path matches its key, so a URL is predictable', () => {
    for (const [key, spec] of Object.entries(RESOURCES)) {
      assert.equal(spec.path, key, key);
    }
  });

  test('every writable field is also returned', () => {
    // A field somebody can set and then never read back is a write-only hole:
    // they cannot confirm what they wrote.
    for (const [key, spec] of Object.entries(RESOURCES)) {
      for (const w of spec.writable) {
        assert.ok(spec.fields.includes(w), `${key}.${w} is writable but not returned`);
      }
    }
  });

  test('every required field is writable', () => {
    // Required but not writable is a resource nobody can create.
    for (const [key, spec] of Object.entries(RESOURCES)) {
      for (const r of spec.required) {
        assert.ok(spec.writable.includes(r), `${key}.${r} is required but cannot be set`);
      }
    }
  });

  test('searchable fields are fields that exist on the resource', () => {
    for (const [key, spec] of Object.entries(RESOURCES)) {
      for (const f of spec.searchable ?? []) {
        assert.ok(spec.fields.includes(f), `${key}.${f} is searched but not returned`);
      }
    }
  });

  test('a generated human id is never writable', () => {
    // PLA-001 is issued here. A caller setting it could collide with one the
    // system is about to hand out, and two tubes would carry one label.
    for (const [key, spec] of Object.entries(RESOURCES)) {
      if (!spec.humanIdField) continue;
      assert.ok(!spec.writable.includes(spec.humanIdField.field), `${key} lets a caller set its own code`);
      assert.ok(spec.fields.includes(spec.humanIdField.field), `${key} never returns its code`);
    }
  });

  test('nothing exposes a password, a secret or a token', () => {
    for (const [key, spec] of Object.entries(RESOURCES)) {
      for (const f of spec.fields) {
        assert.ok(!/password|secret|token|hash/i.test(f), `${key}.${f}`);
      }
    }
  });
});

describe('what a request is allowed to say', () => {
  const spec = RESOURCES.oligos;

  test('only declared fields come back', () => {
    // An added column must never be exposed by accident.
    const row = { id: 'o1', code: 'OLI-001', name: 'M13 fwd', sequence: 'GTAAAACGACGGCCAGT', createdById: 'u1', secretThing: 'x' };
    const out = project(spec, row);
    assert.ok(!('createdById' in out));
    assert.ok(!('secretThing' in out));
    assert.equal(out.code, 'OLI-001');
  });

  test('only writable fields are accepted', () => {
    const body = { name: 'M13 rev', code: 'OLI-999', archived: true, id: 'forged' };
    const out = acceptInput(spec, body);
    assert.deepEqual(Object.keys(out).sort(), ['archived', 'name']);
  });

  test('a body that is not an object is refused rather than coerced', () => {
    for (const bad of [null, 'a string', 42, [1, 2]]) {
      assert.throws(() => acceptInput(spec, bad), JSON.stringify(bad));
    }
  });
});

describe('the request resource guards its own rules', () => {
  test('state cannot be set through the API', () => {
    /*
     * Moving a request is a decision about who may do what -- see
     * lib/requests.ts. A token that could set state to anything would route
     * round the one rule that makes the queue mean something.
     */
    assert.ok(!RESOURCES.requests.writable.includes('state'));
    assert.ok(RESOURCES.requests.fields.includes('state'), 'but it can be read');
  });

  test('a read does not carry its trace', () => {
    // An .ab1 is hundreds of kilobytes of binary; a listing with one per row
    // would be unusable.
    assert.ok(!RESOURCES.reads.fields.includes('data'));
  });
});
