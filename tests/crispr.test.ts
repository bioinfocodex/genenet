import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findGuides, findOffTargets, scoreOnTarget, hsuScore, specificityScore,
  NUCLEASES,
} from '../src/lib/crispr.ts';

/**
 * Guide design.
 *
 * The coordinates are the part worth testing hardest. A guide reported one base
 * off cuts somewhere else, and nothing about the output would look wrong -- the
 * protospacer still reads correctly, the PAM is still there, the score is still
 * plausible.
 */

describe('finding guides', () => {
  test('finds a protospacer with its NGG PAM', () => {
    // 20 nt protospacer, then AGG.
    const proto = 'ACGTACGTACGTACGTACGT';
    const seq = 'TTTTT' + proto + 'AGG' + 'TTTTT';
    const guides = findGuides(seq);
    const hit = guides.find(g => g.protospacer === proto && g.strand === '+');
    assert.ok(hit, `expected to find ${proto}; got ${guides.map(g => g.protospacer).join(', ')}`);
    assert.equal(hit.pam, 'AGG');
    assert.equal(hit.start, 5, 'protospacer should start after the 5 T prefix');
    assert.equal(hit.end, 25);
  });

  test('the PAM really follows the protospacer in the sequence', () => {
    // The check that catches an off-by-one: read the coordinates back out of
    // the original sequence and confirm they say what the guide claims.
    const seq = 'GGATCCACGTACGTACGTACGTAGGTTACGCATGCATGCATGCATGCTGGAATTCC';
    for (const g of findGuides(seq)) {
      if (g.strand !== '+') continue;
      assert.equal(seq.slice(g.start, g.end), g.protospacer,
        `protospacer at ${g.start}..${g.end} does not match the sequence`);
      assert.equal(seq.slice(g.end, g.end + 3), g.pam,
        `PAM does not immediately follow the protospacer at ${g.end}`);
    }
  });

  test('reverse-strand coordinates say what the guide claims', () => {
    // The strongest check available without a second implementation: read the
    // reported span back out of the forward strand, reverse complement it, and
    // require it to be the protospacer -- with the PAM immediately before the
    // span, since a reverse guide's PAM is upstream in forward coordinates.
    const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
    const rc = (x: string) => x.split('').reverse().map(c => COMP[c] ?? 'N').join('');
    const seq = 'GGATCCACGTTGCATGCATGCATGCATGCCTAGGCATGCATCCGATCGATCGATCGATCGTAGGCCTAACGT';

    const reverse = findGuides(seq).filter(g => g.strand === '-');
    assert.ok(reverse.length > 0, 'expected reverse-strand guides in this sequence');

    for (const g of reverse) {
      assert.equal(g.end - g.start, 20);
      assert.equal(rc(seq.slice(g.start, g.end)), g.protospacer,
        `protospacer at ${g.start}..${g.end} is not the reverse complement of that span`);
      assert.equal(rc(seq.slice(g.start - 3, g.start)), g.pam,
        `PAM for the reverse guide at ${g.start} is not immediately upstream`);
    }
  });

  test('SpCas9 cuts three bases from the PAM', () => {
    const proto = 'ACGTACGTACGTACGTACGT';
    const seq = 'TTTTT' + proto + 'AGG' + 'TTTTT';
    const g = findGuides(seq).find(x => x.protospacer === proto && x.strand === '+')!;
    // Protospacer spans 5..25, PAM at 25. Blunt cut 3 bp 5' of the PAM.
    assert.equal(g.cutSite, 22);
  });

  test('a region restricts guides to those cutting inside it', () => {
    const seq = 'ACGTACGTACGTACGTACGTAGG'.repeat(6);
    const all = findGuides(seq);
    const windowed = findGuides(seq, { region: { start: 40, end: 80 } });
    assert.ok(windowed.length < all.length, 'the window should exclude some guides');
    for (const g of windowed) {
      assert.ok(g.cutSite >= 40 && g.cutSite < 80,
        `guide cuts at ${g.cutSite}, outside the requested 40..80`);
    }
  });

  test('a sequence with no PAM yields no guides', () => {
    assert.equal(findGuides('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').length, 0);
  });

  test('protospacers never contain ambiguous bases', () => {
    const seq = 'ACGTNNNNACGTACGTACGTACGTAGGACGTACGTACGTACGTACGTCGG';
    for (const g of findGuides(seq)) {
      assert.ok(!/[^ACGT]/.test(g.protospacer), `ambiguous base in ${g.protospacer}`);
    }
  });

  test('Cas12a uses a 5-prime PAM and a longer protospacer', () => {
    const spec = NUCLEASES.Cas12a;
    assert.equal(spec.pamSide, "5'");
    const proto = 'ACGTACGTACGTACGTACGTACG'; // 23 nt
    const seq = 'GGGG' + 'TTTA' + proto + 'GGGG';
    const g = findGuides(seq, { nuclease: 'Cas12a' }).find(x => x.protospacer === proto);
    assert.ok(g, 'expected a Cas12a guide');
    assert.equal(g.pam, 'TTTA');
    assert.equal(g.protospacer.length, 23);
  });
});

describe('on-target scoring', () => {
  test('a poly-T run is treated as disqualifying', () => {
    // TTTT terminates Pol III transcription: the guide is often not made at all.
    const bad = scoreOnTarget('ACGTTTTACGTACGTACGTA');
    assert.ok(bad.score < 45, `expected a low score, got ${bad.score}`);
    assert.ok(bad.reasons.some(r => /Pol III/.test(r.rule)), 'the reason should say why');
  });

  test('a balanced guide scores well', () => {
    const good = scoreOnTarget('ACGTACGTGCATGCATGCAG');
    assert.ok(good.score >= 90, `expected a high score, got ${good.score}: ` +
      good.reasons.map(r => `${r.rule} ${r.delta}`).join(', '));
  });

  test('extreme GC content is penalised at both ends', () => {
    const low = scoreOnTarget('ATATATATATATATATATAT');
    const high = scoreOnTarget('GCGCGCGCGCGCGCGCGCGC');
    assert.ok(low.score < 90, `AT-rich should be penalised, got ${low.score}`);
    assert.ok(high.score < 90, `GC-rich should be penalised, got ${high.score}`);
    assert.ok(low.reasons.some(r => r.rule === 'GC content'));
  });

  test('every penalty explains itself', () => {
    const s = scoreOnTarget('TTTTTTTTTTTTTTTTTTTT');
    assert.ok(s.reasons.length > 0);
    for (const r of s.reasons) {
      assert.ok(r.detail.length > 10, `reason "${r.rule}" has no usable explanation`);
      assert.equal(typeof r.delta, 'number');
    }
  });

  test('the score stays within 0 and 100', () => {
    for (const g of ['TTTTTTTTTTTTTTTTTTTT', 'ACGTACGTGCATGCATGCAG', 'GGGGGGGGGGGGGGGGGGGG']) {
      const s = scoreOnTarget(g);
      assert.ok(s.score >= 0 && s.score <= 100, `${g} scored ${s.score}`);
    }
  });

  test('GC fraction is reported', () => {
    assert.equal(scoreOnTarget('GGGGGCCCCCGGGGGCCCCC').gc, 1);
    assert.equal(scoreOnTarget('AAAAATTTTTAAAAATTTTT').gc, 0);
  });
});

describe('Hsu off-target scoring', () => {
  test('a perfect match scores 1', () => {
    assert.equal(hsuScore([]), 1);
  });

  test('a mismatch near the PAM costs more than one far from it', () => {
    // The seed region next to the PAM is what determines cutting, which is the
    // whole reason the Hsu weights are not uniform.
    const nearPam = hsuScore([19]);
    const farFromPam = hsuScore([0]);
    assert.ok(nearPam < farFromPam,
      `a PAM-proximal mismatch (${nearPam}) should score below a distal one (${farFromPam})`);
  });

  test('more mismatches score lower', () => {
    assert.ok(hsuScore([10, 11, 12]) < hsuScore([10, 11]));
    assert.ok(hsuScore([10, 11]) < hsuScore([10]));
  });

  test('scores stay within 0 and 1', () => {
    for (const mm of [[], [0], [19], [0, 19], [5, 10, 15], [1, 2, 3, 4, 5]]) {
      const s = hsuScore(mm);
      assert.ok(s >= 0 && s <= 1, `${JSON.stringify(mm)} scored ${s}`);
    }
  });

  test('specificity falls as off-targets accumulate', () => {
    const none = specificityScore([]);
    assert.equal(none, 1);
    const one = specificityScore([{ score: 0.5 } as never]);
    const many = specificityScore([{ score: 0.5 }, { score: 0.5 }, { score: 0.5 }] as never);
    assert.ok(one < none);
    assert.ok(many < one);
    assert.ok(many > 0);
  });
});

describe('finding off-targets', () => {
  const proto = 'ACGTACGTACGTACGTACGT';

  test('an exact second copy is found', () => {
    const decoy = 'TTTTT' + proto + 'CGG' + 'TTTTT';
    const hits = findOffTargets(proto, NUCLEASES.SpCas9, [{ name: 'decoy', sequence: decoy }], 3);
    assert.ok(hits.some(h => h.mismatches === 0), 'expected a perfect off-target match');
  });

  test('a near match within the budget is found and counted', () => {
    const near = proto.slice(0, 5) + 'T' + proto.slice(6); // one substitution
    const decoy = 'TTTTT' + near + 'CGG' + 'TTTTT';
    const hits = findOffTargets(proto, NUCLEASES.SpCas9, [{ name: 'decoy', sequence: decoy }], 3);
    const hit = hits.find(h => h.protospacer === near);
    assert.ok(hit, 'expected the one-mismatch site');
    assert.equal(hit.mismatches, 1);
    assert.deepEqual(hit.mismatchPositions, [5]);
  });

  test('a site beyond the mismatch budget is not reported', () => {
    const far = 'TTTTTTTTTTGGGGGGGGGG';
    const decoy = 'AAAAA' + far + 'CGG' + 'AAAAA';
    const hits = findOffTargets(proto, NUCLEASES.SpCas9, [{ name: 'decoy', sequence: decoy }], 3);
    assert.equal(hits.filter(h => h.protospacer === far).length, 0);
  });

  test('a guide unique in its own sequence has full specificity', () => {
    const seq = 'TTTTT' + proto + 'AGG' + 'CCCCCCCCCCCCCCCCCCCCCCCC';
    const g = findGuides(seq).find(x => x.protospacer === proto)!;
    assert.equal(g.offTargets.length, 0, JSON.stringify(g.offTargets));
    assert.equal(g.specificity, 1);
  });

  test('a repeated guide loses specificity', () => {
    // The same protospacer twice: each copy can cut the other site.
    const seq = 'TTTTT' + proto + 'AGG' + 'TTTTT' + proto + 'CGG' + 'TTTTT';
    const g = findGuides(seq).find(x => x.protospacer === proto)!;
    assert.ok(g.offTargets.length >= 1, 'the second copy should appear as an off-target');
    assert.ok(g.specificity < 1, `expected reduced specificity, got ${g.specificity}`);
  });

  test('the guide does not report itself as its own off-target', () => {
    const seq = 'TTTTT' + proto + 'AGG' + 'CCCCCCCCCC';
    const g = findGuides(seq).find(x => x.protospacer === proto)!;
    assert.ok(!g.offTargets.some(o => o.position === g.start && o.strand === g.strand),
      'the intended site was counted as an off-target');
  });

  test('off-targets can be searched across other sequences', () => {
    const target = 'TTTTT' + proto + 'AGG' + 'TTTTT';
    const elsewhere = 'GGGGG' + proto + 'TGG' + 'GGGGG';
    const g = findGuides(target, {
      searchSpace: [
        { name: 'target', sequence: target },
        { name: 'another plasmid', sequence: elsewhere },
      ],
    }).find(x => x.protospacer === proto)!;
    assert.ok(g.offTargets.some(o => o.sequenceName === 'another plasmid'),
      'should find the copy in the other sequence');
  });
});

describe('ranking', () => {
  test('guides come back best first', () => {
    const seq = 'ACGTACGTGCATGCATGCAGTGG' + 'ACGTTTTACGTACGTACGTATGG' + 'GCATGCATGCATGCATGCATCGG';
    const guides = findGuides(seq);
    assert.ok(guides.length >= 2);
    for (let i = 1; i < guides.length; i++) {
      const prev = guides[i - 1].specificity * guides[i - 1].onTarget.score;
      const cur = guides[i].specificity * guides[i].onTarget.score;
      assert.ok(prev >= cur, `guide ${i} ranks above guide ${i - 1}`);
    }
  });

  test('limit caps the result', () => {
    const seq = 'ACGTACGTACGTACGTACGTAGG'.repeat(8);
    assert.ok(findGuides(seq, { limit: 3 }).length <= 3);
  });
});
