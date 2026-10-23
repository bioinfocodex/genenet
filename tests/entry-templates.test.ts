import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, templateById, placeholdersIn, fill, applyTemplate, looksUnfilled,
} from '../src/lib/entry-templates.ts';

describe('the shipped templates', () => {
  test('each has an id nothing else uses', () => {
    const ids = TEMPLATES.map(t => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every placeholder in a template has a field to fill it', () => {
    // A placeholder with no field is one nobody can fill from the form, and
    // it would sit in the finished entry in braces for ever.
    for (const t of TEMPLATES) {
      const used = placeholdersIn(`${t.title}\n${t.body}`);
      const offered = t.fields.map(f => f.name);
      for (const name of used) {
        assert.ok(offered.includes(name), `${t.id} uses {${name}} with no field for it`);
      }
    }
  });

  test('every field is actually used somewhere', () => {
    for (const t of TEMPLATES) {
      const used = placeholdersIn(`${t.title}\n${t.body}`);
      for (const f of t.fields) {
        assert.ok(used.includes(f.name), `${t.id} offers ${f.name} and never uses it`);
      }
    }
  });

  test('each ends with somewhere to say what went wrong', () => {
    // The part a reader a year later actually needs, and the part a blank box
    // never gets.
    for (const t of TEMPLATES) {
      assert.match(t.body, /did not work/i, t.id);
    }
  });

  test('one is found by its id, and nothing else is', () => {
    assert.equal(templateById('pcr')?.name, 'PCR');
    assert.equal(templateById('nonsense'), null);
  });
});

describe('finding the placeholders', () => {
  test('one word in braces, in order, without repeats', () => {
    assert.deepEqual(placeholdersIn('{a} then {b} then {a}'), ['a', 'b']);
    assert.deepEqual(placeholdersIn('nothing here'), []);
  });

  test('things that look like braces but are not placeholders are left alone', () => {
    // A code block, a line of pasted JSON, or a table of braces must not be
    // mistaken for a field somebody has to fill in.
    assert.deepEqual(placeholdersIn('{ "a": 1 }'), []);
    assert.deepEqual(placeholdersIn('{two words}'), []);
    assert.deepEqual(placeholdersIn('{}'), []);
    assert.deepEqual(placeholdersIn('{1st}'), []);
  });
});

describe('filling one in', () => {
  test('values go where their names are', () => {
    assert.equal(fill('Cloning — {construct}', { construct: 'pET28a-GFP' }), 'Cloning — pET28a-GFP');
  });

  test('a placeholder nobody filled stays in braces rather than becoming a gap', () => {
    // An empty gap reads as a finished sentence missing a word. The braces
    // read as something still to do, which is what it is.
    assert.equal(fill('into {strain}.', {}), 'into {strain}.');
    assert.equal(fill('into {strain}.', { strain: '   ' }), 'into {strain}.');
  });

  test('the same placeholder twice is filled both times', () => {
    assert.equal(fill('{x} and {x}', { x: 'a' }), 'a and a');
  });

  test('a value nobody asked for changes nothing', () => {
    assert.equal(fill('plain text', { x: 'a' }), 'plain text');
  });

  test('applying a template gives a title, a body, and what is still blank', () => {
    const t = templateById('transformation')!;
    const out = applyTemplate(t, { construct: 'pET28a-GFP' });
    assert.match(out.title, /pET28a-GFP/);
    assert.match(out.title, /\{strain\}/, 'the unfilled one is still visible in the title');
    assert.deepEqual(out.unfilled, ['strain']);
  });

  test('a fully filled template has nothing outstanding', () => {
    const t = templateById('transformation')!;
    const out = applyTemplate(t, { construct: 'pET28a-GFP', strain: 'BL21(DE3)' });
    assert.deepEqual(out.unfilled, []);
    assert.ok(!out.body.includes('{'));
  });
});

describe('noticing an entry nobody filled in', () => {
  const blank = templateById('blank')!;

  test('the template exactly as it came out is unfilled', () => {
    // A template signed with its headings empty is worse than no entry: it
    // looks like a record and contains nothing.
    assert.ok(looksUnfilled(blank.body, blank));
    assert.ok(looksUnfilled(`  ${blank.body}  `, blank), 'whitespace is not filling it in');
  });

  test('a placeholder still in braces counts as unfilled', () => {
    const t = templateById('pcr')!;
    assert.ok(looksUnfilled(t.body, t));
  });

  test('an entry somebody wrote in is not', () => {
    const written = blank.body.replace('## Result', '## Result\n\nTwelve colonies, all white.');
    assert.equal(looksUnfilled(written, blank), false);
  });
});
