import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findTypeIISSites, digestTypeIIS, checkOverhangSet, hamming, goldenGate,
} from '../src/lib/golden-gate.ts';
import { ENZYMES } from '../src/lib/restrictionEnzymes.ts';
import { revComp } from '../src/lib/alignment.ts';

const BsaI = ENZYMES['BsaI'];

/**
 * Non-repeating filler with no Type IIS site in it.
 *
 * Random sequence contains a six-base site roughly once every two kilobases,
 * on either strand, and an accidental BsaI site in a spacer changes how many
 * pieces a donor yields. Real donors have the same problem -- removing internal
 * sites is what MoClo calls domestication -- so the detection is tested
 * separately and kept out of the fixtures.
 */
const SITES = ['GGTCTC', 'GAGACC', 'CGTCTC', 'GAGACG', 'GCTCTTC', 'GAAGAGC'];
const filler = (seed: number, n: number) => {
  let x = seed * 7919 + 13;
  const next = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return 'ACGT'[(x >>> 16) % 4]; };
  let out = '';
  while (out.length < n) {
    out += next();
    if (SITES.some(site => out.slice(-site.length) === site)) out = out.slice(0, -1);
  }
  return out;
};

describe('finding Type IIS cuts', () => {
  test('a forward site leaves the four bases downstream of it', () => {
    //          0-5      6-11     12   13-16
    const seq = 'TTTTTT' + 'GGTCTC' + 'A' + 'CGTA' + 'GGGGGGGG';
    const [site] = findTypeIISSites(seq, BsaI);
    assert.equal(site.orientation, 'forward');
    assert.equal(site.overhang, 'CGTA');
    assert.equal(seq.slice(site.topCut, site.bottomCut), 'CGTA');
  });

  test('a reverse site reaches back the other way', () => {
    //          0-5      6-9    10    11-16
    const seq = 'TTTTTT' + 'ATGC' + 'T' + 'GAGACC' + 'GGGGGGGG';
    const [site] = findTypeIISSites(seq, BsaI);
    assert.equal(site.orientation, 'reverse');
    assert.equal(site.overhang, 'ATGC');
    assert.ok(site.topCut < site.index, 'a reverse site cuts upstream of itself');
  });

  test('the overhang is whatever the sequence says, not a property of the enzyme', () => {
    // The point of Type IIS: change the four bases and the overhang changes.
    for (const oh of ['AATG', 'GCTT', 'TACA']) {
      const seq = 'TTTTTT' + 'GGTCTC' + 'A' + oh + 'GGGGGGGG';
      assert.equal(findTypeIISSites(seq, BsaI)[0].overhang, oh);
    }
  });

  test('SapI leaves three bases, not four', () => {
    const seq = 'TTTTTT' + 'GCTCTTC' + 'A' + 'GCA' + 'GGGGGGGG';
    const [site] = findTypeIISSites(seq, ENZYMES['SapI']);
    assert.equal(site.overhang.length, 3);
    assert.equal(site.overhang, 'GCA');
  });

  test('a sequence with no site yields nothing', () => {
    assert.deepEqual(findTypeIISSites(filler(1, 200), ENZYMES['SapI']), []);
  });
});

describe('digesting a part', () => {
  // A donor plasmid: sites point inward so the part is released without them.
  const part = (ohL: string, ohR: string, body: string) =>
    // reverse site ... [ohL] part [ohR] ... forward site
    'GAGACC' + filler(9, 20) +
    revComp('GGTCTC' + 'A') + ohL + body + ohR + 'T' + revComp('GGTCTC');

  test('a circular part releases a piece with the designed ends', () => {
    const donor = 'GGTCTC' + 'A' + 'AATG' + filler(2, 300) + 'GCTT' + 'T' + revComp('GGTCTC') + filler(3, 400);
    const pieces = digestTypeIIS('donor', donor, 'BsaI', true);
    const released = pieces.filter(p => !p.carriesSite);
    assert.equal(released.length, 1, `expected one site-free piece, got ${released.length}`);
    assert.equal(released[0].left.overhang, 'AATG');
    assert.equal(released[0].right.overhang, revComp('GCTT'));
  });

  test('the piece carrying the sites is marked as waste', () => {
    const donor = 'GGTCTC' + 'A' + 'AATG' + filler(2, 300) + 'GCTT' + 'T' + revComp('GGTCTC') + filler(3, 400);
    const pieces = digestTypeIIS('donor', donor, 'BsaI', true);
    assert.equal(pieces.filter(p => p.carriesSite).length, 1);
  });

  test('a linear template keeps blunt termini', () => {
    const linear = filler(4, 50) + 'GGTCTC' + 'A' + 'AATG' + filler(5, 100);
    const pieces = digestTypeIIS('linear', linear, 'BsaI', false);
    assert.ok(pieces.some(p => p.fromTerminus), 'the ends of a linear input are not enzyme ends');
    assert.ok(pieces.some(p => p.left.type === 'blunt' || p.right.type === 'blunt'));
  });

  test('a template the enzyme does not cut gives no pieces', () => {
    assert.deepEqual(digestTypeIIS('x', filler(6, 300), 'BsaI', true), []);
  });

  void part;
});

describe('judging an overhang set', () => {
  test('a well-chosen set raises nothing', () => {
    assert.deepEqual(checkOverhangSet(['AATG', 'GCTT', 'TACA', 'CCAG']), []);
  });

  test('a repeated overhang is reported', () => {
    const issues = checkOverhangSet(['AATG', 'GCTT', 'AATG']);
    assert.ok(issues.some(i => i.kind === 'duplicate' && i.overhangs[0] === 'AATG'));
  });

  test('a palindromic overhang is reported', () => {
    // GATC reads the same on both strands, so it ligates to itself.
    assert.ok(checkOverhangSet(['GATC', 'AATG']).some(i => i.kind === 'palindrome'));
  });

  test('a single-base run is reported', () => {
    assert.ok(checkOverhangSet(['AAAA', 'GCTT']).some(i => i.kind === 'low-complexity'));
  });

  test('overhangs one base from pairing are reported', () => {
    // AATG pairs perfectly with CATT. AATT is one base away from that pairing,
    // and ligase joins such ends often enough to matter across many parts.
    const issues = checkOverhangSet(['AATG', 'AATT']);
    assert.ok(
      issues.some(i => i.kind === 'one-base-apart'),
      `expected a fidelity warning, got: ${issues.map(i => i.kind).join(', ') || 'none'}`,
    );
  });

  test('hamming distance is only defined for equal lengths', () => {
    assert.equal(hamming('AATG', 'AATC'), 1);
    assert.equal(hamming('AATG', 'AATG'), 0);
    assert.equal(hamming('AATG', 'AAT'), Infinity);
  });
});

describe('a whole assembly', () => {
  // Four parts, each released by inward-pointing BsaI sites, with a designed
  // set of overhangs that chains them into a circle.
  const OH = ['AATG', 'GCTT', 'TACA', 'CCAG'];
  const donor = (i: number, bodyLen: number) =>
    'GGTCTC' + 'A' + OH[i] + filler(20 + i, bodyLen) + OH[(i + 1) % OH.length] + 'T' + revComp('GGTCTC') + filler(50 + i, 200);

  const inputs = OH.map((_, i) => ({ name: 'part' + (i + 1), sequence: donor(i, 200 + i * 50) }));

  test('four parts close into one construct', () => {
    const r = goldenGate(inputs, 'BsaI');
    assert.equal(r.parts.length, 4, `released ${r.parts.length} parts`);
    assert.equal(r.assemblies.length, 1, `got ${r.assemblies.length} assemblies`);
    assert.equal(r.assemblies[0].topology, 'circular');
  });

  test('the sites are gone from the product', () => {
    const r = goldenGate(inputs, 'BsaI');
    assert.equal(
      findTypeIISSites(r.assemblies[0].sequence, BsaI).length, 0,
      'a construct still carrying the site would be cut again in the same tube',
    );
    assert.equal(r.problems.filter(p => /still contains/.test(p.message)).length, 0);
  });

  test('the overhangs used are the ones that were designed', () => {
    const r = goldenGate(inputs, 'BsaI');
    assert.deepEqual([...r.overhangs].sort(), [...OH].sort());
  });

  test('the pieces carrying the sites are set aside', () => {
    const r = goldenGate(inputs, 'BsaI');
    assert.equal(r.discarded.length, 4, 'one backbone per donor');
    assert.ok(r.discarded.every(p => p.carriesSite));
  });

  test('a part with no site is named rather than silently dropped', () => {
    const r = goldenGate([...inputs, { name: 'forgot-the-sites', sequence: filler(99, 500) }], 'BsaI');
    assert.ok(r.problems.some(p => /forgot-the-sites/.test(p.message)));
  });

  test('a duplicated overhang makes the outcome ambiguous', () => {
    const bad = [
      { name: 'p1', sequence: 'GGTCTC' + 'A' + 'AATG' + filler(1, 200) + 'GCTT' + 'T' + revComp('GGTCTC') + filler(2, 150) },
      { name: 'p2', sequence: 'GGTCTC' + 'A' + 'GCTT' + filler(3, 200) + 'AATG' + 'T' + revComp('GGTCTC') + filler(4, 150) },
      { name: 'p3', sequence: 'GGTCTC' + 'A' + 'GCTT' + filler(5, 200) + 'AATG' + 'T' + revComp('GGTCTC') + filler(6, 150) },
    ];
    const r = goldenGate(bad, 'BsaI');
    assert.ok(
      r.overhangIssues.some(i => i.kind === 'duplicate'),
      'the same overhang on two parts has to be called out',
    );
  });

  test('an enzyme that cuts inside its site is refused', () => {
    assert.throws(
      () => goldenGate(inputs, 'EcoRI'),
      /cuts inside its recognition site/,
    );
  });

  test('a linear donor contributes only the piece between its two cuts', () => {
    // The ends of a linear input are not ends the enzyme made. They are blunt,
    // they cannot ligate directionally, and treating them as parts inflates
    // both the part list and the overhang set.
    const linear = filler(31, 120) + 'GGTCTC' + 'A' + 'AATG' + filler(32, 300) +
                   'GCTT' + 'T' + revComp('GGTCTC') + filler(33, 120);
    const r = goldenGate([{ name: 'linear-donor', sequence: linear, circular: false }], 'BsaI', { topology: 'linear' });
    assert.equal(r.parts.length, 1, `expected one real part, got ${r.parts.length}`);
    assert.equal(r.parts[0].left.overhang, 'AATG');
    assert.ok(r.discarded.every(p => p.carriesSite || p.fromTerminus));
  });

  test('an internal site in a part is found, because it changes the outcome', () => {
    // A spacer carrying a stray BsaI site is cut too, so the part comes apart.
    // This is what domestication exists to prevent, and it is worth detecting
    // rather than silently producing extra pieces.
    const stray = 'GGTCTC' + 'A' + 'AATG' + filler(11, 100) + 'GGTCTC' + 'ATTTT' +
                  filler(12, 100) + 'GCTT' + 'T' + revComp('GGTCTC') + filler(13, 150);
    const pieces = digestTypeIIS('stray', stray, 'BsaI', true);
    assert.ok(pieces.length > 2, `a stray site should add pieces, got ${pieces.length}`);
  });

  test('an unknown enzyme is refused', () => {
    assert.throws(() => goldenGate(inputs, 'NotAnEnzyme'), /Unknown enzyme/);
  });

  test('BsmBI works as well as BsaI', () => {
    const bsmbi = OH.map((_, i) => ({
      name: 'part' + (i + 1),
      sequence: 'CGTCTC' + 'A' + OH[i] + filler(70 + i, 200) + OH[(i + 1) % OH.length] + 'T' + revComp('CGTCTC') + filler(80 + i, 200),
    }));
    const r = goldenGate(bsmbi, 'BsmBI');
    assert.equal(r.assemblies.length, 1);
    assert.equal(findTypeIISSites(r.assemblies[0].sequence, ENZYMES['BsmBI']).length, 0);
  });
});
