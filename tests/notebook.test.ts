import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentHash, verifyEntry, canEdit, canWitness, extractLinks, excerpt, linkHref,
} from '../src/lib/notebook.ts';

const DAY = new Date('2026-03-14T00:00:00Z');
const entry = (over: Record<string, unknown> = {}) => ({
  title: 'Colony PCR of the Gibson assembly',
  body: 'Ran 12 colonies. Eight gave the right band.',
  entryDate: DAY,
  ...over,
});

test('the same content hashes the same, different content does not', () => {
  assert.equal(contentHash(entry()), contentHash(entry()));
  assert.notEqual(contentHash(entry()), contentHash(entry({ body: 'Ran 11 colonies.' })));
  assert.notEqual(contentHash(entry()), contentHash(entry({ title: 'Colony PCR' })));
  assert.notEqual(contentHash(entry()), contentHash(entry({ entryDate: new Date('2026-03-15') })));
});

test('moving text between title and body changes the hash', () => {
  // The classic collision: concatenating fields directly makes these identical.
  const a = contentHash({ title: 'AB', body: 'CD', entryDate: DAY });
  const b = contentHash({ title: 'A', body: 'BCD', entryDate: DAY });
  assert.notEqual(a, b);
});

test('a draft claims nothing, and says so', () => {
  const r = verifyEntry({ ...entry(), contentHash: null, status: 'DRAFT' });
  assert.equal(r.intact, true);
  assert.match(r.reason, /not signed/);
});

test('a signed entry verifies while it is unchanged, and fails once it is not', () => {
  const e = entry();
  const hash = contentHash(e);
  assert.equal(verifyEntry({ ...e, contentHash: hash, status: 'SIGNED' }).intact, true);

  const tampered = verifyEntry({ ...e, body: 'Ran 12 colonies. All twelve were right.', contentHash: hash, status: 'SIGNED' });
  assert.equal(tampered.intact, false);
  assert.match(tampered.reason, /no longer matches/);
});

test('an entry marked signed with no digest is not treated as verified', () => {
  const r = verifyEntry({ ...entry(), contentHash: null, status: 'SIGNED' });
  assert.equal(r.intact, false);
  assert.match(r.reason, /unverified/);
});

test('a signed entry cannot be edited, by anyone, including an admin', () => {
  for (const status of ['SIGNED', 'WITNESSED'] as const) {
    const author = canEdit({ status, authorId: 'u1' }, 'u1', 'MEMBER');
    assert.equal(author.allowed, false, status);
    assert.match(author.reason, /supersedes it/);
    // An admin does not get an exception here: the point of the signature is
    // that the content is fixed, and an admin override would empty it.
    assert.equal(canEdit({ status, authorId: 'u1' }, 'admin', 'ADMIN').allowed, false, status);
  }
});

test('a draft is editable by its author, and by an admin, but not by a bystander', () => {
  const draft = { status: 'DRAFT' as const, authorId: 'u1' };
  assert.equal(canEdit(draft, 'u1', 'MEMBER').allowed, true);
  assert.equal(canEdit(draft, 'admin', 'ADMIN').allowed, true);
  const other = canEdit(draft, 'u2', 'MEMBER');
  assert.equal(other.allowed, false);
  assert.match(other.reason, /Only the author/);
});

test('a witness has to be someone other than the person who signed', () => {
  const signed = { status: 'SIGNED' as const, authorId: 'u1', signedById: 'u1' };
  const self = canWitness(signed, 'u1');
  assert.equal(self.allowed, false);
  assert.match(self.reason, /other than the person who signed/);
  assert.equal(canWitness(signed, 'u2').allowed, true);
});

test('an unsigned or already-witnessed entry cannot be witnessed', () => {
  assert.equal(
    canWitness({ status: 'DRAFT', authorId: 'u1', signedById: null }, 'u2').allowed, false);
  assert.match(
    canWitness({ status: 'DRAFT', authorId: 'u1', signedById: null }, 'u2').reason,
    /has not signed/);
  assert.equal(
    canWitness({ status: 'WITNESSED', authorId: 'u1', signedById: 'u1' }, 'u2').allowed, false);
});

test('an entry that someone else signed still cannot be witnessed by its author', () => {
  // The author is the one person whose witness signature means nothing, even
  // when a second person did the signing.
  const e = { status: 'SIGNED' as const, authorId: 'u1', signedById: 'u2' };
  assert.equal(canWitness(e, 'u1').allowed, false);
  assert.equal(canWitness(e, 'u3').allowed, true);
});

test('links are pulled out of the prose, not maintained separately', () => {
  const body = 'Digested [[sequence:seq123|pUC19-GFP]] and ran it beside [[sample:smp9|PLA-004]].';
  assert.deepEqual(extractLinks(body), [
    { kind: 'sequence', targetId: 'seq123', label: 'pUC19-GFP' },
    { kind: 'sample', targetId: 'smp9', label: 'PLA-004' },
  ]);
});

test('a link without a label falls back to the id', () => {
  assert.deepEqual(extractLinks('see [[plate:plt1]]'), [
    { kind: 'plate', targetId: 'plt1', label: 'plt1' },
  ]);
});

test('the same record mentioned twice is one link', () => {
  const body = '[[sample:s1|A]] then again [[sample:s1|A]] and [[sample:s2|B]]';
  assert.deepEqual(extractLinks(body).map(l => l.targetId), ['s1', 's2']);
});

test('an unknown link kind is ignored rather than producing a dead link', () => {
  assert.deepEqual(extractLinks('[[wombat:w1|Wombat]] [[task:t1|Task]]').map(l => l.kind), ['task']);
});

test('link hrefs are produced for known kinds only', () => {
  assert.equal(linkHref('sequence', 'abc'), '/sequences/abc');
  assert.equal(linkHref('plate', 'abc'), '/plates/abc');
  assert.equal(linkHref('wombat', 'abc'), null);
});

test('an excerpt shows the link labels, not the markup', () => {
  const body = 'Digested [[sequence:seq123|pUC19-GFP]] overnight.';
  assert.equal(excerpt(body), 'Digested pUC19-GFP overnight.');
});

test('an excerpt is trimmed to length and marked as trimmed', () => {
  const long = 'word '.repeat(100);
  const e = excerpt(long, 40);
  assert.equal(e.length, 40);
  assert.ok(e.endsWith('…'));
  assert.equal(excerpt('short', 40), 'short');
});
