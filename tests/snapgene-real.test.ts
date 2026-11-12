import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSnapGene } from '../src/lib/snapgene.ts';
import type { ImportedFeature } from '../src/lib/sequence-import.ts';

/**
 * The reader against a file SnapGene actually wrote.
 *
 * Every other test here builds a .dna file and reads it back, which proves the
 * reader agrees with itself and nothing more. It passed while the reader got
 * every primer in every real plasmid wrong: one base to the left, pointing the
 * wrong way, and several times over. A file from the vendor is the only thing
 * that catches that.
 *
 * The fixture is Addgene plasmid 54622 (mEGFP-pBAD) as downloaded from Addgene,
 * with the history and alignment packets removed to keep it small. The packets
 * under test -- cookie, DNA, notes, features, primers -- are SnapGene's own
 * bytes, unaltered. The expected table below is BioPython's
 * `SeqIO.read(..., "snapgene")` on the same file, which is an independent
 * implementation of the same format and the closest thing to an authority
 * there is for it.
 */

const FIXTURE = new URL('./fixtures/addgene-54622-trimmed.dna', import.meta.url);
const bytes = new Uint8Array(readFileSync(FIXTURE));

/** type, 1-based inclusive start, 1-based inclusive end, strand, name. */
const EXPECTED: [string, number, number, '+' | '-', string][] = [
  ['primer_bind', 117, 134, '+', 'L4440'],
  ['misc_feature', 149, 289, '+', 'bom'],
  ['CDS', 553, 1431, '-', 'araC'],
  ['promoter', 1458, 1742, '+', 'araBAD promoter'],
  ['primer_bind', 1665, 1684, '+', 'pBAD Forward'],
  ['CDS', 1788, 1805, '+', '6xHis'],
  ['CDS', 1809, 1841, '+', 'T7 tag (gene 10 leader)'],
  ['CDS', 1845, 1868, '+', 'Xpress™ tag'],
  ['CDS', 1884, 2603, '+', 'mEGFP'],
  ['primer_bind', 1929, 1950, '-', 'EGFP-N'],
  ['primer_bind', 2190, 2209, '-', 'EXFP-R'],
  ['primer_bind', 2537, 2558, '+', 'EGFP-C'],
  ['terminator', 2819, 2905, '+', 'rrnB T1 terminator'],
  ['terminator', 2997, 3024, '+', 'rrnB T2 terminator'],
  ['promoter', 3043, 3134, '+', 'AmpR promoter'],
  ['CDS', 3135, 3995, '+', 'AmpR'],
  ['primer_bind', 3353, 3372, '-', 'Amp-R'],
  ['rep_origin', 4166, 4754, '+', 'ori'],
];

const ordered = (fs: ImportedFeature[]) =>
  [...fs].sort((a, b) => a.start - b.start || a.type.localeCompare(b.type));

describe('a real Addgene plasmid', () => {
  const p = parseSnapGene(bytes, 'fallback')!;

  test('it parses at all', () => {
    assert.ok(p, 'the reader returned null on a file from the vendor');
  });

  test('the molecule is what Addgene says it is', () => {
    assert.equal(p.sequence.length, 4791);
    assert.equal(p.circular, true);
    assert.equal(p.name, 'mEGFP-pBAD');
    assert.match(p.description, /Protein Expression Vector/);
  });

  test('the bases are the bases, not a shifted or re-origined copy', () => {
    assert.equal(p.sequence.slice(0, 50), 'TTTGCTGGCCTTTTGCTCACATGTTCTTTCCTGCGTTATCCCCTGATTCT');
    assert.match(p.sequence, /^[ACGT]+$/);
  });

  test('the feature table matches BioPython exactly', () => {
    /*
     * Count first and in its own assertion, because the failure that mattered
     * was a count: thirty-two features where there are eighteen, every extra
     * one a primer site SnapGene does not show.
     */
    assert.equal(p.features.length, EXPECTED.length);

    const got = ordered(p.features).map(f =>
      [f.type, f.start + 1, f.end + 1, f.strand, f.name]);
    assert.deepEqual(got, EXPECTED);
  });

  test('no feature points outside the molecule', () => {
    for (const f of p.features) {
      assert.ok(f.start >= 0 && f.start < p.sequence.length, `${f.name} start ${f.start}`);
      assert.ok(f.end >= 0 && f.end < p.sequence.length, `${f.name} end ${f.end}`);
    }
  });

  test("the lab's own colours survive", () => {
    // mEGFP is green in this file because somebody made it green. Re-deriving
    // a colour from the feature type would make every CDS the same shade and
    // lose the thing people recognise their constructs by.
    const egfp = p.features.find(f => f.name === 'mEGFP')!;
    assert.equal(egfp.color, '#05fd14');
    const araC = p.features.find(f => f.name === 'araC')!;
    assert.equal(araC.color, '#993366');
  });

  test('primers carry no colour of their own', () => {
    // They come from a different packet, which records no colour. Inventing
    // one would be a claim the file does not make.
    for (const f of p.features.filter(f => f.type === 'primer_bind')) {
      assert.equal(f.color, undefined, f.name);
    }
  });
});

// ─── The primer packet's own rules ───────────────────────────────────────────

/** A .dna file carrying just a primers packet, to exercise one rule at a time. */
function withPrimers(xml: string, seq = 'atgc'.repeat(500)): Uint8Array {
  const parts: number[][] = [];
  const seg = (type: number, payload: number[]) => {
    const n = payload.length;
    parts.push([type, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...payload]);
  };
  const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
  seg(9, [...ascii('SnapGene'), 0, 1, 0, 1, 0, 1]);
  seg(0, [1, ...ascii(seq)]);
  seg(5, ascii(xml));
  return Uint8Array.from(parts.flat());
}

const primer = (sites: string, params = '') =>
  `<Primers>${params}<Primer recentID="1" name="p1">${sites}</Primer></Primers>`;

describe('primer binding sites', () => {
  test('boundStrand 1 means the bottom strand', () => {
    /*
     * The attribute is boundStrand. No file SnapGene writes contains a
     * "strand" attribute, so reading one made every reverse primer in every
     * real plasmid point forwards -- and a reverse primer drawn forwards is a
     * cloning plan that does not work.
     */
    const p = parseSnapGene(withPrimers(primer(
      '<BindingSite location="100-119" boundStrand="1"/>' +
      '<BindingSite location="200-219" boundStrand="0"/>',
    )))!;
    assert.deepEqual(p.features.map(f => f.strand), ['-', '+']);
  });

  test('a site with no boundStrand reads forward', () => {
    const p = parseSnapGene(withPrimers(primer('<BindingSite location="100-119"/>')))!;
    assert.equal(p.features[0].strand, '+');
  });

  test('a primer sits one base right of where a feature with the same range would', () => {
    /*
     * SnapGene writes primer ranges one lower at both ends. BioPython
     * compensates for the same quirk; without it every primer imported from a
     * real file sat one base to the left of where SnapGene draws it, which is
     * exactly the kind of error nobody notices on a map and everybody notices
     * at the bench.
     */
    const p = parseSnapGene(withPrimers(primer('<BindingSite location="932-951"/>')))!;
    assert.equal(p.features[0].start + 1, 933);
    assert.equal(p.features[0].end + 1, 952);
  });

  test('the extent is the same length either way round', () => {
    const p = parseSnapGene(withPrimers(primer('<BindingSite location="932-951"/>')))!;
    assert.equal(p.features[0].end - p.features[0].start + 1, 20);
  });

  test('a simplified duplicate of a site already seen is dropped', () => {
    // SnapGene writes each site twice, the second marked simplified. Keeping
    // both doubles every primer on the map.
    const p = parseSnapGene(withPrimers(primer(
      '<BindingSite location="100-119" boundStrand="1"/>' +
      '<BindingSite simplified="1" location="100-119" boundStrand="1"/>',
    )))!;
    assert.equal(p.features.length, 1);
  });

  test('a simplified site that is not a duplicate is kept', () => {
    const p = parseSnapGene(withPrimers(primer(
      '<BindingSite location="100-119" boundStrand="1"/>' +
      '<BindingSite simplified="1" location="300-319" boundStrand="1"/>',
    )))!;
    assert.equal(p.features.length, 2);
  });

  test('a site too short to anneal is not shown, because SnapGene does not show it', () => {
    const params = '<HybridizationParams minContinuousMatchLen="10" minMeltingTemperature="0"/>';
    const p = parseSnapGene(withPrimers(primer(
      '<BindingSite location="100-119" annealedBases="ATAATACCGCGCCACATAGC"/>' +
      '<BindingSite location="300-305" annealedBases="ATAATA"/>',
      params,
    )))!;
    assert.equal(p.features.length, 1);
    assert.equal(p.features[0].start + 1, 101);
  });

  test('a site below the melting temperature is not shown either', () => {
    const params = '<HybridizationParams minContinuousMatchLen="0" minMeltingTemperature="40"/>';
    const p = parseSnapGene(withPrimers(primer(
      '<BindingSite location="100-119" meltingTemperature="58"/>' +
      '<BindingSite location="300-319" meltingTemperature="22"/>',
      params,
    )))!;
    assert.equal(p.features.length, 1);
  });

  test('with no hybridisation parameters nothing is filtered', () => {
    // Absent settings are not a reason to throw sites away.
    const p = parseSnapGene(withPrimers(primer(
      '<BindingSite location="100-119" annealedBases="AT" meltingTemperature="5"/>',
    )))!;
    assert.equal(p.features.length, 1);
  });

  test('the primer keeps its name, not the site', () => {
    const p = parseSnapGene(withPrimers(primer('<BindingSite location="100-119"/>')))!;
    assert.equal(p.features[0].name, 'p1');
    assert.equal(p.features[0].type, 'primer_bind');
  });
});

// ─── Segments a feature is and is not made of ───────────────────────────────

function withFeatures(xml: string, seq = 'atgc'.repeat(250)): Uint8Array {
  const parts: number[][] = [];
  const seg = (type: number, payload: number[]) => {
    const n = payload.length;
    parts.push([type, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...payload]);
  };
  const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
  seg(9, [...ascii('SnapGene'), 0, 1, 0, 1, 0, 1]);
  seg(0, [1, ...ascii(seq)]);
  seg(10, ascii(`<Features>${xml}</Features>`));
  return Uint8Array.from(parts.flat());
}

describe('feature segments', () => {
  test('a gap segment is the space between exons, not an exon', () => {
    /*
     * A spliced feature is written as its exons with gap segments between
     * them. Counting a gap as a piece of the feature puts an intron's worth of
     * bases inside the CDS, and a CDS with the introns in it translates to
     * nonsense.
     */
    const p = parseSnapGene(withFeatures(
      '<Feature type="CDS" name="spliced" directionality="1">' +
      '<Segment range="10-20" type="standard"/>' +
      '<Segment range="21-39" type="gap"/>' +
      '<Segment range="40-60" type="standard"/>' +
      '</Feature>',
    ))!;
    assert.equal(p.features[0].segments?.length, 2);
    assert.deepEqual(p.features[0].segments, [{ start: 9, end: 19 }, { start: 39, end: 59 }]);
  });

  test('a feature of nothing but gaps is not a feature', () => {
    const p = parseSnapGene(withFeatures(
      '<Feature type="CDS" name="all gap"><Segment range="10-20" type="gap"/></Feature>',
    ))!;
    assert.equal(p.features.length, 0);
  });

  test('a segment with no type attribute is a real segment', () => {
    const p = parseSnapGene(withFeatures(
      '<Feature type="CDS" name="plain"><Segment range="10-20"/></Feature>',
    ))!;
    assert.equal(p.features.length, 1);
    assert.equal(p.features[0].start, 9);
  });

  test('a feature running through the origin keeps its ends that way round', () => {
    /*
     * SnapGene writes a range whose end precedes its start when the feature
     * crosses base 1. Taking the lowest and highest number instead turns a
     * fifty-base feature into one that spans the whole plasmid -- and on a
     * circular map it draws as a ring, which looks deliberate.
     *
     * End before start is the convention the circular map already reads.
     */
    const p = parseSnapGene(withFeatures(
      '<Feature type="misc_feature" name="across the origin"><Segment range="980-20"/></Feature>',
    ))!;
    const f = p.features[0];
    assert.equal(f.start, 979);
    assert.equal(f.end, 19);
    assert.ok(f.end < f.start, 'a wrapping feature should report end before start');
  });

  test('a feature outside the molecule is dropped rather than drawn off the end', () => {
    const p = parseSnapGene(withFeatures(
      '<Feature type="CDS" name="beyond"><Segment range="5000-5100"/></Feature>' +
      '<Feature type="CDS" name="inside"><Segment range="10-20"/></Feature>',
    ))!;
    assert.deepEqual(p.features.map(f => f.name), ['inside']);
  });

  test('only the first colour of a feature is taken, and only if it is a colour', () => {
    const p = parseSnapGene(withFeatures(
      '<Feature type="CDS" name="a"><Segment range="10-20" color="#112233"/><Segment range="30-40" color="#445566"/></Feature>' +
      '<Feature type="CDS" name="b"><Segment range="50-60" color="red"/></Feature>',
    ))!;
    assert.equal(p.features.find(f => f.name === 'a')!.color, '#112233');
    assert.equal(p.features.find(f => f.name === 'b')!.color, undefined);
  });
});
