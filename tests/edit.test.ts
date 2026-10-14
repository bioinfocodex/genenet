import test from 'node:test';
import assert from 'node:assert/strict';
import { insertBases, deleteRange, replaceRange, cleanTyped, pushHistory, MAX_HISTORY } from '../src/lib/edit.ts';
import type { SequenceFeature } from '../src/lib/features.ts';

const f = (name: string, start: number, end: number, over: Partial<SequenceFeature> = {}): SequenceFeature =>
  ({ id: name, name, type: 'CDS', start, end, strand: 1, color: '#000', ...over });

//            1234567890
const SEQ = 'AAAACCCCGG';

test('typed input is cleaned to bases, and nothing else gets in', () => {
  assert.equal(cleanTyped('acgt'), 'ACGT');
  assert.equal(cleanTyped('ac 12 gt\n'), 'ACGT');
  assert.equal(cleanTyped('ACGTN RYW'), 'ACGTNRYW');   // IUPAC is real data
  assert.equal(cleanTyped('!!!'), '');
});

test('inserting shifts everything downstream and leaves upstream alone', () => {
  const feats = [f('up', 1, 3), f('down', 7, 10)];
  const r = insertBases(SEQ, feats, 4, 'TTT');       // after base 4
  assert.equal(r.sequence, 'AAAATTTCCCCGG');
  assert.deepEqual([r.features[0].start, r.features[0].end], [1, 3]);
  assert.deepEqual([r.features[1].start, r.features[1].end], [10, 13]);
});

test('a feature spanning the caret grows rather than shifting whole', () => {
  // Pasting a linker into the middle of a CDS makes the CDS longer. Shifting
  // it whole would leave the annotation describing the wrong bases.
  const r = insertBases(SEQ, [f('cds', 2, 8)], 4, 'TTT');
  assert.deepEqual([r.features[0].start, r.features[0].end], [2, 11]);
});

test('inserting at the very start and the very end both behave', () => {
  const atStart = insertBases(SEQ, [f('a', 1, 4)], 0, 'GG');
  assert.equal(atStart.sequence, 'GGAAAACCCCGG');
  assert.deepEqual([atStart.features[0].start, atStart.features[0].end], [3, 6]);

  const atEnd = insertBases(SEQ, [f('a', 1, 4)], SEQ.length, 'GG');
  assert.equal(atEnd.sequence, 'AAAACCCCGGGG');
  assert.deepEqual([atEnd.features[0].start, atEnd.features[0].end], [1, 4]);
});

test('deleting removes what is gone and pulls the rest back', () => {
  const r = deleteRange(SEQ, [f('after', 9, 10)], 5, 8);   // drop CCCC
  assert.equal(r.sequence, 'AAAAGG');
  assert.deepEqual([r.features[0].start, r.features[0].end], [5, 6]);
});

test('a feature wholly inside the deletion stops existing', () => {
  const r = deleteRange(SEQ, [f('doomed', 5, 8), f('kept', 1, 4)], 5, 8);
  assert.deepEqual(r.features.map(x => x.name), ['kept']);
});

test('a feature overlapping the deletion is trimmed, not left lying', () => {
  // Straddling the start of the cut.
  const left = deleteRange(SEQ, [f('x', 2, 7)], 5, 8);
  assert.deepEqual([left.features[0].start, left.features[0].end], [2, 4]);
  // Straddling the end of the cut.
  const right = deleteRange(SEQ, [f('x', 6, 10)], 5, 8);
  assert.deepEqual([right.features[0].start, right.features[0].end], [5, 6]);
  // Spanning the whole cut: it shrinks by the amount removed.
  const over = deleteRange(SEQ, [f('x', 1, 10)], 5, 8);
  assert.deepEqual([over.features[0].start, over.features[0].end], [1, 6]);
});

test('a spliced feature loses the exons that went', () => {
  const spliced = f('gene', 1, 10, { segments: [{ start: 1, end: 3 }, { start: 5, end: 6 }, { start: 9, end: 10 }] });
  const r = deleteRange(SEQ, [spliced], 5, 6);
  assert.equal(r.sequence, 'AAAACCGG');
  assert.deepEqual(r.features[0].segments, [{ start: 1, end: 3 }, { start: 7, end: 8 }]);
});

test('a splice reduced to one block stops claiming to be spliced', () => {
  const spliced = f('gene', 1, 10, { segments: [{ start: 1, end: 3 }, { start: 9, end: 10 }] });
  const r = deleteRange(SEQ, [spliced], 9, 10);
  assert.equal(r.features[0].segments, undefined,
    'one block is not a splice, and drawing an intron line across it would be a lie');
});

test('replacing a selection is a delete then an insert at the same place', () => {
  const r = replaceRange(SEQ, [f('after', 9, 10)], 5, 8, 'T');
  assert.equal(r.sequence, 'AAAATGG');
  assert.deepEqual([r.features[0].start, r.features[0].end], [6, 7]);
});

test('an edit and its opposite return the original', () => {
  // The property that matters for undo being trustworthy at all.
  const feats = [f('a', 2, 8), f('b', 9, 10)];
  const grown = insertBases(SEQ, feats, 4, 'TTT');
  const back = deleteRange(grown.sequence, grown.features, 5, 7);
  assert.equal(back.sequence, SEQ);
  assert.deepEqual(back.features.map(x => [x.start, x.end]), feats.map(x => [x.start, x.end]));
});

test('history is bounded, and keeps the most recent', () => {
  let stack: ReturnType<typeof pushHistory> = [];
  for (let i = 0; i < MAX_HISTORY + 10; i++) {
    stack = pushHistory(stack, { sequence: String(i), features: [], label: String(i) });
  }
  assert.equal(stack.length, MAX_HISTORY);
  assert.equal(stack[stack.length - 1].label, String(MAX_HISTORY + 9));
});
