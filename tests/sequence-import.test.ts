import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFormat, parseLocation, parseGenBankFile, parseFastaFile,
  parseSequenceText, countFastaRecords,
} from '../src/lib/sequence-import.ts';
import { isSnapGene, parseSnapGene } from '../src/lib/snapgene.ts';

/**
 * Reading files people actually have.
 *
 * The failures here are quiet ones: a feature dropped because its location used
 * join(), a plasmid imported as linear, a reverse-strand annotation that comes
 * back forward. Nothing errors -- the map is just wrong, and it is wrong in a
 * way you only notice after designing a cloning strategy against it.
 */

// A GenBank record with the location forms real NCBI files contain.
const GENBANK = `LOCUS       pTEST                   80 bp    DNA     circular SYN 01-JAN-2026
DEFINITION  A test plasmid with
            a wrapped definition.
ACCESSION   pTEST
FEATURES             Location/Qualifiers
     source          1..80
                     /organism="synthetic construct"
     CDS             complement(10..30)
                     /gene="bla"
                     /product="beta-lactamase"
     CDS             join(40..50,60..70)
                     /gene="spliced"
     misc_feature    <1..15
                     /label="runs off the start"
     primer_bind     complement(join(71..75,76..80))
                     /label="wrapped primer"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc
       61 atgcatgcat gcatgcatgc
//
`;

describe('format detection', () => {
  test('recognises GenBank by its LOCUS line', () => {
    assert.equal(detectFormat(GENBANK), 'genbank');
  });

  test('recognises FASTA by its header', () => {
    assert.equal(detectFormat('>seq\nATGC'), 'fasta');
  });

  test('recognises a bare sequence as plain', () => {
    // Someone pastes what they copied out of a spreadsheet.
    assert.equal(detectFormat('ATGCATGCATGC'), 'plain');
    assert.equal(detectFormat('atgc atgc\natgc'), 'plain');
  });

  test('refuses things that are not sequence', () => {
    assert.equal(detectFormat(''), null);
    assert.equal(detectFormat('Dear Sarah, please find attached'), null);
  });
});

describe('GenBank locations', () => {
  test('a plain range is 0-based inclusive', () => {
    const l = parseLocation('10..30');
    assert.deepEqual(l?.segments, [{ start: 9, end: 29 }]);
    assert.equal(l?.strand, '+');
  });

  test('complement() reads on the reverse strand', () => {
    const l = parseLocation('complement(10..30)');
    assert.equal(l?.strand, '-');
    assert.deepEqual(l?.segments, [{ start: 9, end: 29 }]);
  });

  test('join() keeps every segment', () => {
    const l = parseLocation('join(40..50,60..70)');
    assert.equal(l?.segments.length, 2);
    assert.deepEqual(l?.segments, [{ start: 39, end: 49 }, { start: 59, end: 69 }]);
  });

  test('complement(join()) is reverse strand with both segments', () => {
    const l = parseLocation('complement(join(40..50,60..70))');
    assert.equal(l?.strand, '-');
    assert.equal(l?.segments.length, 2);
  });

  test('a complement inside a join is still reverse strand', () => {
    const l = parseLocation('join(complement(40..50),complement(60..70))');
    assert.equal(l?.strand, '-');
    assert.equal(l?.segments.length, 2);
  });

  test('< and > mark the extent as uncertain without breaking it', () => {
    const a = parseLocation('<1..500');
    assert.equal(a?.partial, true);
    assert.deepEqual(a?.segments, [{ start: 0, end: 499 }]);
    const b = parseLocation('1..>500');
    assert.equal(b?.partial, true);
    const c = parseLocation('complement(<1..500)');
    assert.equal(c?.partial, true);
    assert.equal(c?.strand, '-');
  });

  test('order() is treated like join()', () => {
    assert.equal(parseLocation('order(1..10,20..30)')?.segments.length, 2);
  });

  test('a single base and the between-bases form both parse', () => {
    assert.deepEqual(parseLocation('42')?.segments, [{ start: 41, end: 41 }]);
    assert.deepEqual(parseLocation('1^2')?.segments, [{ start: 0, end: 1 }]);
  });

  test('nonsense returns null rather than a wrong answer', () => {
    assert.equal(parseLocation(''), null);
    assert.equal(parseLocation('somewhere in the middle'), null);
  });
});

describe('GenBank files', () => {
  const gb = parseGenBankFile(GENBANK)!;

  test('reads the sequence', () => {
    assert.equal(gb.sequence.length, 80);
    assert.ok(gb.sequence.startsWith('ATGCATGCAT'));
    assert.ok(!/\d|\s/.test(gb.sequence), 'coordinates must not end up in the sequence');
  });

  test('reads the name and a wrapped definition', () => {
    assert.equal(gb.name, 'pTEST');
    assert.equal(gb.description, 'A test plasmid with a wrapped definition.');
  });

  test('a circular plasmid is not imported as linear', () => {
    // Importing a plasmid as linear breaks every downstream digest.
    assert.equal(gb.circular, true);
  });

  test('keeps all five features', () => {
    assert.equal(gb.features.length, 5, gb.features.map(f => f.name).join(', '));
  });

  test('names features from their qualifiers, not their type', () => {
    const names = gb.features.map(f => f.name);
    assert.ok(names.includes('bla'), `expected gene name, got ${names.join(', ')}`);
    assert.ok(names.includes('runs off the start'), 'expected /label to be used');
  });

  test('a complement feature comes back on the reverse strand', () => {
    const bla = gb.features.find(f => f.name === 'bla')!;
    assert.equal(bla.strand, '-');
    assert.equal(bla.start, 9);
    assert.equal(bla.end, 29);
  });

  test('a spliced feature keeps its segments', () => {
    const spliced = gb.features.find(f => f.name === 'spliced')!;
    assert.equal(spliced.segments?.length, 2);
    assert.equal(spliced.start, 39, 'span should start at the first segment');
    assert.equal(spliced.end, 69, 'and end at the last');
  });

  test('a partial feature is flagged', () => {
    const partial = gb.features.find(f => f.name === 'runs off the start')!;
    assert.equal(partial.partial, true);
  });

  test('non-GenBank input returns null', () => {
    assert.equal(parseGenBankFile('>not genbank\nATGC'), null);
  });
});

describe('FASTA and pasted sequence', () => {
  test('reads a header, name and description', () => {
    const f = parseFastaFile('>pUC19 cloning vector\nATGC\nGGTT')!;
    assert.equal(f.name, 'pUC19');
    assert.equal(f.description, 'cloning vector');
    assert.equal(f.sequence, 'ATGCGGTT');
  });

  test('a bare sequence with no header now works', () => {
    // This was the gap found while writing the tests in b287fe1: sequence
    // import handed pasted text straight to a parser that required a ">".
    const f = parseFastaFile('atgcatgc')!;
    assert.equal(f.sequence, 'ATGCATGC');
    assert.equal(f.format, 'plain');
  });

  test('digits and spaces from a numbered paste are stripped', () => {
    const f = parseFastaFile('   1 atgc atgc\n   9 ggtt')!;
    assert.equal(f.sequence, 'ATGCATGCGGTT');
  });

  test('only the first record of a multi-FASTA is taken', () => {
    const f = parseFastaFile('>a\nAAAA\n>b\nCCCC')!;
    assert.equal(f.sequence, 'AAAA');
    assert.equal(countFastaRecords('>a\nAAAA\n>b\nCCCC'), 2);
  });

  test('empty input returns null', () => {
    assert.equal(parseFastaFile(''), null);
    assert.equal(parseFastaFile('>only a header\n'), null);
  });
});

describe('the dispatcher', () => {
  test('routes each format to the right reader', () => {
    assert.equal(parseSequenceText(GENBANK)?.format, 'genbank');
    assert.equal(parseSequenceText('>x\nATGC')?.format, 'fasta');
    assert.equal(parseSequenceText('ATGCATGC')?.format, 'plain');
    assert.equal(parseSequenceText('hello there'), null);
  });
});

// ─── SnapGene ────────────────────────────────────────────────────────────────

/** Build a .dna file to the documented layout, to read back. */
function snapGeneFile(opts: { seq: string; circular: boolean; featuresXml?: string; notesXml?: string }): Uint8Array {
  const chunks: number[][] = [];
  const seg = (type: number, payload: number[]) => {
    const len = payload.length;
    chunks.push([type, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...payload]);
  };
  const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

  // Header: type 9, the "SnapGene" cookie plus version fields.
  seg(9, [...ascii('SnapGene'), 0, 1, 0, 1, 0, 1]);
  seg(0, [opts.circular ? 1 : 0, ...ascii(opts.seq)]);
  if (opts.featuresXml) seg(10, ascii(opts.featuresXml));
  if (opts.notesXml) seg(6, ascii(opts.notesXml));
  return Uint8Array.from(chunks.flat());
}

describe('SnapGene .dna', () => {
  const file = snapGeneFile({
    seq: 'atgcatgcatgcatgcatgc',
    circular: true,
    featuresXml:
      '<Features>' +
      '<Feature type="CDS" name="GFP" directionality="1"><Segment range="1-9"/></Feature>' +
      '<Feature type="promoter" name="T7 &amp; lac" directionality="2"><Segment range="12-18"/></Feature>' +
      '<Feature type="CDS" name="spliced"><Segment range="1-3"/><Segment range="15-20"/></Feature>' +
      '</Features>',
    notesXml: '<Notes><CustomMapLabel>pDEMO</CustomMapLabel><Description>A demo map</Description></Notes>',
  });

  test('recognises the file by its cookie', () => {
    assert.equal(isSnapGene(file), true);
    assert.equal(isSnapGene(Uint8Array.from([1, 2, 3])), false);
    assert.equal(isSnapGene(new TextEncoder().encode('>fasta\nATGC')), false);
  });

  test('reads the sequence and that it is circular', () => {
    const p = parseSnapGene(file)!;
    assert.equal(p.sequence, 'ATGCATGCATGCATGCATGC');
    assert.equal(p.circular, true);
    assert.equal(p.format, 'snapgene');
  });

  test('a linear file is not reported as circular', () => {
    const linear = snapGeneFile({ seq: 'atgc', circular: false });
    assert.equal(parseSnapGene(linear)?.circular, false);
  });

  test('reads features with names, types and coordinates', () => {
    const p = parseSnapGene(file)!;
    assert.equal(p.features.length, 3);
    const gfp = p.features.find(f => f.name === 'GFP')!;
    assert.equal(gfp.type, 'CDS');
    assert.equal(gfp.start, 0);
    assert.equal(gfp.end, 8);
    assert.equal(gfp.strand, '+');
  });

  test('directionality 2 is the reverse strand', () => {
    const p = parseSnapGene(file)!;
    const t7 = p.features.find(f => f.type === 'promoter')!;
    assert.equal(t7.strand, '-');
  });

  test('XML entities in a feature name are decoded', () => {
    const p = parseSnapGene(file)!;
    assert.ok(p.features.some(f => f.name === 'T7 & lac'),
      p.features.map(f => f.name).join(', '));
  });

  test('a multi-segment feature keeps its segments', () => {
    const p = parseSnapGene(file)!;
    const spliced = p.features.find(f => f.name === 'spliced')!;
    assert.equal(spliced.segments?.length, 2);
    assert.equal(spliced.start, 0);
    assert.equal(spliced.end, 19);
  });

  test('reads the map name and description from the notes', () => {
    const p = parseSnapGene(file)!;
    assert.equal(p.name, 'pDEMO');
    assert.equal(p.description, 'A demo map');
  });

  test('a truncated file returns what parsed rather than throwing', () => {
    const truncated = file.subarray(0, file.length - 12);
    assert.doesNotThrow(() => parseSnapGene(truncated));
  });

  test('a file that is not SnapGene returns null', () => {
    assert.equal(parseSnapGene(new TextEncoder().encode('LOCUS x')), null);
  });
});

// ─── Accession routing ───────────────────────────────────────────────────────

describe('accession routing', () => {
  test('RefSeq accessions go to NCBI, not UniProt', async () => {
    // NM_000546 matched the UniProt entry-name shape (letters, underscore,
    // more characters) and was sent to a database that has never heard of it.
    const { guessSource } = await import('../src/lib/accession.ts');
    assert.equal(guessSource('NM_000546'), 'ncbi-nucleotide');
    assert.equal(guessSource('NC_005816.1'), 'ncbi-nucleotide');
    assert.equal(guessSource('NP_000537'), 'ncbi-protein');
    assert.equal(guessSource('XP_011529773'), 'ncbi-protein');
  });

  test('UniProt accessions and entry names go to UniProt', async () => {
    const { guessSource } = await import('../src/lib/accession.ts');
    assert.equal(guessSource('P42212'), 'uniprot');
    assert.equal(guessSource('Q8N158'), 'uniprot');
    assert.equal(guessSource('GFP_AEQVI'), 'uniprot');
  });

  test('an unrecognised shape falls back to NCBI nucleotide', async () => {
    const { guessSource } = await import('../src/lib/accession.ts');
    assert.equal(guessSource('CP000819.1'), 'ncbi-nucleotide');
    assert.equal(guessSource('J01415'), 'ncbi-nucleotide');
  });
});
