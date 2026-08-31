import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeSequenceChange, summariseSequenceChange } from '../src/lib/sequence-diff.ts';

describe('describing a sequence change', () => {
  test('identical sequences are reported as such', () => {
    const c = describeSequenceChange('ATGCATGC', 'ATGCATGC');
    assert.equal(c.identical, true);
    assert.equal(c.delta, 0);
    assert.equal(c.firstDiff, null);
    assert.match(summariseSequenceChange(c), /unchanged/);
  });

  test('a single substitution is located exactly', () => {
    const before = 'ATGCATGCATGCATGC';
    const after  = 'ATGCATGGATGCATGC';   // position 8 changed
    const c = describeSequenceChange(before, after);
    assert.equal(c.firstDiff, 8);
    assert.equal(c.delta, 0);
    assert.equal(c.identical, false);
  });

  test('an insertion is located and its size reported', () => {
    const before = 'ATGCATGCATGCATGC';
    const after = before.slice(0, 8) + 'GGGG' + before.slice(8);
    const c = describeSequenceChange(before, after);
    assert.equal(c.delta, 4);
    assert.equal(c.firstDiff, 9);
    assert.match(summariseSequenceChange(c), /\+4/);
  });

  test('an insertion beside identical bases is reported where it becomes visible', () => {
    // Inserting AAAA immediately after an A: the inserted bases are
    // indistinguishable from the one already there, so the first observable
    // difference sits one base later than the edit did. That ambiguity is a
    // property of the sequences, not a fault, and the honest answer is where
    // they actually start to differ.
    const before = 'ATGCATGCATGCATGC';
    const after = before.slice(0, 8) + 'AAAA' + before.slice(8);
    const c = describeSequenceChange(before, after);
    assert.equal(c.delta, 4);
    assert.equal(c.firstDiff, 10, 'not 9: position 9 reads A either way');
  });

  test('a deletion is reported as a negative change', () => {
    const before = 'ATGCATGCATGCATGC';
    const after = before.slice(0, 6) + before.slice(10);
    const c = describeSequenceChange(before, after);
    assert.equal(c.delta, -4);
    assert.ok(c.firstDiff !== null);
  });

  test('a change at the very end is still found', () => {
    const c = describeSequenceChange('ATGCATGC', 'ATGCATGA');
    assert.equal(c.firstDiff, 8);
  });

  test('the context window is short enough to read', () => {
    const before = 'A'.repeat(3000);
    const after = 'A'.repeat(1500) + 'G' + 'A'.repeat(1499);
    const c = describeSequenceChange(before, after, 10);
    assert.equal(c.firstDiff, 1501);
    assert.ok(c.context!.before.length <= 22, `context was ${c.context!.before.length} bases`);
    assert.notEqual(c.context!.before, c.context!.after);
  });

  test('a three-kilobase change reads as something actionable', () => {
    // The point of the module: the generic formatter would print two truncated
    // base strings and tell you nothing.
    const before = 'ATGC'.repeat(750);
    const after = before.slice(0, 1200) + 'TTTT' + before.slice(1200);
    const line = summariseSequenceChange(describeSequenceChange(before, after));
    assert.match(line, /3,000/);
    assert.match(line, /3,004/);
    assert.match(line, /first difference at 1,201/);
  });

  test('growing from nothing is handled', () => {
    const c = describeSequenceChange('', 'ATGC');
    assert.equal(c.before, 0);
    assert.equal(c.delta, 4);
    assert.equal(c.firstDiff, 1);
  });

  test('lower case is compared as upper', () => {
    assert.equal(describeSequenceChange('atgc', 'ATGC').identical, true);
  });
});
