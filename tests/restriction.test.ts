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
      assert.ok(e.cutBefore >= 0, `${key} cuts at a negative offset`);
      assert.ok(['5prime', '3prime', 'blunt'].includes(e.overhangType),
        `${key} has an unknown overhang type`);
    }
  });

  test('only Type IIS enzymes cut outside their recognition site', () => {
    // The distinguishing property: BsaI recognises GGTCTC and cuts one base
    // past it, which is why Golden Gate can choose its own overhangs.
    for (const [key, e] of Object.entries(ENZYMES)) {
      if (e.cutBefore > e.pattern.length) {
        assert.equal(e.typeIIS, true, `${key} cuts outside its site but is not marked Type IIS`);
      }
    }
  });

  test('the Golden Gate workhorses are present and cut outside their sites', () => {
    // The cloning wizard offers Golden Gate. It cannot work without these.
    for (const name of ['BsaI', 'BsmBI', 'BbsI', 'SapI']) {
      const e = ENZYMES[name];
      assert.ok(e, `${name} should be in the table`);
      assert.equal(e.typeIIS, true, `${name} should be Type IIS`);
      assert.ok(e.cutBefore > e.pattern.length, `${name} should cut past its site`);
      assert.equal(e.overhangType, '5prime', `${name} should leave a 5' overhang`);
    }
    // BsaI: GGTCTC(1/5) -- 1 past on top, 5 on the bottom, a 4 nt overhang.
    assert.equal(ENZYMES.BsaI.pattern, 'GGTCTC');
    assert.equal(ENZYMES.BsaI.cutBefore, 7);
    assert.equal(ENZYMES.BsaI.overhangLength, 4);
  });

  test('blunt cutters leave nothing, sticky ones leave a measurable overhang', () => {
    for (const [key, e] of Object.entries(ENZYMES)) {
      if (e.overhangType === 'blunt') {
        assert.equal(e.overhang, '', `${key} is blunt so should have no overhang`);
        assert.equal(e.overhangLength ?? 0, 0, `${key} is blunt so its overhang is 0 long`);
      } else {
        assert.ok((e.overhangLength ?? 0) > 0, `${key} is sticky so should have a length`);
        // A fixed overhang sequence is only knowable when the site is
        // unambiguous. A Type IIS enzyme cuts past its site, and a degenerate
        // site such as AccB1I's G^GYRCC leaves whichever bases the target has --
        // in both cases only the length is a property of the enzyme.
        const unambiguous = /^[ACGT]+$/.test(e.pattern);
        if (!e.typeIIS && unambiguous) {
          assert.ok(e.overhang.length > 0, `${key} has a fixed site so should have a sequence`);
          assert.equal(e.overhang.length, e.overhangLength, `${key} overhang length disagrees`);
        }
      }
    }
  });

  test('SmaI and EcoRV are blunt cutters', () => {
    // Both cut in the centre of a palindrome, leaving flush ends.
    for (const n of ['SmaI', 'EcoRV']) {
      if (ENZYMES[n]) assert.equal(ENZYMES[n].overhangType, 'blunt', `${n} should be blunt`);
    }
  });

  test('the classic cloning enzymes recognise palindromes', () => {
    // A homodimeric enzyme cutting a palindrome is the classic Type II case,
    // and it is what makes the cut position mirror on the two strands. Type IIS
    // enzymes are deliberately asymmetric, so they are not held to it.
    for (const name of ['EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'SalI', 'PstI', 'SmaI', 'KpnI', 'SacI']) {
      const e = ENZYMES[name];
      if (!e) continue;
      assert.equal(reverseComplement(e.pattern), e.pattern,
        `${name} (${e.pattern}) should be palindromic`);
    }
  });

  test('a palindromic cutter cuts at mirrored positions on the two strands', () => {
    for (const [key, e] of Object.entries(ENZYMES)) {
      if (e.typeIIS || !/^[ACGT]+$/.test(e.pattern)) continue;
      if (reverseComplement(e.pattern) !== e.pattern) continue;
      assert.equal(e.cutBottom, e.pattern.length - e.cutBefore,
        `${key} bottom-strand cut is not the mirror of the top`);
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
