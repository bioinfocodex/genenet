import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbl, isEmbl } from '../src/lib/formats/embl.ts';
import { parseFastq, isFastq, detectEncoding } from '../src/lib/formats/fastq.ts';
import { parseAb1, isAb1, readDirectory } from '../src/lib/formats/ab1.ts';
import { parseGff, parseGffFile, isGff } from '../src/lib/formats/gff.ts';
import { identifyUnsupported } from '../src/lib/formats/proprietary.ts';
import { writeSnapGene, snapGeneFilename } from '../src/lib/formats/snapgene-write.ts';
import { parseSnapGene, isSnapGene } from '../src/lib/snapgene.ts';
import { parseSequenceText, detectFormat, parseGenBankFile } from '../src/lib/sequence-import.ts';
import { makeSeq } from './support/sequences.ts';

// ─── EMBL ────────────────────────────────────────────────────────────────────

const EMBL = `ID   X56734; SV 1; circular; mRNA; STD; PLN; 60 BP.
XX
AC   X56734;
XX
DE   Trifolium repens mRNA for
DE   non-cyanogenic beta-glucosidase
XX
FH   Key             Location/Qualifiers
FH
FT   source          1..60
FT                   /organism="Trifolium repens"
FT   CDS             complement(4..30)
FT                   /product="beta-glucosidase"
FT   misc_feature    join(1..10,41..60)
FT                   /label="split thing"
XX
SQ   Sequence 60 BP; 20 A; 10 C; 15 G; 15 T; 0 other;
     aaacaaacca aatatggatt ttattgtagc catatttgct ctgtttgtta ttagctcatt        60
//
`;

test('an EMBL file is recognised and a GenBank file is not', () => {
  assert.equal(isEmbl(EMBL), true);
  assert.equal(isEmbl('LOCUS  X 60 bp\nORIGIN\n  1 acgt\n//\n'), false);
  assert.equal(detectFormat(EMBL), 'embl');
});

test('EMBL: identifier, topology and sequence', () => {
  const r = parseEmbl(EMBL)!;
  assert.equal(r.name, 'X56734');
  assert.equal(r.circular, true);
  assert.equal(r.sequence.length, 60);
  assert.equal(r.sequence.slice(0, 10), 'AAACAAACCA');
  // The running position on the right must not end up in the sequence.
  assert.ok(!/\d/.test(r.sequence));
  assert.equal(r.format, 'embl');
});

test('EMBL: a wrapped description joins with a space, not run together', () => {
  const r = parseEmbl(EMBL)!;
  assert.match(r.description, /mRNA for non-cyanogenic/);
});

test('EMBL: features, strands and joins', () => {
  const r = parseEmbl(EMBL)!;
  assert.equal(r.features.length, 3);

  const cds = r.features.find(f => f.type === 'CDS')!;
  assert.equal(cds.name, 'beta-glucosidase');
  assert.equal(cds.strand, '-');
  // 1-based inclusive in the file, 0-based inclusive here.
  assert.equal(cds.start, 3);
  assert.equal(cds.end, 29);

  const split = r.features.find(f => f.type === 'misc_feature')!;
  assert.equal(split.name, 'split thing');
  assert.deepEqual(split.segments, [{ start: 0, end: 9 }, { start: 40, end: 59 }]);
});

test('EMBL and GenBank agree on the same feature coordinates', () => {
  // The two formats share the INSDC location grammar; if these disagree, one
  // of the parsers has drifted.
  const gb = `LOCUS       X56734  60 bp    DNA     circular
FEATURES             Location/Qualifiers
     CDS             complement(4..30)
                     /product="beta-glucosidase"
ORIGIN
        1 aaacaaacca aatatggatt ttattgtagc catatttgct ctgtttgtta ttagctcatt
//
`;
  const a = parseEmbl(EMBL)!.features.find(f => f.type === 'CDS')!;
  const b = parseGenBankFile(gb)!.features.find(f => f.type === 'CDS')!;
  assert.equal(a.start, b.start);
  assert.equal(a.end, b.end);
  assert.equal(a.strand, b.strand);
});

// ─── ApE colours ─────────────────────────────────────────────────────────────

test('ApE colours survive a GenBank import', () => {
  const ape = `LOCUS       pTest  40 bp ds-DNA  circular
FEATURES             Location/Qualifiers
     misc_feature    1..20
                     /label=promoter bit
                     /ApEinfo_fwdcolor=#FF7F50
                     /ApEinfo_revcolor=#00FF00
ORIGIN
        1 acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt
//
`;
  const r = parseGenBankFile(ape)!;
  assert.equal(r.features.length, 1);
  assert.equal(r.features[0].color, '#ff7f50');
  assert.equal(r.features[0].name, 'promoter bit');
});

test('a GenBank file with no colour qualifier reports none rather than a default', () => {
  const gb = `LOCUS       pTest  20 bp
FEATURES             Location/Qualifiers
     CDS             1..9
                     /gene="x"
ORIGIN
        1 acgtacgtac gtacgtacgt
//
`;
  assert.equal(parseGenBankFile(gb)!.features[0].color, undefined);
});

// ─── FASTQ ───────────────────────────────────────────────────────────────────

const FASTQ = [
  '@read1 first read',
  'ACGTACGTAC',
  '+',
  'IIIIIIIIII',
  '@read2',
  'TTTTGGGGCC',
  '+',
  '!!!!!!!!!!',
  '',
].join('\n');

test('FASTQ is told apart from FASTA', () => {
  assert.equal(isFastq(FASTQ), true);
  assert.equal(isFastq('>read1\nACGT\n'), false);
});

test('FASTQ reads carry their Phred scores', () => {
  const f = parseFastq(FASTQ);
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads[0].name, 'read1');
  assert.equal(f.reads[0].description, 'first read');
  assert.equal(f.reads[0].sequence, 'ACGTACGTAC');
  // 'I' is 73; 73 - 33 = 40, the usual "as good as it gets" score.
  assert.deepEqual(f.reads[0].quality, new Array(10).fill(40));
  // '!' is 33, the lowest possible.
  assert.deepEqual(f.reads[1].quality, new Array(10).fill(0));
});

test('a quality line starting with @ is not mistaken for the next record', () => {
  // '@' is Phred 31 under Phred+33 and appears constantly in real files.
  const tricky = ['@r1', 'ACGT', '+', '@@@@', '@r2', 'TTTT', '+', 'IIII', ''].join('\n');
  const f = parseFastq(tricky);
  assert.equal(f.reads.length, 2, 'the @@@@ quality line must not end the record');
  assert.deepEqual(f.reads[0].quality, [31, 31, 31, 31]);
  assert.equal(f.reads[1].name, 'r2');
});

test('encoding is detected, and the ambiguous case is flagged as such', () => {
  // '!' is 33: can only be Phred+33.
  assert.deepEqual(detectEncoding(['!!!!']), { encoding: 'phred33', certain: true });
  // 'h' is 104, with nothing below 64: Phred+64.
  assert.deepEqual(detectEncoding(['hhhh']), { encoding: 'phred64', certain: true });
  // The overlapping band fits both; assume the modern one but say it is a guess.
  assert.deepEqual(detectEncoding(['FFFF']), { encoding: 'phred33', certain: false });
});

test('forcing an encoding overrides detection', () => {
  const f = parseFastq(FASTQ, 'phred64');
  assert.equal(f.encoding, 'phred64');
  assert.equal(f.reads[0].quality[0], 73 - 64);
});

test('a record whose quality does not match its sequence is skipped and reported', () => {
  const bad = ['@r1', 'ACGTACGT', '+', 'III', '@r2', 'ACGT', '+', 'IIII', ''].join('\n');
  const f = parseFastq(bad);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].name, 'r2');
  assert.equal(f.problems.length, 1);
  assert.match(f.problems[0], /8 bases but 3 quality scores/);
});

// ─── AB1 ─────────────────────────────────────────────────────────────────────

/** Build a minimal but structurally real ABIF file. */
function makeAb1(bases: string, quality: number[], sample = 'probe'): Uint8Array {
  const entries: { tag: string; number: number; type: number; size: number; data: Uint8Array }[] = [];
  const enc = (s: string) => new TextEncoder().encode(s);

  entries.push({ tag: 'PBAS', number: 1, type: 2, size: 1, data: enc(bases) });
  entries.push({ tag: 'PCON', number: 1, type: 2, size: 1, data: Uint8Array.from(quality) });
  // A pString: leading length byte.
  const smpl = new Uint8Array(1 + sample.length);
  smpl[0] = sample.length;
  smpl.set(enc(sample), 1);
  entries.push({ tag: 'SMPL', number: 1, type: 18, size: 1, data: smpl });
  entries.push({ tag: 'FWO_', number: 1, type: 2, size: 1, data: enc('GATC') });

  const headerLen = 128;
  const dirOffset = headerLen;
  const dirLen = entries.length * 28;
  let dataAt = dirOffset + dirLen;

  const payloads: Uint8Array[] = [];
  const offsets: number[] = [];
  for (const e of entries) {
    if (e.data.length <= 4) { offsets.push(-1); continue; }  // inline
    offsets.push(dataAt);
    payloads.push(e.data);
    dataAt += e.data.length;
  }

  const out = new Uint8Array(dataAt);
  const view = new DataView(out.buffer);
  out.set(enc('ABIF'), 0);
  view.setUint16(4, 101, false);

  // The directory-of-the-directory entry at offset 26.
  out.set(enc('tdir'), 26);
  view.setInt32(26 + 4, 1, false);
  view.setUint16(26 + 8, 1023, false);
  view.setUint16(26 + 10, 28, false);
  view.setInt32(26 + 12, entries.length, false);
  view.setInt32(26 + 16, dirLen, false);
  view.setInt32(26 + 20, dirOffset, false);

  entries.forEach((e, i) => {
    const at = dirOffset + i * 28;
    out.set(enc(e.tag), at);
    view.setInt32(at + 4, e.number, false);
    view.setUint16(at + 8, e.type, false);
    view.setUint16(at + 10, e.size, false);
    view.setInt32(at + 12, e.data.length / e.size, false);
    view.setInt32(at + 16, e.data.length, false);
    if (offsets[i] === -1) out.set(e.data, at + 20);      // inline payload
    else view.setInt32(at + 20, offsets[i], false);
  });

  let p = dirOffset + dirLen;
  for (const payload of payloads) { out.set(payload, p); p += payload.length; }
  return out;
}

test('an ABIF file is recognised by its magic', () => {
  const f = makeAb1('ACGTACGT', [40, 40, 35, 30, 20, 15, 10, 5]);
  assert.equal(isAb1(f), true);
  assert.equal(isAb1(new Uint8Array([1, 2, 3, 4, 5])), false);
  assert.equal(isAb1(new TextEncoder().encode('>fasta\nACGT')), false);
});

test('the ABIF directory lists the tags present', () => {
  const dir = readDirectory(makeAb1('ACGT', [40, 40, 40, 40]));
  assert.deepEqual(dir.map(e => e.tag).sort(), ['FWO_', 'PBAS', 'PCON', 'SMPL']);
});

test('AB1 basecalls and per-base quality come back together', () => {
  const bases = 'ACGTACGTACGTACGT';
  const qual = bases.split('').map((_, i) => 40 - i * 2);
  const t = parseAb1(makeAb1(bases, qual, 'M13F-plate3'))!;
  assert.equal(t.sequence, bases);
  assert.deepEqual(t.quality, qual);
  assert.equal(t.sampleName, 'M13F-plate3');
  assert.equal(t.baseOrder, 'GATC');
});

test('a short payload stored inline is read from the offset field, not followed', () => {
  // FWO_ is exactly 4 bytes, so it lives in the offset field. Following it as
  // a pointer would land somewhere arbitrary and return rubbish.
  const t = parseAb1(makeAb1('ACGT', [40, 40, 40, 40]))!;
  assert.equal(t.baseOrder, 'GATC');
});

test('quality that does not line up with the bases is dropped, not misapplied', () => {
  // Trimming with a misaligned quality array would cut the wrong end.
  const f = makeAb1('ACGTACGT', [40, 40, 40]);
  const t = parseAb1(f)!;
  assert.equal(t.sequence, 'ACGTACGT');
  assert.deepEqual(t.quality, []);
});

test('an AB1 read feeds the contig assembler with real trimming', async () => {
  const { trimRead } = await import('../src/lib/contig.ts');
  const good = 'ACGTACGTACGTACGTACGTACGTACGTACGTACGT';
  const bases = 'NNNNNNNNNNNNNNN' + good + 'NNNNNNNNNNNNNNN';
  const qual = bases.split('').map(b => (b === 'N' ? 4 : 50));
  const t = parseAb1(makeAb1(bases, qual))!;

  const trimmed = trimRead({ name: t.sampleName || 'read', sequence: t.sequence, quality: t.quality });
  assert.equal(trimmed.sequence, good, 'the quality scores drove the trim');
});

// ─── GFF3 ────────────────────────────────────────────────────────────────────

const GFF = [
  '##gff-version 3',
  'chr1\tGeneNet\tgene\t1\t20\t.\t+\t.\tID=g1;Name=abcD',
  'chr1\tGeneNet\tCDS\t1\t5\t.\t+\t0\tParent=cds1;Name=abcD CDS',
  'chr1\tGeneNet\tCDS\t11\t20\t.\t+\t0\tParent=cds1;Name=abcD CDS',
  'chr1\tGeneNet\tpromoter\t25\t30\t.\t-\t.\tName=P%20one',
  '##FASTA',
  '>chr1',
  'ACGTACGTACGTACGTACGTACGTACGTACGTACGT',
  '',
].join('\n');

test('GFF3 is recognised with and without the version directive', () => {
  assert.equal(isGff(GFF), true);
  assert.equal(isGff('chr1\tx\tgene\t1\t20\t.\t+\t.\tID=g1'), true);
  assert.equal(isGff('>fasta\nACGT'), false);
  assert.equal(detectFormat(GFF), 'gff');
});

test('GFF coordinates convert from 1-based inclusive to 0-based inclusive', () => {
  const { features } = parseGff(GFF);
  const gene = features.find(f => f.type === 'gene')!;
  assert.equal(gene.start, 0);
  assert.equal(gene.end, 19, 'both ends shift, not just the start');
});

test('GFF rows sharing a Parent become one spliced feature', () => {
  const { features } = parseGff(GFF);
  const cds = features.find(f => f.type === 'CDS')!;
  assert.deepEqual(cds.segments, [{ start: 0, end: 4 }, { start: 10, end: 19 }]);
  assert.equal(cds.start, 0);
  assert.equal(cds.end, 19);
});

test('a minus-strand GFF feature still lists its lower coordinate as start', () => {
  const { features } = parseGff(GFF);
  const p = features.find(f => f.type === 'promoter')!;
  assert.equal(p.strand, '-');
  assert.equal(p.start, 24);
  assert.equal(p.end, 29);
  assert.ok(p.start < p.end);
});

test('GFF attribute values are percent-decoded', () => {
  const { features } = parseGff(GFF);
  assert.equal(features.find(f => f.type === 'promoter')!.name, 'P one');
});

test('an embedded ##FASTA block becomes the sequence', () => {
  const r = parseGffFile(GFF)!;
  assert.equal(r.name, 'chr1');
  assert.equal(r.sequence, 'ACGTACGTACGTACGTACGTACGTACGTACGTACGT');
  assert.equal(r.features.length, 3);
});

test('a GFF with no sequence is not passed off as one', () => {
  const noSeq = '##gff-version 3\nchr1\tx\tgene\t1\t20\t.\t+\t.\tID=g1\n';
  assert.equal(parseGffFile(noSeq), null);
  // But the features are still readable for laying onto an existing sequence.
  assert.equal(parseGff(noSeq).features.length, 1);
});

test('a malformed GFF row is reported rather than silently dropped', () => {
  const bad = '##gff-version 3\nchr1\tx\tgene\tnotanumber\t20\t.\t+\t.\tID=g1\n';
  const { features, problems } = parseGff(bad);
  assert.equal(features.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not a usable range/);
});

// ─── Proprietary binaries ────────────────────────────────────────────────────

test('an OLE compound document is named as Vector NTI with a way forward', () => {
  const ole = new Uint8Array(16);
  ole.set([0xd0, 0xcf, 0x11, 0xe0], 0);
  const r = identifyUnsupported(ole, 'plasmid.ma4')!;
  assert.match(r.format, /Vector NTI/);
  assert.match(r.advice, /Export/);
});

test('proprietary detection is conservative about ordinary files', () => {
  assert.equal(identifyUnsupported(new TextEncoder().encode('>x\nACGT'), 'x.fa'), null);
  assert.equal(identifyUnsupported(new TextEncoder().encode('LOCUS x\n'), 'x.gb'), null);
});

test('extensions alone are enough to recognise the closed formats', () => {
  const junk = new Uint8Array(64);
  assert.match(identifyUnsupported(junk, 'a.cm5')!.format, /Clone Manager/);
  assert.match(identifyUnsupported(junk, 'a.sbd')!.format, /DNAStar/);
  assert.match(identifyUnsupported(junk, 'a.geneious')!.format, /Geneious/);
});

// ─── SnapGene writing (G-46) ─────────────────────────────────────────────────

test('a written .dna is recognised by the reader that reads real ones', () => {
  const seq = makeSeq(300, 5);
  const dna = writeSnapGene({ name: 'pProbe', sequence: seq, circular: true });
  assert.equal(isSnapGene(dna), true);
});

test('sequence and topology round-trip through write and read', () => {
  const seq = makeSeq(500, 11);
  for (const circular of [true, false]) {
    const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, circular }))!;
    assert.equal(back.sequence, seq, `circular=${circular}`);
    assert.equal(back.circular, circular);
  }
});

test('features round-trip with their coordinates and strand intact', () => {
  const seq = makeSeq(400, 21);
  const features = [
    { name: 'promoter', type: 'promoter', start: 10, end: 49, strand: '+' as const },
    { name: 'my CDS', type: 'CDS', start: 60, end: 199, strand: '-' as const },
    { name: 'last base', type: 'misc_feature', start: 399, end: 399, strand: '+' as const },
  ];
  const back = parseSnapGene(writeSnapGene({ name: 'p', sequence: seq, features }))!;

  assert.equal(back.features.length, 3);
  for (const original of features) {
    const got = back.features.find(f => f.name === original.name)!;
    assert.ok(got, original.name);
    assert.equal(got.start, original.start, `${original.name} start`);
    // The end is where the off-by-one lives: shifting only the start loses the
    // last base of every feature.
    assert.equal(got.end, original.end, `${original.name} end`);
    assert.equal(got.strand, original.strand, `${original.name} strand`);
  }
});

test('a spliced feature round-trips as segments', () => {
  const seq = makeSeq(300, 31);
  const back = parseSnapGene(writeSnapGene({
    name: 'p', sequence: seq,
    features: [{
      name: 'spliced', type: 'CDS', start: 10, end: 199, strand: '+',
      segments: [{ start: 10, end: 49 }, { start: 150, end: 199 }],
    }],
  }))!;
  const f = back.features.find(x => x.name === 'spliced')!;
  assert.equal(f.start, 10);
  assert.equal(f.end, 199);
});

test('a feature name with XML metacharacters does not break the file', () => {
  const seq = makeSeq(120, 41);
  const name = `5' UTR & "control" <tag>`;
  const back = parseSnapGene(writeSnapGene({
    name: 'p', sequence: seq,
    features: [{ name, type: 'misc_feature', start: 0, end: 20, strand: '+' }],
  }))!;
  assert.equal(back.features.length, 1);
  assert.equal(back.features[0].name, name, 'the escaping round-trips exactly');
});

test('a feature running past the end of the sequence is clamped, not written wrong', () => {
  const seq = makeSeq(100, 51);
  const back = parseSnapGene(writeSnapGene({
    name: 'p', sequence: seq,
    features: [{ name: 'over', type: 'misc_feature', start: 90, end: 500, strand: '+' }],
  }))!;
  assert.equal(back.features[0].end, 99);
});

test('writing refuses an empty sequence rather than producing a broken file', () => {
  assert.throws(() => writeSnapGene({ name: 'p', sequence: '' }), /no sequence/);
  assert.throws(() => writeSnapGene({ name: 'p', sequence: '   \n ' }), /no sequence/);
});

test('the filename is safe to hand to another operating system', () => {
  assert.equal(snapGeneFilename('pUC19-GFP'), 'pUC19-GFP.dna');
  assert.equal(snapGeneFilename('my plasmid (v2)/final'), 'my_plasmid_v2_final.dna');
  assert.equal(snapGeneFilename('   '), 'sequence.dna');
});

// ─── Dispatcher ──────────────────────────────────────────────────────────────

test('the dispatcher routes each text format to its own reader', () => {
  assert.equal(parseSequenceText(EMBL)!.format, 'embl');
  assert.equal(parseSequenceText(GFF)!.format, 'gff');
  assert.equal(parseSequenceText('>x desc\nACGTACGT\n')!.format, 'fasta');
  assert.equal(parseSequenceText('ACGTACGTACGTACGT')!.format, 'plain');
  assert.equal(
    parseSequenceText('LOCUS x 8 bp\nORIGIN\n 1 acgtacgt\n//\n')!.format,
    'genbank',
  );
});

test('an EMBL file is not mistaken for a bare sequence', () => {
  // The old detector would have called this "plain" and returned the line
  // codes as bases.
  assert.notEqual(detectFormat(EMBL), 'plain');
});
