import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSnapGene } from '../src/lib/snapgene.ts';
import { writeSnapGene, snapGeneDate, snapGeneFilename } from '../src/lib/formats/snapgene-write.ts';
import type { ImportedFeature } from '../src/lib/sequence-import.ts';

/**
 * Writing a file somebody else can open.
 *
 * The writer was tested by reading its own output back, which proves the two
 * halves of this codebase agree and says nothing about whether SnapGene --
 * the only reader that matters here -- will take the file. The round trip
 * below starts from a file SnapGene wrote, so a difference is a difference
 * from the real thing rather than from our idea of it.
 *
 * What that caught: every file this codebase produced carried an ISO date in
 * a field the format writes as 2025.12.15, and BioPython raised on it rather
 * than reading the file at all.
 *
 * The limit of this test, stated because it matters: it shows an independent
 * reader accepts the file and sees what SnapGene put there. It does not show
 * SnapGene itself opens it, which needs SnapGene.
 */

const FIXTURE = new URL('./fixtures/addgene-54622-trimmed.dna', import.meta.url);
const original = parseSnapGene(new Uint8Array(readFileSync(FIXTURE)), 'x')!;

const rewritten = () => parseSnapGene(writeSnapGene({
  name: original.name,
  description: original.description,
  sequence: original.sequence,
  circular: original.circular,
  features: original.features,
}), 'x')!;

const place = (f: ImportedFeature) => `${f.type}|${f.start}|${f.end}|${f.strand}|${f.name}`;

describe('a real plasmid, written back out', () => {
  const back = rewritten();

  test('not one base moved', () => {
    assert.equal(back.sequence, original.sequence);
  });

  test('a plasmid stays a plasmid', () => {
    assert.equal(back.circular, true);
    assert.equal(back.circular, original.circular);
  });

  test('the name and the description survive', () => {
    assert.equal(back.name, original.name);
    assert.equal(back.description, original.description);
  });

  test('every feature comes back where it was, pointing the same way', () => {
    assert.deepEqual(
      back.features.map(place).sort(),
      original.features.map(place).sort(),
    );
  });

  test("the lab's colours are written, not repainted from the type", () => {
    /*
     * Both of these are CDSs. Writing the palette colour for CDS would make
     * them the same shade and lose the distinction somebody made on purpose.
     */
    const green = back.features.find(f => f.name === 'mEGFP')!;
    assert.equal(green.color, '#05fd14');
    const araC = back.features.find(f => f.name === 'araC')!;
    assert.equal(araC.color, '#993366');
    assert.notEqual(green.color, araC.color);
  });

  test('a feature that never had a colour gets one from its type', () => {
    // Primer sites come from a packet that records no colour, and a feature
    // written without one would be invisible.
    const primer = back.features.find(f => f.type === 'primer_bind')!;
    assert.match(primer.color ?? '', /^#[0-9a-f]{6}$/i);
  });

  test('writing twice gives the same bytes', () => {
    // Apart from the date, which is today. Two exports of an unchanged
    // construct that differ are two exports somebody has to diff.
    const a = writeSnapGene({ name: 'p', sequence: 'ATGCATGC', circular: true });
    const b = writeSnapGene({ name: 'p', sequence: 'ATGCATGC', circular: true });
    assert.deepEqual(Array.from(a), Array.from(b));
  });
});

describe('the date field', () => {
  test('it is written the way this format writes dates', () => {
    /*
     * 2025.12.15, not 2025-12-15. BioPython parses this field with a fixed
     * format and raises on anything else, so an ISO date made the whole file
     * unreadable -- not the date, the file.
     */
    assert.equal(snapGeneDate(new Date(2025, 11, 15)), '2025.12.15');
  });

  test('single-digit months and days are padded', () => {
    assert.equal(snapGeneDate(new Date(2026, 0, 3)), '2026.01.03');
  });

  test('the date in a written file matches that shape', () => {
    const bytes = writeSnapGene({ name: 'p', sequence: 'ATGC' });
    const xml = new TextDecoder().decode(bytes);
    assert.match(xml, /<LastModified>\d{4}\.\d{2}\.\d{2}<\/LastModified>/);
    assert.ok(!/<LastModified>\d{4}-\d{2}-\d{2}/.test(xml), 'an ISO date is the bug');
  });

  test('the label is marked as one to show', () => {
    // SnapGene has a CustomMapLabel and a flag saying to use it. A label with
    // the flag unset is a name nobody sees.
    const xml = new TextDecoder().decode(writeSnapGene({ name: 'pDEMO', sequence: 'ATGC' }));
    assert.match(xml, /<CustomMapLabel>pDEMO<\/CustomMapLabel>/);
    assert.match(xml, /<UseCustomMapLabel>1<\/UseCustomMapLabel>/);
  });
});

describe('features at the edges of the molecule', () => {
  const seq = 'ATGC'.repeat(250);          // 1000 bases
  const feat = (over: Partial<ImportedFeature>): ImportedFeature =>
    ({ name: 'f', type: 'misc_feature', start: 10, end: 20, strand: '+', ...over });

  test('a feature through the origin survives being written', () => {
    /*
     * End before start is how a wrapping feature is written, here and in the
     * file. It used to be clamped to end >= start, which dropped it: it went
     * into the export and did not come out, and on a plasmid a feature across
     * base 1 is one somebody put there deliberately.
     */
    const across = feat({ name: 'across', start: 980, end: 19 });
    const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, circular: true, features: [across] }))!;
    assert.equal(back.features.length, 1);
    assert.equal(back.features[0].start, 980);
    assert.equal(back.features[0].end, 19);
  });

  test('a feature at the very first and very last base', () => {
    const ends = [feat({ name: 'first', start: 0, end: 0 }), feat({ name: 'last', start: 999, end: 999 })];
    const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, features: ends }))!;
    assert.deepEqual(back.features.map(f => [f.start, f.end]), [[0, 0], [999, 999]]);
  });

  test('a feature hanging off the end is trimmed, not thrown away', () => {
    // It still says something true about the molecule: that the region runs
    // to the end of it.
    const over = feat({ name: 'over', start: 990, end: 1200 });
    const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, features: [over] }))!;
    assert.equal(back.features.length, 1);
    assert.equal(back.features[0].end, 999);
  });

  test('a spliced feature keeps its exons', () => {
    const spliced = feat({ name: 'spliced', start: 100, end: 400, segments: [{ start: 100, end: 150 }, { start: 350, end: 400 }] });
    const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, features: [spliced] }))!;
    assert.deepEqual(back.features[0].segments, [{ start: 100, end: 150 }, { start: 350, end: 400 }]);
  });

  test('a reverse feature stays reverse', () => {
    const rev = feat({ name: 'rev', strand: '-' });
    const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, features: [rev] }))!;
    assert.equal(back.features[0].strand, '-');
  });
});

describe('names that would break the XML', () => {
  test('a feature called something with an ampersand in it', () => {
    const back = parseSnapGene(writeSnapGene({
      name: 'p', sequence: 'ATGCATGCATGC',
      features: [{ name: "5' UTR & <tag>", type: 'misc_feature', start: 0, end: 5, strand: '+' }],
    }))!;
    assert.equal(back.features[0].name, "5' UTR & <tag>");
  });

  test('a construct name with quotes in it', () => {
    const back = parseSnapGene(writeSnapGene({ name: 'the "good" one', sequence: 'ATGC' }))!;
    assert.equal(back.name, 'the "good" one');
  });
});

describe('the filename offered', () => {
  test('it ends in .dna', () => {
    assert.match(snapGeneFilename('pUC19'), /\.dna$/);
  });

  test('spaces and punctuation will not upset anybody’s filesystem', () => {
    assert.equal(snapGeneFilename('pBAD / mEGFP v2'), 'pBAD_mEGFP_v2.dna');
  });

  test('a construct with no usable name still gets a file', () => {
    assert.equal(snapGeneFilename('   '), 'sequence.dna');
    assert.equal(snapGeneFilename('///'), 'sequence.dna');
  });
});
