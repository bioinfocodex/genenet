import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReport, coveredBases } from '../src/lib/blast.ts';

/**
 * The parser, against a report NCBI actually sent.
 *
 * Every other test in tests/blast.test.ts builds its JSON by hand, which
 * proves the parser handles the shape we believe NCBI uses. This one proves
 * it handles the shape NCBI used: a megablast of 601 nt of EGFP taken from
 * pEGFP-N1 against core_nt, trimmed from fifty hits to the three that carry
 * something the hand-written cases cannot -- a plain single alignment, a hit
 * aligning in two pieces on opposite strands, and one aligning twice on the
 * same strand.
 *
 * The numbers below are NCBI's, copied from the fixture rather than computed
 * here, so a change in the parser shows up as a disagreement with the report
 * instead of a disagreement with itself.
 */

const report = parseReport(
  JSON.parse(readFileSync(new URL('./fixtures/blast-egfp-core_nt.json', import.meta.url), 'utf8')),
);

if ('error' in report) throw new Error(`the fixture did not parse: ${report.error}`);

describe('a report NCBI actually sent', () => {
  test('the header survives the trip', () => {
    assert.equal(report.program, 'blastn');
    assert.equal(report.database, 'core_nt');
    assert.equal(report.queryLength, 601);
    assert.equal(report.hits.length, 3);
  });

  test('a description is read from the first entry, not the record id', () => {
    /*
     * JSON2_S puts the accession inside description[0], a list, because one
     * hit can stand for several identical records. Reading hit.id instead
     * gives something like 'gi|...|gb|LC852913.1|' -- technically present,
     * useless in a table.
     */
    const top = report.hits[0];
    assert.equal(top.accession, 'LC852913');
    assert.match(top.title, /pmTQ2-N1-hARF6/);
    assert.equal(top.organism, 'synthetic construct');
    assert.equal(top.length, 5201);
  });

  test('a perfect hit reads as 100 per cent, not 99.99', () => {
    // 601 identities over 601 aligned bases, and a 601 nt query.
    const top = report.hits[0];
    assert.equal(top.identity, 100);
    assert.equal(top.coverage, 100);
    assert.equal(top.bitScore, 1110.96);
    assert.equal(top.evalue, 0);
  });
});

describe('a hit that aligns in more than one piece', () => {
  const hq = report.hits.find(h => h.accession === 'HQ416707')!;

  test('both alignments are kept', () => {
    assert.equal(hq.hsps.length, 2);
  });

  test('coverage is the union of the pieces, never their sum', () => {
    /*
     * This is the case the coverage design exists for, and the fixture shows
     * why with real numbers: the two alignments cover query 1..601 and
     * 131..343, which add up to 814 bases of a 601 nt query. Summing them
     * reports 135 per cent coverage -- a number that cannot mean anything,
     * printed next to a real hit.
     */
    const sum = hq.hsps.reduce((a, x) => a + Math.abs(x.queryTo - x.queryFrom) + 1, 0);
    assert.equal(sum, 814);
    assert.equal(coveredBases(hq.hsps), 601);
    assert.equal(hq.coverage, 100);
  });

  test('the reported identity is the best alignment, not an average', () => {
    assert.equal(hq.identity, 100);
    assert.equal(hq.bitScore, 1110.96);
  });

  test('the expect value is the lowest across the alignments', () => {
    assert.equal(hq.evalue, 0);
    assert.ok(hq.hsps.some(h => h.evalue > 0));
  });
});

describe('an alignment to the minus strand', () => {
  const hq = report.hits.find(h => h.accession === 'HQ416707')!;
  const minus = hq.hsps.find(h => h.hitStrand === -1)!;

  test('NCBI said minus, and that is what is recorded', () => {
    assert.ok(minus, 'the fixture is meant to contain a minus-strand alignment');
    assert.equal(minus.hitStrand, -1);
  });

  test('its coordinates are left descending, as the record numbers them', () => {
    /*
     * hit 877..665. Sorting these into ascending order would make the hit
     * look like any other and lose the only thing that says the match is
     * inverted -- which, for somebody checking an insert's orientation, is
     * the entire question they opened the panel to answer.
     */
    assert.equal(minus.hitFrom, 877);
    assert.equal(minus.hitTo, 665);
    assert.ok(minus.hitFrom > minus.hitTo);
  });

  test('the query coordinates still ascend', () => {
    // The query is read forwards whatever the subject does.
    assert.equal(minus.queryFrom, 131);
    assert.equal(minus.queryTo, 343);
    assert.equal(minus.identity, 213);
    assert.equal(minus.alignLen, 213);
  });

  test('the other alignment on the same hit is plus', () => {
    const plus = hq.hsps.find(h => h.hitStrand === 1)!;
    assert.equal(plus.hitFrom, 1688);
    assert.equal(plus.hitTo, 2288);
  });
});

describe('two alignments on the same strand', () => {
  const ab = report.hits.find(h => h.accession === 'AB557594')!;

  test('both are plus, and both are kept', () => {
    assert.equal(ab.hsps.length, 2);
    assert.ok(ab.hsps.every(h => h.hitStrand === 1));
  });

  test('overlapping pieces are counted once', () => {
    // query 1..601 and 102..366: the second lies entirely inside the first.
    const sum = ab.hsps.reduce((a, x) => a + Math.abs(x.queryTo - x.queryFrom) + 1, 0);
    assert.equal(sum, 866);
    assert.equal(coveredBases(ab.hsps), 601);
    assert.equal(ab.coverage, 100);
  });
});

describe('what the whole report should satisfy', () => {
  test('hits come back in descending bit score', () => {
    for (let i = 1; i < report.hits.length; i++) {
      assert.ok(report.hits[i - 1].bitScore >= report.hits[i].bitScore);
    }
  });

  test('no percentage escapes its range', () => {
    for (const h of report.hits) {
      assert.ok(h.identity >= 0 && h.identity <= 100, `${h.accession} identity ${h.identity}`);
      assert.ok(h.coverage >= 0 && h.coverage <= 100, `${h.accession} coverage ${h.coverage}`);
    }
  });

  test('identities never exceed the length aligned', () => {
    for (const h of report.hits) {
      for (const x of h.hsps) assert.ok(x.identity <= x.alignLen);
    }
  });

  test('every hit carries a taxid, which is what links out to the organism', () => {
    for (const h of report.hits) assert.equal(typeof h.taxid, 'number');
  });
});
