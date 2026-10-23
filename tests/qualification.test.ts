import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  atLeast, versionCheck, diffSchema, schemaCheck, summarise, renderReport,
  type Check, type SchemaShape,
} from '../src/lib/qualification.ts';
import {
  providerFor, insensitiveContains, insensitiveEquals,
  canSnapshotInProcess, PORTABILITY_NOTES,
} from '../src/lib/db-provider.ts';

const check = (over: Partial<Check> = {}): Check => ({
  id: 'x', question: 'Is it?', state: 'pass', found: 'yes', ...over,
});

describe('comparing versions', () => {
  test('numerically, not as text', () => {
    // "22.18.0" is less than "9.0.0" as a string, and a node check that got
    // this backwards would pass on exactly the installations it exists to
    // catch.
    assert.ok(atLeast('22.18.0', '9.0.0'));
    assert.ok(!atLeast('9.0.0', '22.18.0'));
  });

  test('equal is at least', () => {
    assert.ok(atLeast('22.18.0', '22.18.0'));
    assert.ok(atLeast('22.18', '22.18.0'));
  });

  test('a leading v is not part of the number', () => {
    assert.ok(atLeast('v22.18.0', '22.18.0'));
  });

  test('a patch below fails', () => {
    assert.ok(!atLeast('22.17.9', '22.18.0'));
    assert.ok(atLeast('22.18.1', '22.18.0'));
  });

  test('something that is not a version does not pass by accident', () => {
    assert.ok(!atLeast('', '1.0.0'));
    assert.ok(!atLeast('unknown', '1.0.0'));
  });

  test('a version check says what it found as well as what it wanted', () => {
    const c = versionCheck('node', 'Node', '20.0.0', '22.18.0');
    assert.equal(c.state, 'fail');
    assert.equal(c.found, '20.0.0');
    assert.match(c.expected!, /22\.18\.0 or newer/);
  });

  test('nothing found is a failure, not an empty pass', () => {
    assert.equal(versionCheck('x', 'Thing', '', '1.0.0').found, 'not found');
    assert.equal(versionCheck('x', 'Thing', '', '1.0.0').state, 'fail');
  });
});

describe('comparing a schema with the one that was qualified', () => {
  const expected: SchemaShape = {
    tables: { Sample: ['id', 'name', 'amount'], User: ['id', 'email'] },
  };

  test('an identical schema is the same', () => {
    const d = diffSchema(expected, { tables: { Sample: ['id', 'name', 'amount'], User: ['id', 'email'] } });
    assert.ok(d.same);
    assert.equal(schemaCheck(d).state, 'pass');
  });

  test('a missing table fails', () => {
    const d = diffSchema(expected, { tables: { Sample: ['id', 'name', 'amount'] } });
    assert.deepEqual(d.missingTables, ['User']);
    assert.equal(schemaCheck(d).state, 'fail');
  });

  test('a missing column fails', () => {
    const d = diffSchema(expected, { tables: { Sample: ['id', 'name'], User: ['id', 'email'] } });
    assert.deepEqual(d.changedTables, [{ table: 'Sample', missingColumns: ['amount'], extraColumns: [] }]);
    assert.equal(schemaCheck(d).state, 'fail');
  });

  test('an unexpected table is a warning, not nothing', () => {
    // A table nobody expected is the normal shape of an undocumented change,
    // and in a regulated setting that nobody can say where it came from is
    // the finding, not the table.
    const d = diffSchema(expected, { tables: { ...expected.tables, Scratch: ['id'] } });
    assert.deepEqual(d.extraTables, ['Scratch']);
    assert.equal(schemaCheck(d).state, 'warn');
    assert.match(schemaCheck(d).found, /unexpected Scratch/);
  });

  test('an unexpected column is a warning too', () => {
    const d = diffSchema(expected, { tables: { ...expected.tables, Sample: ['id', 'name', 'amount', 'secret'] } });
    assert.equal(schemaCheck(d).state, 'warn');
    assert.match(schemaCheck(d).found, /unexpected secret/);
  });

  test('missing and unexpected together is a failure, because missing is worse', () => {
    const d = diffSchema(expected, { tables: { Sample: ['id', 'name', 'other'], User: ['id', 'email'] } });
    assert.equal(schemaCheck(d).state, 'fail');
  });

  test('a column order difference is not a difference', () => {
    const d = diffSchema(expected, { tables: { Sample: ['amount', 'id', 'name'], User: ['email', 'id'] } });
    assert.ok(d.same);
  });
});

describe('the verdict', () => {
  test('counts each state, and nothing failing is qualified', () => {
    const q = summarise('IQ', [check(), check({ state: 'warn' }), check({ state: 'info' })]);
    assert.deepEqual(q.summary, { pass: 1, fail: 0, warn: 1, info: 1 });
    assert.ok(q.qualified);
  });

  test('a warning does not fail a qualification', () => {
    // Most warnings here are about how an installation is configured rather
    // than whether it is correct, and a report that failed on those would be
    // ignored -- which is how a failing check stops meaning anything.
    assert.ok(summarise('IQ', [check({ state: 'warn' })]).qualified);
  });

  test('one failure is enough', () => {
    assert.equal(summarise('IQ', [check(), check({ state: 'fail' })]).qualified, false);
  });

  test('no checks at all is not a pass worth having', () => {
    const q = summarise('OQ', []);
    assert.deepEqual(q.summary, { pass: 0, fail: 0, warn: 0, info: 0 });
  });
});

describe('the printed report', () => {
  const q = summarise('IQ', [
    check({ question: 'Is Node new enough?', found: '22.18.0', expected: '22.18.0 or newer' }),
    check({ state: 'fail', question: 'Is the schema the qualified one?', found: 'missing Sample.amount' }),
  ], new Date('2026-10-22T09:00:00.000Z'));

  test('every check appears, including the ones that passed', () => {
    // A reader has to be able to tell at a glance that nothing was left out.
    const text = renderReport(q, 'GeneNet IQ');
    assert.match(text, /Is Node new enough\?/);
    assert.match(text, /Is the schema the qualified one\?/);
    assert.match(text, /\[PASS/);
    assert.match(text, /\[FAIL/);
  });

  test('what was found is printed even on a pass', () => {
    assert.match(renderReport(q, 'x'), /found: 22\.18\.0/);
  });

  test('a failed report does not claim to be qualified', () => {
    const text = renderReport(q, 'x');
    assert.match(text, /not qualified until they are resolved/);
    assert.ok(!text.includes('No check failed'));
  });

  test('a clean report evidences rather than certifies', () => {
    // The honest limit of what a tool can say.
    const clean = summarise('IQ', [check()]);
    const text = renderReport(clean, 'x');
    assert.match(text, /does not certify it/);
  });

  test('context given by the caller is printed in the header', () => {
    const text = renderReport(q, 'x', { Version: '1.4.0', Database: 'postgresql' });
    assert.match(text, /Version\s+1\.4\.0/);
    assert.match(text, /Database\s+postgresql/);
  });

  test('there is somewhere to sign', () => {
    assert.match(renderReport(q, 'x'), /Performed by/);
    assert.match(renderReport(q, 'x'), /Reviewed by/);
  });
});

describe('which database an installation is on', () => {
  test('read from the connection string, not from the schema', () => {
    // The schema's provider is fixed at build time; the URL is what the
    // running process is actually talking to.
    assert.equal(providerFor('postgresql://u:p@host:5432/genenet'), 'postgresql');
    assert.equal(providerFor('postgres://u:p@host/db'), 'postgresql');
    assert.equal(providerFor('file:./dev.db'), 'sqlite');
    assert.equal(providerFor(undefined), 'sqlite');
    assert.equal(providerFor(''), 'sqlite');
  });

  test('whitespace and case do not change the answer', () => {
    assert.equal(providerFor('  POSTGRESQL://u@h/d '), 'postgresql');
  });
});

describe('the differences the two engines do not hide', () => {
  test('a case-insensitive search is spelled differently on each', () => {
    /*
     * The difference a user would have found rather than us: SQLite's LIKE
     * ignores case for ASCII and PostgreSQL's does not, so "puc19" finds
     * pUC19 on one and nothing on the other.
     */
    const before = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = 'file:./dev.db';
      assert.deepEqual(insensitiveContains('puc19'), { contains: 'puc19' });
      assert.deepEqual(insensitiveEquals('PLA-001'), { equals: 'PLA-001' });
      assert.ok(canSnapshotInProcess(), 'SQLite can snapshot itself');

      process.env.DATABASE_URL = 'postgresql://u@h/d';
      assert.deepEqual(insensitiveContains('puc19'), { contains: 'puc19', mode: 'insensitive' });
      assert.deepEqual(insensitiveEquals('PLA-001'), { equals: 'PLA-001', mode: 'insensitive' });
      assert.ok(!canSnapshotInProcess(), 'Postgres needs pg_dump, which this cannot run');
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });

  test('every portability note names an area and says something', () => {
    assert.ok(PORTABILITY_NOTES.length >= 4);
    for (const n of PORTABILITY_NOTES) {
      assert.ok(n.area.length > 0 && n.note.length > 20, n.area);
    }
  });

  test('the search difference is one of them, because it is the quiet one', () => {
    assert.ok(PORTABILITY_NOTES.some(n => /case-insensitive on SQLite/.test(n.note)));
  });
});
