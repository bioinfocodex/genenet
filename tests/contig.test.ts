import test from 'node:test';
import assert from 'node:assert/strict';
import { trimRead, findOverlap, assembleReads, END_ZONE } from '../src/lib/contig.ts';
import { revComp } from '../src/lib/alignment.ts';
import { makeSeq } from './support/sequences.ts';


const TEMPLATE = makeSeq(900);

test('trimming cuts back the low-quality ends and keeps the middle', () => {
  const seq = makeSeq(200, 3);
  // Sanger shape: noise at the start, decay at the end, good in between.
  const quality = seq.split('').map((_, i) => (i < 15 || i > 170 ? 8 : 45));
  const t = trimRead({ name: 'r', sequence: seq, quality });

  // Exactly the bad bases go, and not one good one: 15 off the front, and the
  // 29 from index 171 to the end.
  assert.equal(t.trimmedStart, 15);
  assert.equal(t.trimmedEnd, 29);
  assert.equal(t.sequence, seq.slice(15, 171));
});

test('with no quality scores it trims leading and trailing ambiguity', () => {
  const t = trimRead({ name: 'r', sequence: 'NNNNACGTACGTACGTNNN' });
  assert.equal(t.sequence, 'ACGTACGTACGT');
  assert.equal(t.trimmedStart, 4);
  assert.equal(t.trimmedEnd, 3);
});

test('an overlap is found through a few mismatches', () => {
  const a = makeSeq(100, 11);
  const shared = a.slice(60);            // 40 bp tail
  // One base wrong in the shared region: a normal Sanger miscall.
  const b = shared.slice(0, 20) + (shared[20] === 'A' ? 'C' : 'A') + shared.slice(21) + makeSeq(60, 12);

  const o = findOverlap(a, b, 20, 0.9);
  assert.ok(o, 'overlap found despite the mismatch');
  assert.equal(o.length, 40);
  assert.ok(o.identity > 0.95 && o.identity < 1);
});

test('an exact-match requirement would have refused that same overlap', () => {
  const a = makeSeq(100, 11);
  const shared = a.slice(60);
  const b = shared.slice(0, 20) + (shared[20] === 'A' ? 'C' : 'A') + shared.slice(21) + makeSeq(60, 12);
  assert.equal(findOverlap(a, b, 20, 1.0), null);
});

test('four tiled reads rebuild the template', () => {
  const reads = [
    { name: 'F1', sequence: TEMPLATE.slice(0, 300) },
    { name: 'F2', sequence: TEMPLATE.slice(220, 520) },
    { name: 'F3', sequence: TEMPLATE.slice(440, 740) },
    { name: 'F4', sequence: TEMPLATE.slice(660, 900) },
  ];
  const { contigs } = assembleReads(reads);
  assert.equal(contigs.length, 1);
  assert.equal(contigs[0].consensus, TEMPLATE);
  assert.equal(contigs[0].reads.length, 4);
});

test('reads sequenced off the reverse primer are flipped, not dropped', () => {
  const reads = [
    { name: 'F1', sequence: TEMPLATE.slice(0, 300) },
    { name: 'R1', sequence: revComp(TEMPLATE.slice(220, 520)) },
    { name: 'F2', sequence: TEMPLATE.slice(440, 740) },
    { name: 'R2', sequence: revComp(TEMPLATE.slice(660, 900)) },
  ];
  const { contigs } = assembleReads(reads);
  assert.equal(contigs.length, 1);
  assert.equal(contigs[0].consensus, TEMPLATE);
  assert.equal(contigs[0].reads.filter(r => r.flipped).length, 2);
});

test('a lone read error is outvoted, and recorded rather than hidden', () => {
  // Three reads cover position 250. One of them miscalls it.
  const bad = TEMPLATE.slice(100, 400).split('');
  bad[150] = bad[150] === 'A' ? 'C' : 'A';       // template position 250
  const reads = [
    { name: 'A', sequence: TEMPLATE.slice(0, 300) },
    { name: 'B', sequence: bad.join('') },
    { name: 'C', sequence: TEMPLATE.slice(200, 500) },
    { name: 'D', sequence: TEMPLATE.slice(400, 700) },
    { name: 'E', sequence: TEMPLATE.slice(620, 900) },
  ];
  const { contigs } = assembleReads(reads);
  assert.equal(contigs.length, 1);
  assert.equal(contigs[0].consensus, TEMPLATE);

  const d = contigs[0].disagreements.find(x => x.position === 251);
  assert.ok(d, 'the miscall is reported');
  assert.equal(d.called, TEMPLATE[250]);
  assert.equal(d.votes[TEMPLATE[250]], 2);
  assert.equal(d.contested, false, 'two against one is a read error, not a real conflict');
});

test('an even split is flagged as contested', () => {
  const a = TEMPLATE.slice(0, 300);
  const b = TEMPLATE.slice(100, 400).split('');
  b[50] = b[50] === 'A' ? 'C' : 'A';             // template position 150, one of two reads
  const { contigs } = assembleReads([
    { name: 'A', sequence: a },
    { name: 'B', sequence: b.join('') },
  ]);
  const d = contigs[0].disagreements.find(x => x.position === 151);
  assert.ok(d);
  assert.equal(d.contested, true, 'one against one needs a person');
});

test('coverage is reported, and the ends where only one read reaches', () => {
  const { contigs } = assembleReads([
    { name: 'A', sequence: TEMPLATE.slice(0, 300) },
    { name: 'B', sequence: TEMPLATE.slice(220, 520) },
  ]);
  const c = contigs[0];
  assert.equal(c.coverage.length, c.consensus.length);
  assert.equal(Math.max(...c.coverage), 2);
  // 0-219 and 300-519 have one read each: 220 + 220.
  assert.equal(c.singleCoverage, 440);
  assert.equal(c.coverage[250], 2);
});

test('reads that share nothing stay separate contigs', () => {
  const other = makeSeq(400, 99);
  const { contigs } = assembleReads([
    { name: 'A', sequence: TEMPLATE.slice(0, 300) },
    { name: 'B', sequence: TEMPLATE.slice(220, 520) },
    { name: 'X', sequence: other },
  ]);
  assert.equal(contigs.length, 2);
  assert.equal(contigs[0].consensus.length, 520);
  assert.equal(contigs[1].consensus, other);
});

test('a read too short to overlap anything is reported as unplaced', () => {
  const { contigs, unplaced } = assembleReads([
    { name: 'A', sequence: TEMPLATE.slice(0, 300) },
    { name: 'B', sequence: TEMPLATE.slice(220, 520) },
    { name: 'tiny', sequence: 'ACGTACGT' },
  ]);
  assert.equal(contigs.length, 1);
  assert.deepEqual(unplaced, ['tiny']);
});

test('quality trimming happens before assembly, so bad ends do not block a join', () => {
  // Two reads overlapping by 60 bp, but each carries 40 bp of garbage at the
  // ends. Untrimmed, the garbage sits inside the overlap and breaks it.
  const junk = 'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN';
  const a = junk + TEMPLATE.slice(0, 300) + junk;
  const b = junk + TEMPLATE.slice(240, 540) + junk;
  const qual = (s: string) => s.split('').map((c) => (c === 'N' ? 5 : 50));

  const { contigs } = assembleReads([
    { name: 'A', sequence: a, quality: qual(a) },
    { name: 'B', sequence: b, quality: qual(b) },
  ]);
  assert.equal(contigs.length, 1);
  assert.equal(contigs[0].consensus, TEMPLATE.slice(0, 540));
});

test('untrimmed ends do not stop reads joining', () => {
  // The case the browser exposed. A read that has not been quality-trimmed
  // carries miscalled A/C/G/T at both ends — not N, so nothing but a quality
  // score identifies them. A strict suffix-against-prefix overlap test finds
  // nothing, and four reads tiling a plasmid come back as four contigs.
  const junk = (n: number, seed: number) => makeSeq(n, 900 + seed);
  const reads = [
    { name: 'A', sequence: junk(18, 1) + TEMPLATE.slice(0, 400) + junk(25, 2) },
    { name: 'B', sequence: junk(18, 3) + TEMPLATE.slice(300, 700) + junk(25, 4) },
    { name: 'C', sequence: junk(18, 5) + TEMPLATE.slice(600, 900) + junk(25, 6) },
  ];
  const { contigs } = assembleReads(reads);
  assert.equal(contigs.length, 1, 'all three reads belong to one contig');
  assert.equal(contigs[0].reads.length, 3);
});

test('a reversed read with untrimmed ends still joins', () => {
  const junk = (n: number, seed: number) => makeSeq(n, 950 + seed);
  const { contigs } = assembleReads([
    { name: 'F', sequence: junk(18, 1) + TEMPLATE.slice(0, 400) + junk(25, 2) },
    { name: 'R', sequence: revComp(junk(18, 3) + TEMPLATE.slice(300, 700) + junk(25, 4)) },
  ]);
  assert.equal(contigs.length, 1);
  assert.equal(contigs[0].reads.filter(r => r.flipped).length, 1);
});

test('reads sharing only a short stretch in the middle are not joined', () => {
  // The guard on the dovetail: two unrelated reads that happen to share a
  // patch in their interiors are not overlapping reads, and joining them
  // would build a chimera.
  const a = makeSeq(400, 71);
  const b = makeSeq(400, 72);
  const shared = TEMPLATE.slice(0, 60);
  const { contigs } = assembleReads([
    { name: 'x', sequence: a.slice(0, 170) + shared + a.slice(230) },
    { name: 'y', sequence: b.slice(0, 170) + shared + b.slice(230) },
  ]);
  assert.equal(contigs.length, 2, 'a shared patch buried in both interiors is not a join');
});

test('disagreements record how far they sit from the nearest read end', () => {
  const reads = [
    { name: 'A', sequence: TEMPLATE.slice(0, 400) },
    { name: 'B', sequence: (() => {
      const s = TEMPLATE.slice(200, 600).split('');
      s[100] = s[100] === 'A' ? 'C' : 'A';   // template 300: deep inside both reads
      return s.join('');
    })() },
  ];
  const c = assembleReads(reads).contigs[0];
  const d = c.disagreements.find(x => x.position === 301);
  assert.ok(d, 'the planted mismatch is reported');
  assert.ok(d.fromReadEnd >= END_ZONE, `sits ${d.fromReadEnd} from a read end`);
  assert.equal(c.interiorConflicts.some(x => x.position === 301), true);
});

test('a conflict inside a read end zone is counted separately from an interior one', () => {
  const a = TEMPLATE.slice(0, 400);
  const b = TEMPLATE.slice(200, 600).split('');
  b[5] = b[5] === 'A' ? 'C' : 'A';           // 5 bases into read B
  const c = assembleReads([
    { name: 'A', sequence: a },
    { name: 'B', sequence: b.join('') },
  ]).contigs[0];

  assert.equal(c.endZoneConflicts, 1);
  assert.equal(c.interiorConflicts.length, 0,
    'a disagreement 5 bases into a read is end-of-run noise, not evidence');
});
