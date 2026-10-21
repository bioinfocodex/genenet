import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  embedDigest, embedsHash, checkEmbeds, describeEmbedCheck,
  type EmbedState, type StoredEmbed,
} from '../src/lib/notebook-embeds.ts';
import { contentHash, verifyEntry } from '../src/lib/notebook.ts';

const state = (kind: string, targetId: string, s: string): EmbedState => ({ kind, targetId, state: s });
const stored = (kind: string, targetId: string, label: string, snapshot: string | null): StoredEmbed =>
  ({ kind, targetId, label, snapshot });

const entry = {
  title: 'Digest of pUC19',
  body: 'Cut [[sequence:s1|pUC19]] with EcoRI.',
  entryDate: new Date('2026-10-01T00:00:00.000Z'),
};

describe('digesting what an entry shows', () => {
  test('the same state digests the same, a different one does not', () => {
    assert.equal(embedDigest(state('sequence', 's1', 'ACGT')), embedDigest(state('sequence', 's1', 'ACGT')));
    assert.notEqual(embedDigest(state('sequence', 's1', 'ACGT')), embedDigest(state('sequence', 's1', 'ACGA')));
  });

  test('the same state under a different record is a different digest', () => {
    assert.notEqual(embedDigest(state('sequence', 's1', 'ACGT')), embedDigest(state('sequence', 's2', 'ACGT')));
    assert.notEqual(embedDigest(state('sequence', 's1', 'ACGT')), embedDigest(state('sample', 's1', 'ACGT')));
  });

  test('the order links come back in cannot change the result', () => {
    const a = embedsHash([state('sequence', 's1', 'x'), state('sample', 'm1', 'y')]);
    const b = embedsHash([state('sample', 'm1', 'y'), state('sequence', 's1', 'x')]);
    assert.equal(a, b);
  });

  test('nothing embedded is no hash at all', () => {
    assert.equal(embedsHash([]), null);
  });
});

describe('a signature made before embeds were covered still verifies', () => {
  test('an entry with nothing embedded hashes exactly as it used to', () => {
    // The payload must stay byte-identical when there is nothing to fold in,
    // or every signature already in the database stops verifying.
    assert.equal(contentHash(entry), contentHash(entry, []));
  });

  test('an old signature over an entry that embeds nothing is still intact', () => {
    const signed = contentHash(entry);
    const v = verifyEntry({ ...entry, contentHash: signed, status: 'SIGNED' });
    assert.ok(v.intact);
  });
});

describe('what a signature covers once something is embedded', () => {
  const sequenceState = (bases: string) => state('sequence', 's1', bases);

  test('signing folds in the state of what is shown', () => {
    const withEmbed = contentHash(entry, [sequenceState('ACGT')]);
    assert.notEqual(withEmbed, contentHash(entry), 'the digest is not the text alone');
    assert.notEqual(withEmbed, contentHash(entry, [sequenceState('ACGA')]), 'and it follows the state');
  });

  test('the text untouched and the construct edited is reported as such', () => {
    // The hole this whole file exists to close: before, the entry verified as
    // intact while the page showed a different sequence from the one signed.
    const snapshot = embedDigest(sequenceState('ACGT'));
    const signed = contentHash(entry, [sequenceState('ACGT')]);

    const v = verifyEntry({
      ...entry,
      contentHash: signed,
      status: 'SIGNED',
      embeds: [stored('sequence', 's1', 'pUC19', snapshot)],
      current: [sequenceState('ACGA')],
    });
    assert.equal(v.intact, false);
    assert.equal(v.embedsChanged, true);
    assert.match(v.reason, /pUC19 has changed since this was signed/);
  });

  test('nothing changed is intact, and says both halves are', () => {
    const snapshot = embedDigest(sequenceState('ACGT'));
    const v = verifyEntry({
      ...entry,
      contentHash: contentHash(entry, [sequenceState('ACGT')]),
      status: 'SIGNED',
      embeds: [stored('sequence', 's1', 'pUC19', snapshot)],
      current: [sequenceState('ACGT')],
    });
    assert.ok(v.intact);
    assert.match(v.reason, /everything it shows/);
  });

  test('altered text is reported as altered text, not as a changed embed', () => {
    const snapshot = embedDigest(sequenceState('ACGT'));
    const signed = contentHash(entry, [sequenceState('ACGT')]);
    const v = verifyEntry({
      ...entry,
      body: 'Cut [[sequence:s1|pUC19]] with BamHI.',
      contentHash: signed,
      status: 'SIGNED',
      embeds: [stored('sequence', 's1', 'pUC19', snapshot)],
      current: [sequenceState('ACGT')],
    });
    assert.equal(v.intact, false);
    assert.equal(v.embedsChanged, undefined);
    assert.match(v.reason, /Content no longer matches/);
  });

  test('verification cannot pass by recomputing the snapshot from today', () => {
    // If the check digested the record as it is now on both sides it would
    // always agree with itself. The stored digest is the only thing that can
    // stand for what was signed.
    const signed = contentHash(entry, [sequenceState('ACGT')]);
    const v = verifyEntry({
      ...entry,
      contentHash: signed,
      status: 'SIGNED',
      embeds: [stored('sequence', 's1', 'pUC19', embedDigest(sequenceState('ACGT')))],
      current: [sequenceState('EDITED')],
    });
    assert.equal(v.intact, false);
  });
});

describe('comparing what was signed with what is there', () => {
  test('a record that has gone is reported apart from one that has changed', () => {
    // Different facts: one says the page shows something other than what was
    // signed, the other that it cannot show it at all.
    const check = checkEmbeds(
      [
        stored('sequence', 's1', 'pUC19', embedDigest(state('sequence', 's1', 'A'))),
        stored('sample', 'm1', 'PLA-001', embedDigest(state('sample', 'm1', 'B'))),
      ],
      [state('sequence', 's1', 'CHANGED')],
    );
    assert.deepEqual(check.changed.map(c => c.label), ['pUC19']);
    assert.deepEqual(check.missing.map(c => c.label), ['PLA-001']);
    assert.equal(check.ok, false);
  });

  test('a link with no snapshot is neither intact nor changed, and says so', () => {
    const check = checkEmbeds([stored('sequence', 's1', 'pUC19', null)], [state('sequence', 's1', 'A')]);
    assert.deepEqual(check.unrecorded.map(c => c.label), ['pUC19']);
    assert.equal(check.changed.length, 0);
    assert.ok(check.ok, 'it is not a failure, it is an absence of evidence');
    assert.match(describeEmbedCheck(check)!, /nothing can be said/);
  });

  test('everything matching has nothing to say', () => {
    const check = checkEmbeds(
      [stored('sequence', 's1', 'pUC19', embedDigest(state('sequence', 's1', 'A')))],
      [state('sequence', 's1', 'A')],
    );
    assert.ok(check.ok);
    assert.equal(describeEmbedCheck(check), null);
  });

  test('many changed records are summarised rather than listed in full', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      stored('sequence', `s${i}`, `seq${i}`, embedDigest(state('sequence', `s${i}`, 'A'))));
    const check = checkEmbeds(many, many.map(m => state(m.kind, m.targetId, 'B')));
    assert.match(describeEmbedCheck(check)!, /and 3 more/);
  });

  test('nothing embedded is nothing to check', () => {
    const check = checkEmbeds([], []);
    assert.ok(check.ok);
    assert.equal(describeEmbedCheck(check), null);
  });
});
