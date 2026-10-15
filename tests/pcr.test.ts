import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simulatePcr } from '../src/lib/pcr.ts';
import { revComp } from '../src/lib/alignment.ts';
import { makeSeq } from './support/sequences.ts';

const T = makeSeq(3000, 5);

/** The primer pair that amplifies template[from..to], 1-based inclusive. */
const pair = (from: number, to: number, len = 22) => ({
  fwd: T.slice(from - 1, from - 1 + len),
  rev: revComp(T.slice(to - len, to)),
});

describe('a well-behaved pair', () => {
  const { fwd, rev } = pair(500, 1200);

  test('gives one product, of the span between the primers', () => {
    const r = simulatePcr(T, fwd, rev);
    assert.equal(r.products.length, 1);
    const p = r.products[0];
    assert.equal(p.start, 500);
    assert.equal(p.end, 1200);
    assert.equal(p.size, 701);
    assert.equal(p.sequence, T.slice(499, 1200));
    assert.ok(p.exact);
    assert.ok(!r.warnings.some(w => /products|anneals at/.test(w)), 'nothing about extra bands');
  });

  test('primers pointing away from each other give nothing, and say why', () => {
    // Facing outward: the rightward site lies downstream of the leftward one,
    // so the polymerase runs off both ends. Swapping which primer is called
    // "forward" would not do this -- that changes the labels, not the
    // chemistry, and the pair still amplifies the same span.
    const outward = simulatePcr(T, T.slice(1999, 2021), revComp(T.slice(478, 500)));
    assert.equal(outward.products.length, 0);
    assert.match(outward.problem!, /point away from each other/);

    const relabelled = simulatePcr(T, rev, fwd);
    assert.equal(relabelled.products.length, 1, 'the same product, whatever the two are called');
    assert.equal(relabelled.products[0].size, 701);
  });

  test('a primer that is not there is reported as not annealing', () => {
    const r = simulatePcr(T, 'ACGT'.repeat(6), rev);
    assert.equal(r.products.length, 0);
    assert.match(r.problem!, /anneal/);
  });
});

describe('primers with tails', () => {
  test("a 5′ tail is carried into the product, and does not stop the primer being found", () => {
    // What every cloning method here produces. A full-length search finds none
    // of these, which was the old simulation's blind spot.
    const { fwd, rev } = pair(800, 1400);
    const fTail = 'GCGCGAATTCGC';
    const rTail = 'GCGCGGATCCGC';
    const r = simulatePcr(T, fTail + fwd, rTail + rev);
    assert.equal(r.products.length, 1);
    const p = r.products[0];
    assert.equal(p.sequence, fTail + T.slice(799, 1400) + revComp(rTail));
    assert.equal(p.size, 601 + fTail.length + rTail.length);
    assert.equal(p.exact, false, 'the whole oligo does not match the template');
    assert.equal(p.mismatches, 0, 'but nothing is mismatched: a tail is meant to be there');
  });
});

describe('what else comes out of the tube', () => {
  test('a primer annealing twice gives two products, both reported', () => {
    // Plant the forward primer's site a second time, upstream.
    const { fwd, rev } = pair(1500, 2000);
    const template = T.slice(0, 600) + fwd + T.slice(600);
    const r = simulatePcr(template, fwd, rev);
    assert.equal(r.products.length, 2);
    assert.ok(r.products[0].size < r.products[1].size, 'shortest first');
    assert.ok(r.warnings.some(w => /2 products/.test(w)));
    assert.ok(r.warnings.some(w => /anneals at 2 places/.test(w)));
  });

  test('without mismatches allowed, a near-site gives nothing; with them, it gives a product', () => {
    const { fwd, rev } = pair(900, 1500);
    // A second forward site with one mismatch well away from the 3' end.
    const near = fwd.slice(0, 4) + (fwd[4] === 'A' ? 'C' : 'A') + fwd.slice(5);
    const template = T.slice(0, 300) + near + T.slice(300);

    const strict = simulatePcr(template, fwd, rev);
    assert.equal(strict.products.length, 1, 'only the perfect site');

    const tolerant = simulatePcr(template, fwd, rev, { maxMismatches: 1, minAnneal: 12 });
    assert.equal(tolerant.products.length, 2);
    const offTarget = tolerant.products.find(p => p.mismatches > 0)!;
    assert.ok(offTarget, 'the mismatched site makes a product too');
    assert.ok(tolerant.warnings.some(w => /mismatches/.test(w)));
  });

  test('one primer can amplify on its own when it anneals to both strands', () => {
    const p = T.slice(400, 422);
    const template = T.slice(0, 1000) + revComp(p) + T.slice(1000);
    const r = simulatePcr(template, p, p);
    assert.ok(r.products.length >= 1);
    assert.equal(r.products[0].start, 401);
  });
});

describe('circular templates', () => {
  const plasmid = makeSeq(2400, 9);

  test('a product running through the origin is continuous', () => {
    const fwd = plasmid.slice(2200, 2222);
    const rev = revComp(plasmid.slice(200, 222));
    const r = simulatePcr(plasmid, fwd, rev, { circular: true });
    const p = r.products.find(x => x.wrapsOrigin)!;
    assert.ok(p, 'the product across the join is found');
    assert.equal(p.sequence, plasmid.slice(2200) + plasmid.slice(0, 222));
    assert.equal(p.start, 2201);
    assert.equal(p.end, 222);
  });

  test('the same pair on a linear template gives nothing: the ends are not joined', () => {
    const fwd = plasmid.slice(2200, 2222);
    const rev = revComp(plasmid.slice(200, 222));
    assert.equal(simulatePcr(plasmid, fwd, rev, { circular: false }).products.length, 0);
  });

  test('a product longer than the ceiling is left out', () => {
    const fwd = plasmid.slice(100, 122);
    const rev = revComp(plasmid.slice(2300, 2322));
    assert.equal(simulatePcr(plasmid, fwd, rev, { circular: true }).products.length, 1);
    assert.equal(simulatePcr(plasmid, fwd, rev, { circular: true, maxProduct: 500 }).products.length, 0);
  });
});

describe('what the reaction is told about itself', () => {
  test('primers whose annealing temperatures are far apart are called out', () => {
    // Real slices of the template rather than invented primers: a GC-repeat
    // oligo is its own reverse complement at every other offset, so it anneals
    // all over the place and on both strands -- true of such an oligo, and
    // useless for asking about melting temperature.
    const gc = (s: string) => (s.match(/[GC]/g) ?? []).length / s.length;
    const windows = Array.from({ length: T.length - 24 }, (_, i) => ({ at: i, seq: T.slice(i, i + 24) }));
    const rich = windows.filter(w => w.at < 1000).sort((a, b) => gc(b.seq) - gc(a.seq))[0];
    const poor = windows.filter(w => w.at > 1500).sort((a, b) => gc(a.seq) - gc(b.seq))[0];

    const r = simulatePcr(T, rich.seq, revComp(poor.seq));
    assert.equal(r.products.length, 1, 'both sites are unique in a random template');
    assert.ok(gc(rich.seq) - gc(poor.seq) > 0.25, 'the two differ enough in GC to matter');
    assert.ok(r.warnings.some(w => /°C apart/.test(w)), r.warnings.join('; '));
  });

  test('each site reports the melting temperature of the part that anneals', () => {
    const { fwd, rev } = pair(500, 1100);
    const r = simulatePcr(T, 'GAATTCGCGC' + fwd, rev);
    const site = r.products[0].forward;
    // The tail is not in the template, so it is not in the Tm either.
    assert.equal(site.binding.annealLength, fwd.length);
    assert.ok(site.tm > 45 && site.tm < 75, `got ${site.tm}`);
  });
});

describe('the primers are in the product, not the template', () => {
  test('a mismatched base is carried into the product as the primer wrote it', () => {
    // This is PCR mutagenesis: the primer is extended from its own 3' end, so
    // what it carries is what the product carries. Taking the template's base
    // here would silently drop the change the primer was designed to make.
    const { fwd, rev } = pair(600, 1100);
    const mutated = fwd.slice(0, 5) + (fwd[5] === 'G' ? 'A' : 'G') + fwd.slice(6);
    const r = simulatePcr(T, mutated, rev, { maxMismatches: 1, minAnneal: 12 });
    assert.equal(r.products.length, 1);
    const p = r.products[0];
    assert.ok(p.sequence.startsWith(mutated), 'the product begins with the primer as ordered');
    assert.notEqual(p.sequence[5], T[604], 'and not with the base the template has there');
    assert.equal(p.mismatches, 1);
  });

  test('a tail is in the product exactly as written, even with mismatches allowed', () => {
    const { fwd, rev } = pair(700, 1200);
    const tail = 'GCGCGAATTCGC';
    const r = simulatePcr(T, tail + fwd, rev, { maxMismatches: 1 });
    assert.equal(r.products.length, 1);
    assert.ok(r.products[0].sequence.startsWith(tail + fwd),
      'the tail is not re-read off the template, whose bases differ from it');
  });

  test('an exact pair gives the template span, as before', () => {
    const { fwd, rev } = pair(500, 1200);
    assert.equal(simulatePcr(T, fwd, rev).products[0].sequence, T.slice(499, 1200));
  });
});
