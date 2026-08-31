import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleByHomology, OVERLAP_METHODS, countOccurrences, overlapPrimerFor,
} from '../src/lib/homology-cloning.ts';
import { fragmentOf } from '../src/lib/assembly.ts';
import { revComp } from '../src/lib/alignment.ts';

// Three unique 25 bp homology arms, balanced GC so no incidental warnings fire.
const H1 = 'GCTTACCGATTGCAGTTACCGATCA';
const H2 = 'TTGACCAGTTGCATACGGATCACTG';
const H3 = 'ACCGTTAAGCTTGGACATCAGTCAT';

/**
 * Non-repeating filler. A periodic sequence would share long accidental
 * homology between fragments, which the engine would correctly find and which
 * would have nothing to do with what the test meant to check.
 */
const filler = (tag: string, n: number) => {
  let x = tag.charCodeAt(0) * 7919 + 13;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'[(x >>> 16) % 4];
  }
  return out;
};

const A = fragmentOf('A', 'vector',  H3 + filler('a', 200) + H1);
const B = fragmentOf('B', 'insert1', H1 + filler('b', 150) + H2);
const C = fragmentOf('C', 'insert2', H2 + filler('c', 150) + H3);

describe('homology assembly', () => {
  test('three fragments close into one circular construct', () => {
    const r = assembleByHomology([A, B, C], 'gibson');
    assert.equal(r.assemblies.length, 1, `got ${r.assemblies.length} assemblies`);
    assert.equal(r.assemblies[0].topology, 'circular');
    assert.equal(r.checks.length, 3, 'three junctions in a circular three-part assembly');
  });

  test('each homology arm appears once in the product, not twice', () => {
    const [asm] = assembleByHomology([A, B, C], 'gibson').assemblies;
    for (const h of [H1, H2, H3]) {
      assert.equal(
        countOccurrences(asm.sequence, h, true), 1,
        `${h.slice(0, 8)}… should appear exactly once`,
      );
    }
    // cores + one copy of each arm
    assert.equal(asm.sequence.length, 200 + 150 + 150 + 25 * 3);
  });

  test('every junction is reported with its measurements', () => {
    const r = assembleByHomology([A, B, C], 'gibson');
    for (const c of r.checks) {
      assert.equal(c.length, 25);
      assert.ok(c.tm > 40 && c.tm < 90, `implausible junction Tm ${c.tm}`);
      assert.ok(c.gc > 0 && c.gc < 1);
      assert.equal(c.occurrences, 1);
    }
  });

  test('a clean assembly raises no junction warnings', () => {
    const r = assembleByHomology([A, B, C], 'gibson');
    const all = r.checks.flatMap(c => c.warnings);
    assert.deepEqual(all, [], `unexpected warnings: ${all.join(' | ')}`);
  });
});

describe('the check a protocol cannot give you', () => {
  test('a homology arm repeated elsewhere in the construct is flagged', () => {
    // H1 also sits in the middle of insert2. The assembly is still unique --
    // an internal copy is not an end, so it creates no alternative join -- but
    // the reaction cannot tell the two copies apart, and the colonies show it.
    const Cdup = fragmentOf('C', 'insert2', H2 + filler('c', 60) + H1 + filler('d', 60) + H3);
    const r = assembleByHomology([A, B, Cdup], 'gibson');

    assert.equal(r.assemblies.length, 1, 'the arrangement is still unambiguous');
    const hit = r.checks.find(c => c.overlap === H1);
    assert.ok(hit, 'the H1 junction should be present');
    assert.equal(hit!.occurrences, 2);
    assert.ok(
      hit!.warnings.some(w => /occurs 2 times/.test(w)),
      `expected a repeat warning, got: ${hit!.warnings.join(' | ')}`,
    );
  });

  test('occurrences are counted on both strands', () => {
    const seq = 'AAAA' + H1 + 'TTTT' + revComp(H1) + 'GGGG';
    assert.equal(countOccurrences(seq, H1, false), 2, 'the reverse complement is the same site');
  });

  test('occurrences wrap around a circle', () => {
    const half = H1.slice(0, 12), rest = H1.slice(12);
    // The arm straddles the origin: present in the molecule, invisible to a
    // linear search.
    const circle = rest + 'ACGTACGTACGTACGT' + half;
    assert.equal(countOccurrences(circle, H1, false), 0);
    assert.equal(countOccurrences(circle, H1, true), 1);
  });
});

describe('method requirements', () => {
  test('In-Fusion wants exactly 15 bp and says so about a longer arm', () => {
    const r = assembleByHomology([A, B, C], 'infusion');
    assert.equal(r.spec.name, 'In-Fusion');
    assert.equal(r.assemblies.length, 1, 'a longer arm still assembles; In-Fusion tolerates it');
    const tooLong = r.checks.flatMap(c => c.warnings).filter(w => /beyond what|longer than/.test(w));
    assert.equal(tooLong.length, 3, '25 bp is more than In-Fusion asks for, on all three junctions');
  });

  test('NEBuilder accepts arms Gibson would call short', () => {
    assert.equal(OVERLAP_METHODS.nebuilder.min, 16);
    assert.ok(OVERLAP_METHODS.nebuilder.min > OVERLAP_METHODS.gibson.min);
  });

  test('homology below a method\'s floor is not an assembly at all', () => {
    const short = 'GCTTACCGATT';                       // 11 bp
    const X = fragmentOf('X', 'X', filler('x', 80) + short);
    const Y = fragmentOf('Y', 'Y', short + filler('y', 80));
    const r = assembleByHomology([X, Y], 'gibson', { topology: 'linear' });
    assert.equal(r.assemblies.length, 0);
    assert.ok(r.problems.some(p => p.kind === 'no-assembly'));
  });

  test('every method states where its numbers come from', () => {
    for (const spec of Object.values(OVERLAP_METHODS)) {
      assert.ok(spec.note.length > 20, `${spec.name} has no attribution`);
      assert.ok(spec.min <= spec.ideal[0] && spec.ideal[1] <= spec.max);
    }
  });
});

describe('junction quality', () => {
  test('an AT-rich arm is called out', () => {
    const at = 'ATATTTAAATTATAAATTTATAAAT';
    const P = fragmentOf('P', 'P', filler('p', 90) + at);
    const Q = fragmentOf('Q', 'Q', at + filler('q', 90));
    const r = assembleByHomology([P, Q], 'gibson', { topology: 'linear' });
    assert.ok(r.checks[0].warnings.some(w => /AT-rich/.test(w)), r.checks[0].warnings.join(' | '));
  });

  test('a homopolymer run is called out', () => {
    const run = 'GCTTACCGAAAAAAAGCAGTTACC';
    const P = fragmentOf('P', 'P', filler('p', 90) + run);
    const Q = fragmentOf('Q', 'Q', run + filler('q', 90));
    const r = assembleByHomology([P, Q], 'gibson', { topology: 'linear' });
    assert.ok(r.checks[0].warnings.some(w => /homopolymer/.test(w)), r.checks[0].warnings.join(' | '));
  });

  test('junctions that melt far apart are reported together', () => {
    // One AT-rich arm and one GC-rich arm: the weak junction sets the yield.
    const weak = 'ATATTTAAATTATAAATTTATAAAT';
    const strong = 'GCGCGGCCGCGGCCGCGCGGCCGCG';
    const V = fragmentOf('V', 'V', strong + filler('v', 120) + weak);
    const I = fragmentOf('I', 'I', weak + filler('i', 120) + strong);
    const r = assembleByHomology([V, I], 'gibson');
    assert.ok(r.tmSpread > 10, `spread was only ${r.tmSpread}`);
    assert.ok(r.problems.some(p => /melting temperatures span/.test(p.message)));
  });
});

describe('primers that carry the homology', () => {
  test('the oligo is the tail plus the annealing sequence', () => {
    const p = overlapPrimerFor(B.seq, H1, { annealLength: 20 });
    assert.equal(p.sequence, p.tail + p.anneals);
    assert.equal(p.tail, H1);
    assert.equal(p.anneals.length, 20);
    assert.ok(B.seq.startsWith(p.anneals), 'the annealing half must match the template');
  });

  test('only the annealing half sets the extension temperature', () => {
    const p = overlapPrimerFor(B.seq, H1, { annealLength: 20 });
    // The tail does not anneal on the first cycle, so including it in the Tm
    // is how people end up running PCR far too hot.
    assert.ok(Math.abs(p.tmAnneal - 60) < 20);
    assert.ok(p.sequence.length > p.anneals.length);
  });

  test('a reverse primer anneals to the other strand', () => {
    const p = overlapPrimerFor(B.seq, H2, { annealLength: 20, direction: 'reverse' });
    assert.ok(B.seq.endsWith(revComp(p.anneals)));
  });
});
