import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { locatePrimer, locatePrimers } from '../src/lib/primers.ts';
import { reverseComplement } from '../src/lib/simulation.ts';

//            1         2         3         4
//   1234567890123456789012345678901234567890
const T = 'ATGGCGAATTCCTTGGACCATGGTCCAAGGAATTCGCAT';

describe('locating a primer on a template', () => {
  test('a forward primer is found where it appears', () => {
    const sites = locatePrimer(T, 'GGACCATGG', 'forward');
    assert.equal(sites.length, 1);
    // 1-indexed inclusive: verify by slicing the template back out.
    const { start, end, strand } = sites[0];
    assert.equal(T.slice(start - 1, end), 'GGACCATGG');
    assert.equal(strand, 1);
  });

  test('a reverse primer is found by its reverse complement', () => {
    const region = T.slice(9, 20);                 // 0-indexed 9..19
    const primer = reverseComplement(region);      // what would be ordered
    const sites = locatePrimer(T, primer, 'reverse');
    assert.equal(sites.length, 1);
    assert.equal(sites[0].start, 10);              // 1-indexed
    assert.equal(sites[0].end, 20);
    assert.equal(sites[0].strand, -1);
    assert.equal(T.slice(sites[0].start - 1, sites[0].end), region);
  });

  test('a primer that anneals twice reports both sites', () => {
    const sites = locatePrimer(T, 'GAATTC', 'forward');
    assert.equal(sites.length, 2, 'GAATTC occurs twice in the template');
    for (const s of sites) assert.equal(T.slice(s.start - 1, s.end), 'GAATTC');
    assert.ok(sites[0].start < sites[1].start, 'sites come back in order');
  });

  test('a primer that does not anneal is not placed somewhere plausible', () => {
    assert.deepEqual(locatePrimer(T, 'TTTTTTTTTTTT', 'forward'), []);
  });

  test('a mutagenesis primer with a mismatch is not silently placed', () => {
    // GGACCATGG with the middle base changed: it anneals in reality, but not
    // exactly, and guessing where would be worse than saying nothing.
    assert.deepEqual(locatePrimer(T, 'GGACAATGG', 'forward'), []);
  });

  test('case and whitespace in the stored sequence do not matter', () => {
    assert.deepEqual(
      locatePrimer(T, ' ggacc atgg ', 'forward'),
      locatePrimer(T, 'GGACCATGG', 'forward'),
    );
  });

  test('a primer longer than the template is not a match', () => {
    assert.deepEqual(locatePrimer('ATGC', 'ATGCATGCATGC', 'forward'), []);
  });

  test('empty inputs are handled rather than thrown on', () => {
    assert.deepEqual(locatePrimer('', 'ATGC', 'forward'), []);
    assert.deepEqual(locatePrimer(T, '', 'forward'), []);
  });
});

describe('locating a set', () => {
  const primers = [
    { name: 'fwd',    sequence: 'GGACCATGG',                        direction: 'forward' },
    { name: 'rev',    sequence: reverseComplement('CCTTGGACCATGG'), direction: 'reverse' },
    { name: 'twice',  sequence: 'GAATTC',                           direction: 'forward' },
    { name: 'absent', sequence: 'TTTTTTTTTTTT',                     direction: 'forward' },
  ];

  test('locatable primers come back with sites, the rest are reported', () => {
    const { located, unlocated } = locatePrimers(T, primers);
    assert.equal(unlocated.length, 1);
    assert.equal(unlocated[0].name, 'absent');
    // fwd 1 + rev 1 + twice 2
    assert.equal(located.length, 4);
  });

  test('every returned site really contains that primer', () => {
    const { located } = locatePrimers(T, primers);
    for (const { primer, site } of located) {
      const onTemplate = T.slice(site.start - 1, site.end);
      const expected = primer.direction === 'reverse'
        ? reverseComplement(primer.sequence.toUpperCase())
        : primer.sequence.toUpperCase();
      assert.equal(onTemplate, expected, `${primer.name} at ${site.start}-${site.end}`);
    }
  });

  test('nothing is lost or invented', () => {
    const { located, unlocated } = locatePrimers(T, primers);
    const names = new Set([...located.map(l => l.primer.name), ...unlocated.map(p => p.name)]);
    assert.deepEqual([...names].sort(), ['absent', 'fwd', 'rev', 'twice']);
  });
});
