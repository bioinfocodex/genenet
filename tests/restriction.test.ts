import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENZYMES, findCutSites, digestLinear, digestCircular, areEndsCompatible,
} from '../src/lib/restrictionEnzymes.ts';
import { calculateFragments, gelPosition } from '../src/lib/simulation.ts';
import { reverseComplement } from '../src/lib/simulation.ts';

/**
 * Restriction digests.
 *
 * The failure mode here is a cut position off by one: the gel picture still
 * looks reasonable, the fragment sizes are merely wrong, and nobody finds out
 * until a clone does not work. Recognition sequences are checked against the
 * published sites rather than against whatever the table currently says.
 */

/** Recognition sequences as published by NEB. */
const PUBLISHED: Record<string, string> = {
  EcoRI: 'GAATTC', BamHI: 'GGATCC', HindIII: 'AAGCTT', NotI: 'GCGGCCGC',
  XhoI: 'CTCGAG', SalI: 'GTCGAC', PstI: 'CTGCAG', SmaI: 'CCCGGG',
  KpnI: 'GGTACC', SacI: 'GAGCTC', XbaI: 'TCTAGA', SpeI: 'ACTAGT',
  NcoI: 'CCATGG', NdeI: 'CATATG', EcoRV: 'GATATC', HaeIII: 'GGCC',
};

describe('the enzyme table', () => {
  test('recognition sequences match the published sites', () => {
    for (const [name, site] of Object.entries(PUBLISHED)) {
      const e = ENZYMES[name];
      if (!e) continue; // only check the ones this build ships
      assert.equal(e.pattern, site, `${name} should recognise ${site}`);
    }
  });

  test('every shipped enzyme has a coherent definition', () => {
    for (const [key, e] of Object.entries(ENZYMES)) {
      assert.equal(e.name, key, `${key} name should match its key`);
      assert.match(e.pattern, /^[ACGTRYSWKMBDHVN]+$/, `${key} pattern must be IUPAC`);
      assert.ok(e.cutBefore >= 0 && e.cutBefore <= e.pattern.length,
        `${key} cuts at ${e.cutBefore}, outside its ${e.pattern.length} bp site`);
      assert.ok(['5prime', '3prime', 'blunt'].includes(e.overhangType),
        `${key} has an unknown overhang type`);
    }
  });

  test('blunt cutters have no overhang, sticky ones do', () => {
    for (const [key, e] of Object.entries(ENZYMES)) {
      if (e.overhangType === 'blunt') {
        assert.equal(e.overhang, '', `${key} is blunt so should have no overhang`);
      } else {
        assert.ok(e.overhang.length > 0, `${key} is sticky so should have an overhang`);
      }
    }
  });

  test('SmaI and EcoRV are blunt cutters', () => {
    // Both cut in the centre of a palindrome, leaving flush ends.
    for (const n of ['SmaI', 'EcoRV']) {
      if (ENZYMES[n]) assert.equal(ENZYMES[n].overhangType, 'blunt', `${n} should be blunt`);
    }
  });

  test('recognition sites that should be palindromic are', () => {
    for (const [key, e] of Object.entries(ENZYMES)) {
      if (!/^[ACGT]+$/.test(e.pattern)) continue; // skip degenerate sites
      if (e.pattern.length % 2 !== 0) continue;   // odd sites cannot be palindromes
      assert.equal(reverseComplement(e.pattern), e.pattern,
        `${key} (${e.pattern}) is expected to be palindromic`);
    }
  });
});

describe('findCutSites', () => {
  test('finds a single site', () => {
    // 10 bases, then GAATTC.
    const seq = 'AAAAAAAAAA' + 'GAATTC' + 'TTTTTTTTTT';
    const sites = findCutSites(seq, ENZYMES.EcoRI);
    assert.equal(sites.length, 1);
    // EcoRI cuts G^AATTC, so one base into the site at offset 10.
    assert.equal(sites[0], 10 + ENZYMES.EcoRI.cutBefore);
  });

  test('finds every occurrence', () => {
    const seq = 'GAATTC' + 'AAAA' + 'GAATTC' + 'AAAA' + 'GAATTC';
    assert.equal(findCutSites(seq, ENZYMES.EcoRI).length, 3);
  });

  test('reports nothing when the site is absent', () => {
    assert.equal(findCutSites('AAAAAAAAAAAAAAAA', ENZYMES.EcoRI).length, 0);
  });

  test('a one-base change abolishes the site', () => {
    // GAATTC -> GATTTC is no longer an EcoRI site.
    assert.equal(findCutSites('AAAA' + 'GATTTC' + 'AAAA', ENZYMES.EcoRI).length, 0);
  });

  test('is case-insensitive', () => {
    assert.equal(findCutSites('aaaagaattcaaaa', ENZYMES.EcoRI).length, 1);
  });
});

describe('fragment sizes', () => {
  test('an uncut linear molecule is one fragment of the full length', () => {
    assert.deepEqual(calculateFragments(5000, [], false), [5000]);
  });

  test('one cut in a linear molecule gives two fragments summing to the total', () => {
    const f = calculateFragments(1000, [300], false);
    assert.equal(f.length, 2);
    assert.equal(f.reduce((a, b) => a + b, 0), 1000);
  });

  test('one cut in a circle gives a single linear fragment of the full length', () => {
    // Cutting a circle once linearises it; it does not halve it.
    const f = calculateFragments(5000, [1200], true);
    assert.equal(f.length, 1);
    assert.equal(f[0], 5000);
  });

  test('two cuts in a circle give two fragments summing to the total', () => {
    const f = calculateFragments(5000, [1000, 3000], true);
    assert.equal(f.length, 2);
    assert.equal(f.reduce((a, b) => a + b, 0), 5000);
    assert.deepEqual([...f].sort((a, b) => a - b), [2000, 3000]);
  });

  test('fragments never sum to more than the molecule', () => {
    for (const cuts of [[100], [100, 200], [10, 500, 900], [1, 2, 3]]) {
      const lin = calculateFragments(1000, cuts, false);
      assert.equal(lin.reduce((a, b) => a + b, 0), 1000, `linear with cuts ${cuts}`);
      const circ = calculateFragments(1000, cuts, true);
      assert.equal(circ.reduce((a, b) => a + b, 0), 1000, `circular with cuts ${cuts}`);
    }
  });

  test('duplicate cut positions do not create zero-length fragments', () => {
    const f = calculateFragments(1000, [500, 500], false);
    assert.ok(f.every(x => x > 0), `got a zero-length fragment: ${f}`);
  });
});

describe('digest', () => {
  test('digesting a linear molecule with no site leaves it intact', () => {
    const r = digestLinear('AAAAAAAAAAAAAAAAAAAA', ['EcoRI']);
    assert.equal(r.fragments.length, 1);
  });

  test('a circular plasmid cut once is linearised', () => {
    const plasmid = 'AAAA'.repeat(50) + 'GAATTC' + 'TTTT'.repeat(50);
    const r = digestCircular(plasmid, ['EcoRI']);
    assert.equal(r.fragments.length, 1, 'one cut should linearise, not fragment');
    assert.equal(r.fragments[0].size, plasmid.length);
  });

  test('a circular plasmid cut twice gives two fragments', () => {
    const plasmid = 'GAATTC' + 'AAAA'.repeat(50) + 'GAATTC' + 'TTTT'.repeat(50);
    const r = digestCircular(plasmid, ['EcoRI']);
    assert.equal(r.fragments.length, 2);
    assert.equal(r.fragments.reduce((a, f) => a + f.size, 0), plasmid.length);
  });
});

describe('gel migration', () => {
  test('larger fragments migrate less far', () => {
    // Position is measured from the well, so a bigger fragment has a smaller
    // value. Getting this backwards would flip every gel picture.
    assert.ok(gelPosition(10000) < gelPosition(100));
  });

  test('migration is monotonic in size', () => {
    const sizes = [100, 500, 1000, 3000, 8000];
    const positions = sizes.map(s => gelPosition(s));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] < positions[i - 1], `${sizes[i]} should run less far than ${sizes[i - 1]}`);
    }
  });

  test('sizes outside the ladder range are clamped, not sent off the gel', () => {
    assert.ok(gelPosition(1) >= 0 && gelPosition(1) <= 1);
    assert.ok(gelPosition(10_000_000) >= 0 && gelPosition(10_000_000) <= 1);
  });
});

describe('end compatibility', () => {
  test('an enzyme is compatible with itself', () => {
    assert.equal(areEndsCompatible('EcoRI', 'EcoRI'), true);
  });

  test('EcoRI and BamHI ends do not ligate', () => {
    // AATT and GATC overhangs cannot anneal.
    assert.equal(areEndsCompatible('EcoRI', 'BamHI'), false);
  });
});
