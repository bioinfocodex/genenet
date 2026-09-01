import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseMapEnzymes, countCuts, siteLabel, siteTitle, type SiteLike,
} from '../src/lib/map-enzymes.ts';

const site = (enzyme: string, recognitionStart: number, over: Partial<SiteLike> = {}): SiteLike => ({
  enzyme,
  cutPos: recognitionStart + 1,
  recognitionStart,
  recognitionLen: 6,
  color: '#888',
  ...over,
});

test('isoschizomers at one site collapse to a single label', () => {
  // The exact cluster the map was drawing seven labels for.
  const names = ['BstSNI', 'Eco105I', 'SnaBI', 'SalI', 'AccI', 'FblI', 'XmiI'];
  const sites = names.map(n => site(n, 1200));
  const chosen = chooseMapEnzymes(sites, countCuts(sites));

  assert.equal(chosen.length, 1, 'one site, one label');
  assert.equal(chosen[0].alternatives.length, 6);
  assert.equal([chosen[0].enzyme, ...chosen[0].alternatives].sort().join(','), [...names].sort().join(','),
    'every name is still reachable, just not all drawn');
});

test('the label is stable across runs, whatever order the sites arrive in', () => {
  const names = ['BstSNI', 'Eco105I', 'SnaBI', 'SalI'];
  const a = chooseMapEnzymes(names.map(n => site(n, 100)), countCuts(names.map(n => site(n, 100))));
  const b = chooseMapEnzymes([...names].reverse().map(n => site(n, 100)), countCuts(names.map(n => site(n, 100))));
  assert.equal(a[0].enzyme, b[0].enzyme, 'a map must not rename its sites between renders');
});

test('an enzyme the caller asked for wins the label', () => {
  const names = ['BstSNI', 'Eco105I', 'SnaBI'];
  const sites = names.map(n => site(n, 300));
  const chosen = chooseMapEnzymes(sites, countCuts(sites), { prefer: ['Eco105I'] });
  assert.equal(chosen[0].enzyme, 'Eco105I');
  assert.deepEqual(chosen[0].alternatives, ['BstSNI', 'SnaBI']);
});

test('four-cutters are left off by default and come back when asked for', () => {
  const sites = [
    site('MspI', 100, { recognitionLen: 4 }),
    site('EcoRI', 500, { recognitionLen: 6 }),
  ];
  const counts = countCuts(sites);
  assert.deepEqual(chooseMapEnzymes(sites, counts).map(s => s.enzyme), ['EcoRI']);
  assert.equal(chooseMapEnzymes(sites, counts, { minSiteLength: 4 }).length, 2);
});

test('only unique cutters are drawn by default', () => {
  const sites = [
    site('EcoRI', 100), site('EcoRI', 900), site('EcoRI', 1500),   // cuts three times
    site('NotI', 400),                                              // cuts once
  ];
  const counts = countCuts(sites);
  assert.equal(counts.get('EcoRI'), 3);
  assert.deepEqual(chooseMapEnzymes(sites, counts).map(s => s.enzyme), ['NotI']);

  // Raising the ceiling brings it back, at every position it cuts.
  const loose = chooseMapEnzymes(sites, counts, { maxCuts: 3 });
  assert.equal(loose.length, 4);
});

test('a neoschizomer cutting the same site in a different place is still one site', () => {
  // Same recognition stretch, different cut position — one place to open the
  // plasmid, so one label.
  const sites = [
    site('SmaI', 800, { cutPos: 803 }),
    site('XmaI', 800, { cutPos: 801 }),
  ];
  const chosen = chooseMapEnzymes(sites, countCuts(sites));
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].alternatives.length, 1);
});

test('sites at different places stay separate', () => {
  const sites = [site('EcoRI', 100), site('BamHI', 900), site('HindIII', 2000)];
  const chosen = chooseMapEnzymes(sites, countCuts(sites));
  assert.equal(chosen.length, 3);
  assert.deepEqual(chosen.map(s => s.enzyme), ['EcoRI', 'BamHI', 'HindIII']);
});

test('results come back in position order, so labels lay out round the circle', () => {
  const sites = [site('C', 2000), site('A', 100), site('B', 900)];
  const chosen = chooseMapEnzymes(sites, countCuts(sites));
  assert.deepEqual(chosen.map(s => s.cutPos), [101, 901, 2001]);
});

test('the ceiling thins evenly rather than truncating one side of the map', () => {
  // 100 sites spread round a plasmid, capped at 10.
  const sites = Array.from({ length: 100 }, (_, i) => site(`E${i}`, i * 50));
  const chosen = chooseMapEnzymes(sites, countCuts(sites), { maxLabels: 10 });
  assert.equal(chosen.length, 10);

  // Kept sites should span the whole molecule, not stop a tenth of the way in.
  assert.ok(chosen[0].cutPos < 200, `first at ${chosen[0].cutPos}`);
  assert.ok(chosen[9].cutPos > 4000, `last at ${chosen[9].cutPos} — a truncating cap would stop near 500`);
});

test('nothing eligible gives an empty map rather than a crash', () => {
  assert.deepEqual(chooseMapEnzymes([], new Map()), []);
  const fourCutters = [site('MspI', 10, { recognitionLen: 4 })];
  assert.deepEqual(chooseMapEnzymes(fourCutters, countCuts(fourCutters)), []);
});

test('the label says how many other enzymes share the site', () => {
  const names = ['SnaBI', 'BstSNI', 'Eco105I'];
  const chosen = chooseMapEnzymes(names.map(n => site(n, 100)), countCuts(names.map(n => site(n, 100))));
  assert.match(siteLabel(chosen[0]), /\+2$/);
  assert.match(siteTitle(chosen[0]), /Same site:/);

  const lone = chooseMapEnzymes([site('NotI', 100)], countCuts([site('NotI', 100)]));
  assert.equal(siteLabel(lone[0]), 'NotI');
  assert.ok(!siteTitle(lone[0]).includes('Same site'));
});

test('cut counts are per enzyme, not per site', () => {
  const counts = countCuts([site('EcoRI', 1), site('EcoRI', 500), site('BamHI', 900)]);
  assert.equal(counts.get('EcoRI'), 2);
  assert.equal(counts.get('BamHI'), 1);
});

test('restricting to a set draws only that set', () => {
  const sites = [
    site('EcoRI', 100), site('BamHI', 500), site('BsaI', 900), site('BsmBI', 1300),
  ];
  const counts = countCuts(sites);
  const gg = chooseMapEnzymes(sites, counts, { restrictTo: ['BsaI', 'BsmBI', 'BbsI'] });
  assert.deepEqual(gg.map(s => s.enzyme), ['BsaI', 'BsmBI']);
});

test('restricting is not the same as preferring', () => {
  // Two isoschizomers at one site, one of them in the set. Preferring picks
  // the label; restricting would have dropped the other site entirely.
  const sites = [site('SnaBI', 100), site('Eco105I', 100), site('BamHI', 900)];
  const counts = countCuts(sites);

  const preferred = chooseMapEnzymes(sites, counts, { prefer: ['Eco105I'] });
  assert.equal(preferred.length, 2, 'preferring keeps every site');
  assert.equal(preferred[0].enzyme, 'Eco105I');

  const restricted = chooseMapEnzymes(sites, counts, { restrictTo: ['Eco105I'] });
  assert.equal(restricted.length, 1, 'restricting drops the site nothing in the set cuts');
  assert.equal(restricted[0].enzyme, 'Eco105I');
});

test('a set whose members cut nowhere gives an empty map, not every site', () => {
  const sites = [site('EcoRI', 100), site('BamHI', 500)];
  assert.deepEqual(chooseMapEnzymes(sites, countCuts(sites), { restrictTo: ['NotI'] }), []);
});
