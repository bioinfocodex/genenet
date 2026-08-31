import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { annotate } from '../src/lib/annotation.ts';
import { FEATURE_LIBRARY } from '../src/lib/features.data.ts';
import { candidatesFrom, toLibraryFeature } from '../src/lib/feature-learning.ts';
import { revComp } from '../src/lib/alignment.ts';

const filler = (seed: number, n: number) => {
  let x = seed * 7919 + 13;
  let out = '';
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out += 'ACGT'[(x >>> 16) % 4]; }
  return out;
};

const part = (name: string) => {
  const f = FEATURE_LIBRARY.find(x => x.name === name);
  if (!f) throw new Error(`no library part called ${name}`);
  return f.sequence;
};

describe('the library itself', () => {
  test('every entry is long enough for a hit to mean something', () => {
    // A specific six-mer appears by chance every few kilobases and a ten-mer
    // about once per megabase. Ten is where a hit becomes worth believing, and
    // one six-base entry was removed for failing it.
    for (const f of FEATURE_LIBRARY) {
      assert.ok(f.sequence.length >= 10, `${f.name} is only ${f.sequence.length} bases`);
    }
  });

  test('a short entry is still findable, not merely allowed', () => {
    const kozak = FEATURE_LIBRARY.find(f => f.name === 'Kozak sequence');
    assert.ok(kozak, 'the Kozak entry should still be there');
    const seq = filler(90, 300) + kozak!.sequence + filler(91, 300);
    assert.ok(
      annotate(seq).some(h => h.name === 'Kozak sequence'),
      'an entry shorter than the seed must still be looked up',
    );
  });

  test('every entry is unambiguous DNA', () => {
    for (const f of FEATURE_LIBRARY) {
      assert.match(f.sequence, /^[ACGT]+$/, `${f.name} carries something other than ACGT`);
    }
  });

  test('no two entries share a name', () => {
    const names = FEATURE_LIBRARY.map(f => f.name);
    assert.equal(new Set(names).size, names.length, 'duplicate names make a hit ambiguous');
  });
});

describe('finding parts', () => {
  test('a part is found where it was planted', () => {
    const t7 = part('T7 promoter');
    const seq = filler(1, 300) + t7 + filler(2, 300);
    const hits = annotate(seq);
    const hit = hits.find(h => h.name === 'T7 promoter');
    assert.ok(hit, `not found among: ${hits.map(h => h.name).join(', ') || 'nothing'}`);
    assert.equal(hit!.start, 301);
    assert.equal(hit!.identity, 1);
    assert.equal(hit!.strand, 1);
  });

  test('a part on the other strand is found and marked', () => {
    const seq = filler(3, 200) + revComp(part('loxP')) + filler(4, 200);
    const hit = annotate(seq).find(h => h.name === 'loxP');
    assert.ok(hit);
    assert.equal(hit!.strand, -1);
  });

  test('every copy is found, not just the first', () => {
    // The previous detector stopped at one hit per strand, so a construct with
    // a terminator either side of its cassette showed only one.
    const lox = part('loxP');
    const seq = filler(5, 200) + lox + filler(6, 400) + lox + filler(7, 200);
    const hits = annotate(seq).filter(h => h.name === 'loxP');
    // Two copies, reported twice -- not four times. loxP's arms are inverted
    // repeats, so it also matches itself on the other strand; one physical site
    // is one annotation.
    assert.equal(hits.length, 2, `found ${hits.length}`);
    assert.notEqual(hits[0].start, hits[1].start);
  });

  test('a variant with scattered mismatches is still recognised', () => {
    // The case tolerance exists for: a part carried over from another vector,
    // differing at a few positions.
    const lox = part('loxP').split('');
    lox[3] = lox[3] === 'A' ? 'G' : 'A';
    lox[20] = lox[20] === 'C' ? 'T' : 'C';
    const seq = filler(8, 200) + lox.join('') + filler(9, 200);
    const hit = annotate(seq).find(h => h.name === 'loxP');
    assert.ok(hit, 'a two-base variant should still match');
    assert.ok(hit!.identity < 1 && hit!.identity > 0.9);
  });

  test('a mismatch in the first bases does not hide the part', () => {
    // Seeding only from the start would miss this entirely.
    const flag = part('FLAG tag').split('');
    flag[1] = flag[1] === 'A' ? 'G' : 'A';
    const seq = filler(10, 150) + flag.join('') + filler(11, 150);
    assert.ok(annotate(seq).some(h => h.name === 'FLAG tag'), 'a damaged seed should not lose the hit');
  });

  test('unrelated sequence yields nothing', () => {
    assert.deepEqual(annotate(filler(12, 3000)), []);
  });

  test('a part spanning the origin is found on a circle', () => {
    const lox = part('loxP');
    const half = Math.floor(lox.length / 2);
    const seq = lox.slice(half) + filler(13, 500) + lox.slice(0, half);
    assert.equal(annotate(seq, { circular: false }).filter(h => h.name === 'loxP').length, 0);
    assert.equal(annotate(seq, { circular: true }).filter(h => h.name === 'loxP').length, 1);
  });

  test('a stricter threshold rejects what a looser one accepts', () => {
    const lox = part('loxP').split('');
    for (const i of [2, 8, 14, 20]) lox[i] = lox[i] === 'A' ? 'G' : 'A';
    const seq = filler(14, 200) + lox.join('') + filler(15, 200);
    assert.ok(annotate(seq, { minIdentity: 0.8 }).some(h => h.name === 'loxP'));
    assert.ok(!annotate(seq, { minIdentity: 0.99 }).some(h => h.name === 'loxP'));
  });

  test('a large plasmid is annotated quickly', () => {
    // Scanning every offset for every part was O(n·m); this is the check that
    // the index is doing its job as the library grows.
    const seq = filler(16, 12000) + part('T7 promoter') + filler(17, 3000);
    const t0 = Date.now();
    const hits = annotate(seq);
    assert.ok(Date.now() - t0 < 3000, 'annotation should not take seconds');
    assert.ok(hits.some(h => h.name === 'T7 promoter'));
  });

  test('extra parts supplied by the caller are searched too', () => {
    const custom = { name: 'house vector tag', type: 'tag', color: '#000', sequence: filler(18, 40) };
    const seq = filler(19, 200) + custom.sequence + filler(20, 200);
    assert.ok(annotate(seq, { extra: [custom] }).some(h => h.name === 'house vector tag'));
    assert.ok(!annotate(seq).some(h => h.name === 'house vector tag'));
  });
});

describe('learning from an imported file', () => {
  const seq = filler(30, 100) + 'GCTAGCGGTACCTCTAGAGGATCCCTCGAG' + filler(31, 100);

  test('a part the library does not know is offered', () => {
    const c = candidatesFrom(seq, [{ name: 'house MCS', type: 'misc_feature', start: 101, end: 130 }]);
    assert.equal(c.length, 1);
    assert.equal(c[0].worthAdding, true);
    assert.equal(c[0].sequence, 'GCTAGCGGTACCTCTAGAGGATCCCTCGAG');
  });

  test('a part the library already has is not offered again', () => {
    const lox = part('loxP');
    const s = filler(32, 50) + lox + filler(33, 50);
    const c = candidatesFrom(s, [{ name: 'my lox site', type: 'misc_recomb', start: 51, end: 50 + lox.length }]);
    assert.equal(c[0].worthAdding, false);
    assert.match(c[0].reason, /Already in the library as loxP/);
  });

  test('a same-named part with different bases is offered as a variant', () => {
    const variant = part('T7 promoter').split('');
    variant[2] = variant[2] === 'A' ? 'G' : 'A';
    const s = filler(34, 50) + variant.join('') + filler(35, 50);
    const c = candidatesFrom(s, [{ name: 'T7 promoter', type: 'promoter', start: 51, end: 50 + variant.length }]);
    assert.equal(c[0].worthAdding, true);
    assert.match(c[0].reason, /variant/);
  });

  test('something too short to identify anything is refused', () => {
    const c = candidatesFrom(seq, [{ name: 'tiny', type: 'misc_feature', start: 10, end: 16 }]);
    assert.equal(c[0].worthAdding, false);
    assert.match(c[0].reason, /too short/);
  });

  test('a whole gene is refused, with the reason', () => {
    const big = filler(36, 5000);
    const c = candidatesFrom(big, [{ name: 'some ORF', type: 'CDS', start: 1, end: 4000 }]);
    assert.equal(c[0].worthAdding, false);
    assert.match(c[0].reason, /whole gene/);
  });

  test('an unnamed generic feature is refused', () => {
    const c = candidatesFrom(seq, [{ name: 'misc_feature 3', type: 'misc_feature', start: 101, end: 130 }]);
    assert.equal(c[0].worthAdding, false);
  });

  test('an accepted candidate becomes a usable library entry', () => {
    const c = candidatesFrom(seq, [{ name: 'house MCS', type: 'misc_feature', start: 101, end: 130 }]);
    const entry = toLibraryFeature(c[0]);
    assert.equal(entry.learned, true);
    assert.ok(entry.color, 'an entry needs a colour to draw with');
    // And it must then be findable.
    assert.ok(annotate(seq, { extra: [entry] }).some(h => h.name === 'house MCS'));
  });
});

describe('a learned part behaves like a shipped one', () => {
  test('once added, it is found in a sequence that carries no annotations', () => {
    // The whole point of learning: the second plasmid with the same part gets
    // it recognised without anyone annotating it by hand.
    const housePart = filler(70, 45);
    const donor = filler(71, 100) + housePart + filler(72, 100);
    const other = filler(73, 200) + housePart + filler(74, 200);

    // Nothing knows it yet.
    assert.equal(annotate(other).length, 0);

    const [candidate] = candidatesFrom(donor, [
      { name: 'house part', type: 'misc_feature', start: 101, end: 145 },
    ]);
    assert.equal(candidate.worthAdding, true);

    const learned = toLibraryFeature(candidate);
    const hits = annotate(other, { extra: [learned] });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].name, 'house part');
    assert.equal(hits[0].identity, 1);
  });

  test('a learned part is found in a variant too, as a shipped one would be', () => {
    const housePart = filler(75, 45);
    const donor = filler(76, 100) + housePart + filler(77, 100);
    const [candidate] = candidatesFrom(donor, [
      { name: 'house part', type: 'misc_feature', start: 101, end: 145 },
    ]);
    const learned = toLibraryFeature(candidate);

    const varied = housePart.split('');
    varied[5] = varied[5] === 'A' ? 'G' : 'A';
    varied[30] = varied[30] === 'C' ? 'T' : 'C';
    const other = filler(78, 150) + varied.join('') + filler(79, 150);

    const hits = annotate(other, { extra: [learned] });
    assert.equal(hits.length, 1, 'tolerance should apply to learned parts as well');
    assert.ok(hits[0].identity < 1);
  });
});
