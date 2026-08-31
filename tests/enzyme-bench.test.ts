import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  methylatedPositions, blockedSites, requiresMethylation, SYSTEMS,
} from '../src/lib/methylation.ts';
import {
  profile, uniqueCutters, nonCutters, fewCutters, isoschizomersOf,
  STARTER_SETS, resolveSet,
} from '../src/lib/enzyme-sets.ts';
import { ENZYMES } from '../src/lib/restrictionEnzymes.ts';

const filler = (seed: number, n: number) => {
  let x = seed * 7919 + 13;
  let out = '';
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out += 'ACGT'[(x >>> 16) % 4]; }
  return out;
};

describe('where the methyl groups are', () => {
  test('Dam marks the A in GATC, on both strands', () => {
    const seq = 'AAAA' + 'GATC' + 'AAAA';
    const at = methylatedPositions(seq, 'dam');
    // GATC sits at 4..7; the A is at 5, and the mirror A on the other strand
    // is opposite position 6.
    assert.deepEqual(at, [5, 6]);
  });

  test('Dcm reads CCWGG, so both CCAGG and CCTGG count', () => {
    assert.ok(methylatedPositions('TTTT' + 'CCAGG' + 'TTTT', 'dcm').length > 0);
    assert.ok(methylatedPositions('TTTT' + 'CCTGG' + 'TTTT', 'dcm').length > 0);
    assert.equal(methylatedPositions('TTTT' + 'CCGGG' + 'TTTT', 'dcm').length, 0);
  });

  test('a site across the origin counts only on a circle', () => {
    const seq = 'TC' + filler(1, 200) + 'GA';
    assert.equal(methylatedPositions(seq, 'dam', false).length, 0);
    assert.ok(methylatedPositions(seq, 'dam', true).length > 0);
  });

  test('unmethylated sequence has no marks', () => {
    assert.deepEqual(methylatedPositions('AAAATTTTAAAATTTT', 'dam'), []);
  });
});

describe('sites that will not cut', () => {
  test('a ClaI site inside a GATC is reported, with the reason', () => {
    // ATCGAT preceded by G gives GATCGAT: the Dam site overlaps ClaI's, and
    // ClaI is blocked. This is the classic case.
    const seq = filler(2, 100) + 'G' + 'ATCGAT' + filler(3, 100);
    const blocked = blockedSites(seq, ['ClaI']);
    assert.equal(blocked.length, 1, `got ${blocked.length}`);
    assert.equal(blocked[0].system, 'dam');
    assert.equal(blocked[0].known, true, 'ClaI is a documented case, not a guess');
    assert.match(blocked[0].message, /blocked by Dam/);
  });

  test('the same ClaI site away from any GATC is not reported', () => {
    const seq = filler(4, 100) + 'T' + 'ATCGAT' + 'T' + filler(5, 100);
    assert.deepEqual(blockedSites(seq, ['ClaI']), []);
  });

  test('an enzyme not in the table is flagged as worth checking, not as blocked', () => {
    // The honest distinction: the overlap is a fact about the sequence, and
    // whether the enzyme minds is a fact about the enzyme.
    const seq = filler(6, 80) + 'GGATCC' + filler(7, 80);   // BamHI, contains GATC
    const blocked = blockedSites(seq, ['BamHI']);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].known, false);
    assert.match(blocked[0].message, /check the supplier/);
    assert.doesNotMatch(blocked[0].message, /is blocked by/);
  });

  test('a blocked enzyme names an alternative that reads the same site', () => {
    const seq = filler(8, 100) + 'G' + 'ATCGAT' + filler(9, 100);
    assert.match(blockedSites(seq, ['ClaI'])[0].message, /BspDI/);
  });

  test('DpnI is the opposite case: it needs the methylation', () => {
    assert.equal(requiresMethylation('DpnI'), 'dam');
    assert.equal(requiresMethylation('EcoRI'), null);
  });

  test('every system says where the methylation comes from', () => {
    for (const s of Object.values(SYSTEMS)) {
      assert.ok(s.where.length > 20, `${s.name} does not say where it comes from`);
    }
  });
});

describe('narrowing the enzyme list', () => {
  const plasmid = filler(20, 4000);

  test('unique cutters are exactly those with one site, in order along the sequence', () => {
    const hits = profile(plasmid, resolveSet(STARTER_SETS[0]));
    const unique = uniqueCutters(hits);
    assert.ok(unique.every(h => h.cuts.length === 1));
    for (let i = 1; i < unique.length; i++) {
      assert.ok(unique[i].cuts[0] >= unique[i - 1].cuts[0], 'should read along the plasmid');
    }
  });

  test('non-cutters really do not cut', () => {
    const hits = profile(plasmid, resolveSet(STARTER_SETS[0]));
    assert.ok(nonCutters(hits).every(h => h.cuts.length === 0));
  });

  test('the three groups do not overlap', () => {
    const hits = profile(plasmid, resolveSet(STARTER_SETS[0]));
    const names = (hs: { name: string }[]) => new Set(hs.map(h => h.name));
    const u = names(uniqueCutters(hits)), n = names(nonCutters(hits)), f = names(fewCutters(hits));
    for (const x of u) assert.ok(!n.has(x) && !f.has(x), `${x} is in two groups`);
    for (const x of n) assert.ok(!f.has(x), `${x} is in two groups`);
  });

  test('a starter set only names enzymes this build knows', () => {
    for (const set of STARTER_SETS) {
      const resolved = resolveSet(set);
      assert.ok(resolved.length > 0, `${set.name} resolved to nothing`);
      for (const n of resolved) assert.ok(ENZYMES[n], `${n} is not in the table`);
    }
  });
});

describe('isoschizomers', () => {
  test('an enzyme with the same site and cut is offered as a substitute', () => {
    const iso = isoschizomersOf('ClaI');
    assert.ok(iso.identical.includes('BspDI'), iso.identical.join(', '));
    for (const n of iso.identical) {
      assert.equal(ENZYMES[n].pattern, ENZYMES['ClaI'].pattern);
      assert.equal(ENZYMES[n].cutBefore, ENZYMES['ClaI'].cutBefore);
    }
  });

  test('the same site cut elsewhere is kept separate, because the ends differ', () => {
    // KpnI and Acc65I both read GGTACC. One leaves a 3' overhang, the other a
    // 5'. Treating them as interchangeable would change what a fragment
    // ligates to.
    const iso = isoschizomersOf('KpnI');
    assert.ok(iso.neoschizomers.includes('Acc65I'), iso.neoschizomers.join(', '));
    assert.ok(!iso.identical.includes('Acc65I'));
    assert.notEqual(ENZYMES['KpnI'].overhangType, ENZYMES['Acc65I'].overhangType);
  });

  test('an enzyme with no relatives returns empty lists rather than throwing', () => {
    const iso = isoschizomersOf('NotAnEnzyme');
    assert.deepEqual(iso, { identical: [], neoschizomers: [] });
  });

  test('an enzyme is never its own isoschizomer', () => {
    for (const name of ['ClaI', 'KpnI', 'EcoRI', 'BsaI']) {
      const iso = isoschizomersOf(name);
      assert.ok(!iso.identical.includes(name) && !iso.neoschizomers.includes(name));
    }
  });
});
