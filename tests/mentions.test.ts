import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMentions, segments, isCommentable, commentHref, COMMENTABLE, type Person,
} from '../src/lib/mentions.ts';

const people: Person[] = [
  { id: 'u1', name: 'Jane Smith', email: 'jane@lab.org' },
  { id: 'u2', name: 'Priya Shah', email: 'priya.shah@lab.org' },
  { id: 'u3', name: 'Jane', email: 'jane.other@lab.org' },
  { id: 'u4', name: 'José Álvarez', email: 'jose@lab.org' },
];

const names = (text: string) => findMentions(text, people).map(m => m.person.name);

describe('finding who is being told', () => {
  test('a full name with a space in it', () => {
    // Matching one word after the @ gets "Priya" out of "@Priya Shah" and
    // then fails to find anybody called Priya.
    assert.deepEqual(names('can @Priya Shah look at this'), ['Priya Shah']);
  });

  test('the longest name wins, so a first name does not shadow a full one', () => {
    assert.deepEqual(names('@Jane Smith ran the gel'), ['Jane Smith']);
    assert.deepEqual(names('@Jane ran the gel'), ['Jane']);
  });

  test('a name is not swallowed by the words after it', () => {
    const found = findMentions('@Jane Smith ran the gel', people);
    assert.equal(found[0].text, '@Jane Smith');
  });

  test('sentence punctuation is not part of the name', () => {
    assert.deepEqual(names('ask @Priya Shah.'), ['Priya Shah']);
    assert.deepEqual(names('ask @Priya Shah, please'), ['Priya Shah']);
  });

  test('accents do not have to be typed', () => {
    assert.deepEqual(names('@Jose Alvarez has the plate'), ['José Álvarez']);
    assert.deepEqual(names('@José Álvarez has the plate'), ['José Álvarez']);
  });

  test('the part of an address before the @ works too', () => {
    // What people type when a name has an accent or a space they cannot be
    // bothered with.
    assert.deepEqual(names('@priya.shah any idea?'), ['Priya Shah']);
  });

  test('one person mentioned twice is told once', () => {
    assert.deepEqual(names('@Jane Smith and @Jane Smith again'), ['Jane Smith']);
  });

  test('several people, in the order they appear', () => {
    assert.deepEqual(names('@Jane Smith and @Priya Shah'), ['Jane Smith', 'Priya Shah']);
  });
});

describe('what is not a mention', () => {
  test('an email address is not a mention of anybody', () => {
    assert.deepEqual(names('write to jane@lab.org about it'), []);
    assert.deepEqual(names('jane.other@lab.org'), []);
  });

  test('an @ in front of something that is not a name', () => {
    // A concentration, a handle from somewhere else, a stray sign.
    assert.deepEqual(names('incubated @37C overnight'), []);
    assert.deepEqual(names('see @nobody about it'), []);
    assert.deepEqual(names('@'), []);
  });

  test('a name with nobody behind it is not a mention', () => {
    assert.deepEqual(findMentions('@Jane Smith', []), []);
  });

  test('a mention at the very start of a comment counts', () => {
    assert.deepEqual(names('@Jane Smith please look'), ['Jane Smith']);
  });

  test('a mention in brackets counts', () => {
    assert.deepEqual(names('(@Jane Smith knows)'), ['Jane Smith']);
    assert.deepEqual(names('> @Jane Smith said so'), ['Jane Smith']);
  });
});

describe('splitting a comment up to render it', () => {
  test('text, mention, text', () => {
    const out = segments('ask @Jane Smith tomorrow', people);
    assert.deepEqual(out.map(s => s.kind), ['text', 'mention', 'text']);
    assert.equal(out[0].text, 'ask ');
    assert.equal(out[1].text, '@Jane Smith');
    assert.equal(out[2].text, ' tomorrow');
  });

  test('the pieces put back together are the original comment', () => {
    for (const text of [
      'ask @Jane Smith tomorrow',
      '@Priya Shah and @Jane Smith',
      'no mentions here',
      '@Jane Smith',
      'mail jane@lab.org not @Jane Smith',
    ]) {
      assert.equal(segments(text, people).map(s => s.text).join(''), text, text);
    }
  });

  test('the same person twice is two mentions on the page', () => {
    // Rendering needs every place a name appears; notifying needs the set.
    const out = segments('@Jane Smith then @Jane Smith', people);
    assert.equal(out.filter(s => s.kind === 'mention').length, 2);
    assert.equal(findMentions('@Jane Smith then @Jane Smith', people).length, 1);
  });

  test('an empty comment is no pieces', () => {
    assert.deepEqual(segments('', people), []);
  });
});

describe('what can be commented on', () => {
  test('a known kind gets a link back to the record', () => {
    assert.equal(commentHref('sequence', 'abc'), '/sequences/abc');
    assert.equal(commentHref('entry', 'n1'), '/notebook/n1');
  });

  test('an unknown kind gets none, rather than a link that 404s', () => {
    assert.equal(commentHref('nonsense', 'abc'), null);
    assert.equal(isCommentable('nonsense'), false);
  });

  test('every kind on the list has a path', () => {
    for (const kind of COMMENTABLE) assert.ok(commentHref(kind, 'x'), kind);
  });
});
