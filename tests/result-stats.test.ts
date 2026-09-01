import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summariseNumeric, summariseCategory, summariseResults, groupBy, fmt,
} from '../src/lib/result-stats.ts';
import type { FieldDefinition } from '../src/lib/fields.ts';

const num = (over: Partial<FieldDefinition> = {}): FieldDefinition =>
  ({ id: 'f1', key: 'od', label: 'OD600', type: 'number', unit: 'AU', ...over });

const row = (fieldId: string, over: Record<string, unknown> = {}) => ({
  fieldId, text: null, number: null, boolean: null, date: null,
  refId: null, refEntityId: null, ...over,
});

test('mean, median and range come out right', () => {
  const s = summariseNumeric(num(), [1, 2, 3, 4, 100]);
  assert.ok(s);
  assert.equal(s.n, 5);
  assert.equal(s.mean, 22);
  assert.equal(s.median, 3, 'the median is not dragged by the outlier');
  assert.equal(s.min, 1);
  assert.equal(s.max, 100);
});

test('the median of an even count is the midpoint of the middle two', () => {
  assert.equal(summariseNumeric(num(), [1, 2, 3, 4])!.median, 2.5);
});

test('the standard deviation is the sample one, not the population one', () => {
  // For [2, 4, 6]: mean 4, deviations 2/0/2, sum of squares 8.
  // Sample sd = sqrt(8/2) = 2. Population sd = sqrt(8/3) = 1.633.
  const s = summariseNumeric(num(), [2, 4, 6]);
  assert.ok(s?.sd);
  assert.ok(Math.abs(s.sd - 2) < 1e-12, `got ${s.sd}`);
  assert.ok(Math.abs(s.sd - Math.sqrt(8 / 3)) > 0.36, 'and is not the population figure');
});

test('a triplicate is where the two formulas actually differ', () => {
  // The claim in the module comment: for n = 3 the population formula
  // understates the spread by about 18%. sqrt(2/3) = 0.8165.
  const s = summariseNumeric(num(), [10, 12, 14])!;
  const population = Math.sqrt(((10 - 12) ** 2 + 0 + (14 - 12) ** 2) / 3);
  assert.ok(Math.abs(population / s.sd! - 0.8165) < 0.001, `${population / s.sd!}`);
});

test('a single reading has no standard deviation, rather than zero', () => {
  const s = summariseNumeric(num(), [42]);
  assert.ok(s);
  assert.equal(s.n, 1);
  assert.equal(s.mean, 42);
  assert.equal(s.sd, null, 'sd of one value is undefined, and zero would read as perfect precision');
  assert.equal(s.cv, null);
});

test('the coefficient of variation is a percentage of the mean', () => {
  const s = summariseNumeric(num(), [2, 4, 6])!;
  assert.ok(Math.abs(s.cv! - 50) < 1e-9, `${s.cv}`);
});

test('a mean of zero gives no CV rather than infinity', () => {
  const s = summariseNumeric(num(), [-1, 0, 1])!;
  assert.equal(s.mean, 0);
  assert.equal(s.cv, null);
});

test('nothing measured gives nothing, not a summary of an empty set', () => {
  assert.equal(summariseNumeric(num(), []), null);
  assert.equal(summariseNumeric(num(), [NaN, Infinity]), null);
});

test('non-finite readings are dropped without poisoning the mean', () => {
  const s = summariseNumeric(num(), [1, NaN, 3])!;
  assert.equal(s.n, 2);
  assert.equal(s.mean, 2);
});

test('categorical fields are counted, commonest first', () => {
  const def: FieldDefinition = { id: 'f2', key: 'v', label: 'Verdict', type: 'select', options: ['pass', 'fail'] };
  const s = summariseCategory(def, ['pass', 'fail', 'pass', 'pass', null, '']);
  assert.deepEqual(s.counts, [{ value: 'pass', count: 3 }, { value: 'fail', count: 1 }]);
});

test('a multiselect counts each chosen option, not each reading', () => {
  const def: FieldDefinition = { id: 'f3', key: 'm', label: 'Markers', type: 'multiselect', options: ['Amp', 'Kan'] };
  const s = summariseCategory(def, [['Amp', 'Kan'], ['Amp']]);
  assert.deepEqual(s.counts, [{ value: 'Amp', count: 2 }, { value: 'Kan', count: 1 }]);
});

test('booleans read as Yes and No rather than true and false', () => {
  const def: FieldDefinition = { id: 'f4', key: 'p', label: 'Passed', type: 'boolean' };
  const s = summariseCategory(def, [true, true, false]);
  assert.deepEqual(s.counts, [{ value: 'Yes', count: 2 }, { value: 'No', count: 1 }]);
});

test('a whole schema summarises its numeric and categorical fields separately', () => {
  const defs: FieldDefinition[] = [
    { id: 'a', key: 'od', label: 'OD600', type: 'number', unit: 'AU' },
    { id: 'b', key: 'verdict', label: 'Verdict', type: 'select', options: ['pass', 'fail'] },
    { id: 'c', key: 'note', label: 'Note', type: 'text' },
  ];
  const results = [
    { values: [row('a', { number: 0.4 }), row('b', { text: 'pass' }), row('c', { text: 'x' })] },
    { values: [row('a', { number: 0.6 }), row('b', { text: 'fail' }), row('c', { text: 'y' })] },
  ];
  const s = summariseResults(defs, results);
  assert.equal(s.numeric.length, 1);
  assert.equal(s.numeric[0].label, 'OD600');
  assert.ok(Math.abs(s.numeric[0].mean - 0.5) < 1e-12);
  assert.equal(s.categorical.length, 1);
  assert.equal(s.categorical[0].label, 'Verdict');
  // Free text is neither summarised as a number nor counted as a category.
  assert.ok(!s.numeric.some(x => x.key === 'note'));
  assert.ok(!s.categorical.some(x => x.key === 'note'));
});

test('a numeric field nobody filled in is left out of the summary', () => {
  const defs: FieldDefinition[] = [{ id: 'a', key: 'od', label: 'OD600', type: 'number' }];
  const s = summariseResults(defs, [{ values: [row('a')] }]);
  assert.deepEqual(s.numeric, []);
});

test('grouping splits by a categorical field and summarises each group', () => {
  const defs: FieldDefinition[] = [
    { id: 'a', key: 'od', label: 'OD600', type: 'number' },
    { id: 'b', key: 'arm', label: 'Arm', type: 'select', options: ['control', 'treated'] },
  ];
  const results = [
    { values: [row('a', { number: 1 }), row('b', { text: 'control' })] },
    { values: [row('a', { number: 3 }), row('b', { text: 'control' })] },
    { values: [row('a', { number: 10 }), row('b', { text: 'treated' })] },
  ];
  const groups = groupBy(defs, results, defs[1]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].value, 'control');
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].numeric[0].mean, 2);
  assert.equal(groups[1].value, 'treated');
  assert.equal(groups[1].numeric[0].mean, 10);
});

test('readings with no group value land in a bucket that sorts last', () => {
  const defs: FieldDefinition[] = [
    { id: 'a', key: 'od', label: 'OD600', type: 'number' },
    { id: 'b', key: 'arm', label: 'Arm', type: 'select', options: ['treated'] },
  ];
  const groups = groupBy(defs, [
    { values: [row('a', { number: 5 }), row('b')] },
    { values: [row('a', { number: 9 }), row('b', { text: 'treated' })] },
  ], defs[1]);
  assert.deepEqual(groups.map(g => g.value), ['treated', '—']);
});

test('numbers are formatted with digits suited to their size', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(1234.5), '1,235');
  assert.equal(fmt(42.37), '42.4');
  assert.equal(fmt(1.234), '1.23');
  assert.equal(fmt(0.0456), '0.046');
  assert.equal(fmt(0.000123), '1.23e-4');
  assert.equal(fmt(NaN), '—');
  // Small negatives keep their sign.
  assert.ok(fmt(-0.5).startsWith('-'));
});
