import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyFromLabel, uniqueKey, validateDefinition, coerce, decode, format,
  coerceRecord, columnFor, nextCode, validatePrefix, MULTI_SEP,
  type FieldDefinition,
} from '../src/lib/fields.ts';

const text = (over: Partial<FieldDefinition> = {}): FieldDefinition =>
  ({ key: 'note', label: 'Note', type: 'text', ...over });

test('keys are derived from labels and are always usable identifiers', () => {
  assert.equal(keyFromLabel('OD 600'), 'od_600');
  assert.equal(keyFromLabel('  Antibiotic  '), 'antibiotic');
  assert.equal(keyFromLabel('Growth (°C)'), 'growth_c');
  // A label starting with a digit would otherwise give an unusable key.
  assert.equal(keyFromLabel('600 nm'), 'f_600_nm');
  // A label of only punctuation must still produce something.
  assert.equal(keyFromLabel('###'), 'field');
});

test('a generated key never collides with one already taken', () => {
  assert.equal(uniqueKey('od', []), 'od');
  assert.equal(uniqueKey('od', ['od']), 'od_2');
  assert.equal(uniqueKey('od', ['od', 'od_2', 'od_3']), 'od_4');
});

test('a definition that cannot work is refused', () => {
  assert.deepEqual(validateDefinition(text()), []);
  assert.ok(validateDefinition(text({ label: '  ' })).some(p => /needs a label/.test(p)));
  assert.ok(validateDefinition(text({ key: '2bad' })).some(p => /usable key/.test(p)));
  assert.ok(validateDefinition(text({ type: 'select', options: [] })).some(p => /no options/.test(p)));
  assert.ok(validateDefinition(text({ type: 'select', options: ['a', 'a'] })).some(p => /duplicate/.test(p)));
  assert.ok(validateDefinition(text({ type: 'link' })).some(p => /does not say which type/.test(p)));
  assert.ok(validateDefinition(text({ type: 'boolean', isUnique: true })).some(p => /cannot be unique/.test(p)));
});

test('an option carrying the separator is refused, because it would come back as two', () => {
  const def = text({ type: 'multiselect', options: [`Amp${MULTI_SEP}Kan`, 'Cam'] });
  assert.ok(validateDefinition(def).some(p => /control character/.test(p)));
});

test('a required field refuses blank; an optional one accepts it', () => {
  const req = coerce(text({ required: true }), '');
  assert.ok('error' in req && /required/.test(req.error));
  const opt = coerce(text(), '');
  assert.ok('value' in opt && opt.value.text === null);
});

test('numbers are parsed, and a whole-number field refuses a fraction', () => {
  const n = coerce(text({ type: 'number' }), ' 0.85 ');
  assert.ok('value' in n && n.value.number === 0.85);
  assert.ok('error' in coerce(text({ type: 'number' }), 'abc'));
  assert.ok('error' in coerce(text({ type: 'integer' }), '2.5'));
  const i = coerce(text({ type: 'integer' }), '37');
  assert.ok('value' in i && i.value.number === 37);
});

test('booleans accept the spellings a form actually sends', () => {
  for (const yes of [true, 'true', 'yes', 'on', '1']) {
    const r = coerce(text({ type: 'boolean' }), yes);
    assert.ok('value' in r && r.value.boolean === true, String(yes));
  }
  for (const no of [false, 'false', 'no', 'off', '0']) {
    const r = coerce(text({ type: 'boolean' }), no);
    assert.ok('value' in r && r.value.boolean === false, String(no));
  }
  assert.ok('error' in coerce(text({ type: 'boolean' }), 'maybe'));
});

test('a select must be one of its options', () => {
  const def = text({ type: 'select', options: ['Amp', 'Kan'] });
  const ok = coerce(def, 'Kan');
  assert.ok('value' in ok && ok.value.text === 'Kan');
  const bad = coerce(def, 'Cam');
  assert.ok('error' in bad && /must be one of: Amp, Kan/.test(bad.error));
});

test('a multiselect round-trips, including an option containing a comma', () => {
  const def = text({ type: 'multiselect', options: ['Amp, Kan', 'Cam', 'Spec'] });
  const r = coerce(def, ['Amp, Kan', 'Spec']);
  assert.ok('value' in r);
  // The comma inside the option must not have split it.
  assert.deepEqual(decode(def, r.value), ['Amp, Kan', 'Spec']);
  assert.equal(format(def, r.value), 'Amp, Kan, Spec');
});

test('a multiselect refuses an option not on the list, and a repeat', () => {
  const def = text({ type: 'multiselect', options: ['Amp', 'Kan'] });
  const bad = coerce(def, ['Amp', 'Cam']);
  assert.ok('error' in bad && /Cam not in the list/.test(bad.error));
  const dup = coerce(def, ['Amp', 'Amp']);
  assert.ok('error' in dup && /same option twice/.test(dup.error));
});

test('dates parse, and rubbish is refused rather than becoming Invalid Date', () => {
  const r = coerce(text({ type: 'date' }), '2026-03-14');
  assert.ok('value' in r && r.value.date instanceof Date);
  assert.equal((r as { value: { date: Date } }).value.date.getUTCFullYear(), 2026);
  assert.ok('error' in coerce(text({ type: 'date' }), 'sometime'));
});

test('every value type decodes back to what went in', () => {
  const cases: [FieldDefinition, unknown][] = [
    [text(), 'hello'],
    [text({ type: 'longtext' }), 'a longer note'],
    [text({ type: 'number' }), 0.85],
    [text({ type: 'integer' }), 12],
    [text({ type: 'boolean' }), true],
    [text({ type: 'select', options: ['x', 'y'] }), 'y'],
  ];
  for (const [def, input] of cases) {
    const r = coerce(def, input);
    assert.ok('value' in r, def.type);
    assert.deepEqual(decode(def, r.value), input, def.type);
  }
});

test('formatting adds the unit and renders an empty value as a dash', () => {
  const def = text({ type: 'number', unit: 'µM' });
  const r = coerce(def, 25);
  assert.ok('value' in r);
  assert.equal(format(def, r.value), '25 µM');
  assert.equal(format(def, null), '—');
  assert.equal(format(text({ type: 'multiselect', options: ['a'] }), { text: null }), '—');
  assert.equal(format(text({ type: 'boolean' }), { boolean: false }), 'No');
});

test('a reference formats as the name captured at write time, not the raw id', () => {
  const def = text({ type: 'sample' });
  assert.equal(format(def, { refId: 'clx123', text: 'PLA-004' }), 'PLA-004');
  // With no captured name there is nothing better to show than the id.
  assert.equal(format(def, { refId: 'clx123', text: null }), 'clx123');
});

test('a record reports every problem at once, not one per round trip', () => {
  const defs = [
    text({ key: 'a', label: 'A', required: true }),
    text({ key: 'b', label: 'B', type: 'number' }),
    text({ key: 'c', label: 'C', type: 'select', options: ['x'] }),
  ];
  const r = coerceRecord(defs, { a: '', b: 'not a number', c: 'y' });
  assert.ok('errors' in r);
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.errors.map(e => e.key), ['a', 'b', 'c']);
});

test('a valid record coerces every field', () => {
  const defs = [
    text({ key: 'a', label: 'A' }),
    text({ key: 'b', label: 'B', type: 'number' }),
  ];
  const r = coerceRecord(defs, { a: 'hi', b: '3' });
  assert.ok('values' in r);
  assert.equal(r.values.a.text, 'hi');
  assert.equal(r.values.b.number, 3);
});

test('each type knows which column it lives in', () => {
  assert.equal(columnFor('number'), 'number');
  assert.equal(columnFor('integer'), 'number');
  assert.equal(columnFor('boolean'), 'boolean');
  assert.equal(columnFor('date'), 'date');
  assert.equal(columnFor('link'), 'refEntityId');
  assert.equal(columnFor('sample'), 'refId');
  assert.equal(columnFor('select'), 'text');
});

test('codes count from the highest issued, so a deleted one is never reused', () => {
  assert.equal(nextCode('STR', []), 'STR-001');
  assert.equal(nextCode('STR', ['STR-001', 'STR-002']), 'STR-003');
  // STR-002 deleted: the next must still be 003.
  assert.equal(nextCode('STR', ['STR-001', 'STR-003']), 'STR-004');
  // Another type's codes are not this type's business.
  assert.equal(nextCode('STR', ['AB-009', 'STR-001']), 'STR-002');
  assert.equal(nextCode('STR', ['STR-012']), 'STR-013');
});

test('prefixes are constrained because they go on labels', () => {
  assert.equal(validatePrefix('STR'), null);
  assert.equal(validatePrefix('AB1'), null);
  assert.ok(validatePrefix('S'));
  assert.ok(validatePrefix('TOOLONG'));
  assert.ok(validatePrefix('str'));
  assert.ok(validatePrefix('1AB'));
});
