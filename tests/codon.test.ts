import test from 'node:test';
import assert from 'node:assert/strict';
import { HOSTS, host, cai, rareCodons, preferredCodons, relativeAdaptiveness, SYNONYMS } from '../src/lib/codon-usage.ts';
import { optimise, translate, longestRepeat } from '../src/lib/codon-optimise.ts';
import { findSilentSites, removeSiteSilently } from '../src/lib/silent-mutagenesis.ts';
import { CODON_TABLE } from '../src/lib/molbuilder-logic.ts';

const ECOLI = host('ecoli');
const HUMAN = host('human');

/** A CDS with a bit of everything: rare codons, a BamHI site, and a repeat. */
const GFP_ISH =
  'ATGAGTAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCAACATACGGAAAACTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTTCCATGG';

test('every codon table normalises to one per amino acid', () => {
  for (const usage of Object.values(HOSTS)) {
    for (const [aa, family] of Object.entries(SYNONYMS)) {
      const total = family.reduce((s, c) => s + usage.freq[c], 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${usage.id} ${aa} sums to ${total}`);
    }
  }
});

test('every codon table covers all 64 codons', () => {
  for (const usage of Object.values(HOSTS)) {
    assert.equal(Object.keys(usage.freq).length, 64, usage.id);
    for (const codon of Object.keys(CODON_TABLE)) {
      assert.ok(typeof usage.freq[codon] === 'number', `${usage.id} missing ${codon}`);
    }
  }
});

test('the known preferences of each host come out right', () => {
  const e = preferredCodons(ECOLI);
  // E. coli's strong preferences, the ones everyone knows.
  assert.equal(e.L, 'CTG');
  assert.equal(e.R, 'CGC');
  assert.equal(e.K, 'AAA');
  const h = preferredCodons(HUMAN);
  assert.equal(h.L, 'CTG');
  assert.equal(h.K, 'AAG', 'human prefers AAG where E. coli prefers AAA');
  assert.equal(h.E, 'GAG');
  assert.equal(ECOLI.freq.GAA > ECOLI.freq.GAG, true, 'E. coli prefers GAA');
});

test('AGA and AGG are rare in E. coli and common in yeast', () => {
  assert.ok(ECOLI.freq.AGA < 0.06, `AGA is ${ECOLI.freq.AGA} in E. coli`);
  assert.ok(host('yeast').freq.AGA > 0.4, 'AGA is the major arginine codon in yeast');
});

test('relative adaptiveness peaks at exactly 1 for each family', () => {
  const w = relativeAdaptiveness(ECOLI);
  for (const family of Object.values(SYNONYMS)) {
    assert.ok(Math.abs(Math.max(...family.map(c => w[c])) - 1) < 1e-9);
  }
});

test('CAI is 1 for a gene built entirely of preferred codons', () => {
  const pref = preferredCodons(ECOLI);
  // Skip M and W: CAI excludes them, so a gene of only those has no codons to score.
  const seq = ['L', 'R', 'K', 'A', 'G', 'V', 'S', 'T'].map(aa => pref[aa]).join('').repeat(3);
  assert.ok(Math.abs(cai(seq, ECOLI) - 1) < 1e-9, `got ${cai(seq, ECOLI)}`);
});

test('CAI is lower for a gene built of the worst codons', () => {
  const worst = Object.fromEntries(Object.entries(SYNONYMS).map(([aa, fam]) => [
    aa, fam.reduce((b, c) => (ECOLI.freq[c] < ECOLI.freq[b] ? c : b), fam[0]),
  ]));
  const seq = ['L', 'R', 'K', 'A', 'G'].map(aa => worst[aa]).join('').repeat(3);
  assert.ok(cai(seq, ECOLI) < 0.2, `got ${cai(seq, ECOLI)}`);
});

test('CAI ignores methionine and tryptophan', () => {
  const pref = preferredCodons(ECOLI);
  const withoutMW = ['L', 'R', 'K'].map(a => pref[a]).join('');
  const withMW = 'ATG' + withoutMW + 'TGG';
  assert.equal(cai(withMW, ECOLI), cai(withoutMW, ECOLI));
});

test('rare codons are found, and clustering is distinguished from scattering', () => {
  // Six AGA in a row: the classic E. coli arginine problem.
  const clustered = 'ATG' + 'AGA'.repeat(6) + 'AAAGAAGCT';
  const found = rareCodons(clustered, ECOLI);
  assert.equal(found.length, 6);
  assert.ok(found.every(r => r.inCluster), 'six in a row is a cluster');

  // One AGA on its own among common codons.
  const scattered = 'ATG' + 'AAAGAAGCTGGTCTG'.repeat(2) + 'AGA' + 'AAAGAAGCTGGTCTG'.repeat(2);
  const few = rareCodons(scattered, ECOLI);
  assert.equal(few.length, 1);
  assert.equal(few[0].inCluster, false, 'one rare codon alone is not a cluster');
});

test('optimising never changes the protein', () => {
  for (const id of Object.keys(HOSTS)) {
    for (let seed = 1; seed <= 5; seed++) {
      const r = optimise(GFP_ISH, { usage: host(id), seed });
      assert.equal(r.protein, translate(GFP_ISH));
      assert.equal(translate(r.sequence), translate(GFP_ISH), `${id} seed ${seed}`);
      assert.equal(r.sequence.length, GFP_ISH.length);
    }
  }
});

test('optimising for E. coli raises CAI', () => {
  const r = optimise(GFP_ISH, { usage: ECOLI, seed: 3 });
  assert.ok(r.after.cai > r.before.cai, `${r.before.cai} -> ${r.after.cai}`);
});

test('optimisation is deterministic for a given seed, and varies across seeds', () => {
  const a = optimise(GFP_ISH, { usage: ECOLI, seed: 7 });
  const b = optimise(GFP_ISH, { usage: ECOLI, seed: 7 });
  const c = optimise(GFP_ISH, { usage: ECOLI, seed: 8 });
  assert.equal(a.sequence, b.sequence);
  assert.notEqual(a.sequence, c.sequence);
});

test('sampling does not collapse to the single best codon everywhere', () => {
  // The naive optimiser's signature failure: every leucine becomes CTG.
  const r = optimise(GFP_ISH, { usage: ECOLI, seed: 4 });
  const leucines: string[] = [];
  for (let i = 0; i < r.protein.length; i++) {
    if (r.protein[i] === 'L') leucines.push(r.sequence.slice(i * 3, i * 3 + 3));
  }
  assert.ok(leucines.length >= 4, 'the fixture has leucines to check');
  assert.ok(new Set(leucines).size > 1, `all leucines became ${leucines[0]}`);
});

test('a requested restriction site is removed and the protein preserved', () => {
  // Plant a BamHI site in frame: GGATCC = Gly-Ser.
  const withSite = 'ATG' + 'GGATCC' + 'AAAGAAGCTGGTCTGAAAGAAGCT';
  assert.ok(withSite.includes('GGATCC'));
  const r = optimise(withSite, { usage: ECOLI, avoidSites: ['BamHI'], seed: 2 });
  assert.equal(translate(r.sequence), translate(withSite));
  assert.ok(!r.sequence.includes('GGATCC'), `still there: ${r.sequence}`);
  assert.equal(r.after.siteHits.length, 0);
});

test('a site that cannot be removed silently is reported, not quietly left in', () => {
  // Met-Trp-Pro-Lys carries HaeIII (GGCC) across the Trp and Pro codons. Trp
  // has one codon, and the two site bases inside the Pro codon are its first
  // two, which are fixed for proline. Nothing synonymous can break it.
  const seq = 'ATGTGGCCGAAA';
  const r = optimise(seq, { usage: ECOLI, avoidSites: ['HaeIII'], seed: 1 });

  assert.equal(translate(r.sequence), translate(seq), 'the protein is still MWPK');
  assert.ok(r.sequence.includes('GGCC'), 'the site really is still there');
  assert.equal(r.after.siteHits.length, 1);
  assert.ok(
    r.unresolved.some(u => u.includes('HaeIII')),
    `the failure must be stated, got: ${JSON.stringify(r.unresolved)}`,
  );
});

test('longestRepeat finds an exact repeat and ignores a shorter one', () => {
  const unit = 'ACGTACGTGGCCTTAA';
  assert.ok(longestRepeat(unit + 'TTTT' + unit) >= 16);
  assert.equal(longestRepeat('ACGTTGCACCTAGGAT'), 0);
});

test('optimisation refuses a sequence that is not a whole number of codons', () => {
  assert.throws(() => optimise('ATGAAAG', { usage: ECOLI }), /whole number of codons/);
});

test('a silent site can be added, and the protein is unchanged', () => {
  const cands = findSilentSites(GFP_ISH, ['EcoRI', 'BamHI', 'HindIII', 'XhoI'], ECOLI);
  assert.ok(cands.length > 0, 'somewhere in 170 bp a six-cutter fits silently');
  for (const c of cands.slice(0, 25)) {
    assert.equal(translate(c.sequence), translate(GFP_ISH), `${c.enzyme} at ${c.position}`);
    assert.equal(c.sequence.length, GFP_ISH.length);
    assert.ok(c.changes.length > 0);
    assert.ok(c.basesChanged > 0);
  }
});

test('the site a candidate promises is actually in the sequence it returns', () => {
  const cands = findSilentSites(GFP_ISH, ['EcoRI', 'BamHI', 'HindIII', 'KpnI', 'XhoI'], ECOLI);
  const patterns: Record<string, string> = {
    EcoRI: 'GAATTC', BamHI: 'GGATCC', HindIII: 'AAGCTT', KpnI: 'GGTACC', XhoI: 'CTCGAG',
  };
  for (const c of cands.slice(0, 30)) {
    assert.ok(c.sequence.includes(patterns[c.enzyme]),
      `${c.enzyme} promised at ${c.position} but not present`);
  }
});

test('candidates are ranked with the cheapest change first', () => {
  const cands = findSilentSites(GFP_ISH, ['EcoRI', 'BamHI', 'HindIII', 'KpnI'], ECOLI);
  for (let i = 1; i < cands.length; i++) {
    assert.ok(cands[i - 1].basesChanged <= cands[i].basesChanged);
  }
  assert.equal(cands[0].basesChanged, Math.min(...cands.map(c => c.basesChanged)));
});

test('uniqueOnly returns only sites that cut once', () => {
  const cands = findSilentSites(GFP_ISH, ['EcoRI', 'BamHI', 'HindIII'], ECOLI, { uniqueOnly: true });
  for (const c of cands) assert.equal(c.unique, true);
});

test('an internal site can be removed silently', () => {
  const withSite = 'ATGAAAGAA' + 'GGATCC' + 'GCTGGTCTGAAAGAAGCT';
  const { candidates, sites, impossible } = removeSiteSilently(withSite, 'BamHI', ECOLI);
  assert.deepEqual(sites, [9]);
  assert.equal(impossible.length, 0);
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.equal(translate(c.sequence), translate(withSite));
    assert.ok(!c.sequence.includes('GGATCC'));
    assert.equal(c.changes.length, 1, 'one codon changed');
  }
  assert.equal(candidates[0].basesChanged, 1, 'the cheapest removal is a single base');
});

test('removal reports a site it cannot touch rather than pretending success', () => {
  // The same MWPK case: the site is found, and named as unremovable.
  const { sites, candidates, impossible } = removeSiteSilently('ATGTGGCCGAAA', 'HaeIII', ECOLI);
  assert.deepEqual(sites, [4], 'the site is at position 4');
  assert.deepEqual(impossible, [4], 'and it is reported as impossible');
  assert.equal(candidates.length, 0);
});

test('no site at all is an empty list, not an impossibility', () => {
  // The distinction matters: "nothing to remove" and "cannot be removed" are
  // different answers and must not look the same to the caller.
  const { sites, candidates, impossible } = removeSiteSilently('ATGAAAGAAGCT', 'BamHI', ECOLI);
  assert.deepEqual(sites, []);
  assert.deepEqual(candidates, []);
  assert.deepEqual(impossible, []);
});

test('silent site search rejects a partial codon', () => {
  assert.throws(() => findSilentSites('ATGAA', ['EcoRI'], ECOLI), /whole number of codons/);
});

test('a site in the input is "removed"; one the optimiser nearly made is "avoided"', () => {
  const withSite = 'ATG' + 'GGATCC' + 'AAAGAAGCTGGTCTGAAAGAAGCT';
  const r = optimise(withSite, { usage: ECOLI, avoidSites: ['BamHI'], seed: 2 });
  assert.ok(r.before.siteHits.some(h => h.enzyme === 'BamHI'), 'BamHI really was in the input');
  assert.ok(
    r.notes.some(n => /Removed the BamHI/.test(n)),
    `should say removed, got ${JSON.stringify(r.notes)}`,
  );
  assert.ok(!r.notes.some(n => /Avoided introducing a BamHI/.test(n)));
});

test('every note names a site that is genuinely gone from the result', () => {
  const r = optimise(GFP_ISH, { usage: ECOLI, avoidSites: ['EcoRI', 'BamHI', 'XhoI', 'HindIII'], seed: 5 });
  const named = r.notes.flatMap(n => n.match(/(EcoRI|BamHI|XhoI|HindIII)/) ?? []);
  for (const enzyme of named) {
    assert.ok(
      !r.after.siteHits.some(h => h.enzyme === enzyme),
      `${enzyme} is claimed handled but still present`,
    );
  }
});
