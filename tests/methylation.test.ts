import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedSites, dormantEnzymes } from '../src/lib/methylation.ts';
import { carriesMethylation } from '../src/lib/hosts.ts';

/** GATC inside an XbaI site (TCTAGA) — the classic Dam-blocked case. */
const DAM_XBAI = 'AAAAGATCTAGATCAAAA';
/** CCWGG overlapping a StuI site (AGGCCT) — the classic Dcm case. */
const DCM_STUI = 'AAAACCAGGCCTGGAAAA';

test('a Dam site inside an XbaI site is reported when the DNA carries Dam', () => {
  const hits = blockedSites(DAM_XBAI, ['XbaI']);
  assert.ok(hits.length > 0, 'XbaI should be flagged on Dam+ DNA');
  assert.equal(hits[0].system, 'dam');
  assert.match(hits[0].message, /blocked by Dam/);
});

test('the same site is not reported when the prep came from a dam- strain', () => {
  // The GATC is still there. It simply is not methylated, which is the entire
  // reason anyone re-preps a plasmid in JM110.
  const hits = blockedSites(DAM_XBAI, ['XbaI'], { present: { dam: false } });
  assert.deepEqual(hits, []);
});

test('dcm- clears Dcm warnings and leaves Dam warnings alone', () => {
  assert.equal(blockedSites(DCM_STUI, ['StuI'], { present: { dcm: false } }).length, 0);
  // Turning off one system must not turn off the other.
  assert.ok(blockedSites(DAM_XBAI, ['XbaI'], { present: { dcm: false } }).length > 0);
});

test('an unrecorded strain gets the cautious answer', () => {
  // No `present` at all is the old behaviour, and has to stay that way: a
  // record that does not say where it came from must not read as clean.
  assert.ok(blockedSites(DAM_XBAI, ['XbaI'], {}).length > 0);
  assert.ok(blockedSites(DAM_XBAI, ['XbaI'], { present: {} }).length > 0);
});

test('DpnI goes dormant on dam- DNA, which is the trap on the way back', () => {
  // Solving the XbaI problem by prepping in JM110 breaks the DpnI digest that
  // clears template after site-directed mutagenesis.
  const dormant = dormantEnzymes(['DpnI', 'XbaI'], { dam: false });
  assert.equal(dormant.length, 1);
  assert.equal(dormant[0].enzyme, 'DpnI');
  assert.match(dormant[0].message, /will not cut/);
});

test('nothing is dormant when the methylation is there, or unrecorded', () => {
  assert.deepEqual(dormantEnzymes(['DpnI'], { dam: true }), []);
  assert.deepEqual(dormantEnzymes(['DpnI'], {}), []);
});

test('the strain taxonomy drives it end to end', () => {
  const present = (strain: string | null) => ({
    dam: carriesMethylation(strain, 'dam'),
    dcm: carriesMethylation(strain, 'dcm'),
  });
  assert.ok(blockedSites(DAM_XBAI, ['XbaI'], { present: present('dh5a') }).length > 0);
  assert.equal(blockedSites(DAM_XBAI, ['XbaI'], { present: present('jm110') }).length, 0);
  assert.equal(dormantEnzymes(['DpnI'], present('jm110'))[0].enzyme, 'DpnI');
  assert.deepEqual(dormantEnzymes(['DpnI'], present('dh5a')), []);
});
