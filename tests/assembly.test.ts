import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble, fragmentOf, sticky, blunt, flip, endsJoin, overlapLength,
  canonicalCircular, canonicalLinear,
  type Fragment,
} from '../src/lib/assembly.ts';
import { revComp } from '../src/lib/alignment.ts';

/** A fragment with a defined core and sticky ends. */
const frag = (id: string, seq: string, left = blunt(), right = blunt()): Fragment =>
  ({ id, name: id, seq, left, right });

describe('ends', () => {
  test("a 5' overhang anneals to its reverse complement", () => {
    assert.equal(endsJoin(sticky("5'", 'GGAG'), sticky("5'", 'CTCC'), false), true);
  });

  test('an overhang does not anneal to a copy of itself unless it is palindromic', () => {
    assert.equal(endsJoin(sticky("5'", 'GGAG'), sticky("5'", 'GGAG'), false), false);
    // GATC is its own reverse complement, which is why BamHI ends self-ligate.
    assert.equal(endsJoin(sticky("5'", 'GATC'), sticky("5'", 'GATC'), false), true);
  });

  test("a 5' overhang never anneals to a 3' overhang", () => {
    assert.equal(endsJoin(sticky("5'", 'GGAG'), sticky("3'", 'CTCC'), false), false);
  });

  test('blunt ends join only when blunt ligation is allowed', () => {
    assert.equal(endsJoin(blunt(), blunt(), false), false);
    assert.equal(endsJoin(blunt(), blunt(), true), true);
  });
});

describe('flipping a fragment', () => {
  test('the ends swap sides and the sequence is reverse-complemented', () => {
    const f = frag('a', 'ATGGGC', sticky("5'", 'AAAA'), sticky("5'", 'TTTT'));
    const r = flip(f);
    assert.equal(r.seq, revComp('ATGGGC'));
    assert.equal(r.left.overhang, 'TTTT', 'the old right end is now on the left');
    assert.equal(r.right.overhang, 'AAAA');
  });

  test('overhang sequences are not rewritten', () => {
    // Each overhang is written along the strand carrying it, so flipping the
    // molecule leaves the string alone. Rewriting it here would make half of
    // all orientations silently fail to match.
    const f = frag('a', 'ATGC', sticky("5'", 'GGAG'), sticky("3'", 'CTCC'));
    const r = flip(f);
    assert.equal(r.right.overhang, 'GGAG');
    assert.equal(r.left.overhang, 'CTCC');
    assert.equal(r.left.type, "3'", 'a 3-prime overhang stays a 3-prime overhang');
  });

  test('flipping twice is the identity', () => {
    const f = frag('a', 'ATGGGCTTA', sticky("5'", 'AAAA'), sticky("3'", 'GGCC'));
    const back = flip(flip(f));
    assert.deepEqual(back, f);
  });
});

describe('sticky-end assembly', () => {
  // Three fragments, all overhangs distinct, exactly one circular arrangement.
  const A = frag('A', 'AAAAAAAAAAAA', sticky("5'", 'TTCG'), sticky("5'", 'GGAG'));
  const B = frag('B', 'CCCCCCCCCCCC', sticky("5'", 'CTCC'), sticky("5'", 'ATTG'));
  const C = frag('C', 'GGGGGGGGGGGG', sticky("5'", 'CAAT'), sticky("5'", 'CGAA'));

  test('three fragments give exactly one circular construct', () => {
    const r = assemble([A, B, C], { mode: 'overhang', topology: 'circular' });
    assert.equal(r.assemblies.length, 1, `expected one assembly, got ${r.assemblies.length}`);
    assert.equal(r.problems.filter(p => p.kind === 'multiple-assemblies').length, 0);
  });

  test('the product carries every fragment and every junction once', () => {
    const [asm] = assemble([A, B, C], { mode: 'overhang', topology: 'circular' }).assemblies;
    for (const core of [A.seq, B.seq, C.seq]) {
      const doubled = asm.sequence + asm.sequence;   // circular: it may wrap
      assert.ok(doubled.includes(core) || doubled.includes(revComp(core)), 'a fragment is missing');
    }
    assert.equal(asm.junctions.length, 3, 'a circular three-part assembly has three joins');
    assert.equal(asm.topology, 'circular');
  });

  test('the product length is the cores plus each shared overhang once', () => {
    const [asm] = assemble([A, B, C], { mode: 'overhang', topology: 'circular' }).assemblies;
    // 3 x 12 bases of core, plus 3 junctions of 4 shared bases.
    assert.equal(asm.sequence.length, 12 * 3 + 4 * 3);
  });

  test('a fragment supplied backwards is still placed', () => {
    const r = assemble([A, flip(B), C], { mode: 'overhang', topology: 'circular' });
    assert.equal(r.assemblies.length, 1);
    const placed = r.assemblies[0].order.find(p => p.fragmentId === 'B');
    assert.ok(placed, 'B was dropped');
    assert.equal(placed!.flipped, true, 'B had to be turned round to fit');
  });

  test('incompatible ends produce no assembly and say so', () => {
    const lone = frag('X', 'TTTTTTTT', sticky("5'", 'AAAA'), sticky("5'", 'AAAA'));
    const r = assemble([A, B, lone], { mode: 'overhang', topology: 'circular' });
    assert.equal(r.assemblies.length, 0);
    assert.ok(r.problems.some(p => p.kind === 'no-assembly'));
  });

  test('a repeated overhang is reported as ambiguous', () => {
    // Two fragments offering the same end: the reaction cannot tell them apart.
    const D = frag('D', 'TATATATATATA', sticky("5'", 'CTCC'), sticky("5'", 'ATTG'));
    const r = assemble([A, B, C, D], { mode: 'overhang', topology: 'circular' });
    assert.ok(
      r.problems.some(p => p.kind === 'ambiguous-end'),
      'a duplicated overhang must be called out',
    );
  });

  test('a palindromic overhang is reported', () => {
    const P = frag('P', 'ACGTACGT', sticky("5'", 'GATC'), sticky("5'", 'GATC'));
    const Q = frag('Q', 'TGCATGCA', sticky("5'", 'GATC'), sticky("5'", 'GATC'));
    const r = assemble([P, Q], { mode: 'overhang', topology: 'circular' });
    assert.ok(
      r.problems.some(p => p.kind === 'palindromic-overhang'),
      'GATC ligates to itself; that has to be said',
    );
  });

  test('two fragments can close a circle', () => {
    const V = frag('V', 'AAAAAAAA', sticky("5'", 'TTCG'), sticky("5'", 'GGAG'));
    const I = frag('I', 'CCCCCCCC', sticky("5'", 'CTCC'), sticky("5'", 'CGAA'));
    const r = assemble([V, I], { mode: 'overhang', topology: 'circular' });
    assert.equal(r.assemblies.length, 1);
    assert.equal(r.assemblies[0].sequence.length, 8 + 8 + 4 + 4);
  });

  test('a linear assembly does not close, and has one junction fewer', () => {
    const r = assemble([A, B, C], { mode: 'overhang', topology: 'linear' });
    assert.ok(r.assemblies.length >= 1);
    const asm = r.assemblies[0];
    assert.equal(asm.topology, 'linear');
    assert.equal(asm.junctions.length, 2, 'three fragments in a line have two joins');
  });
});

describe('overlap assembly', () => {
  const OV = 'GCTTACCGATTGCAGTTACC';            // 20 bp shared
  const OV2 = 'TTGACCAGTTGCATACGGAT';
  const OV3 = 'ACCGTTAAGCTTGGACATCA';

  const A = fragmentOf('A', 'A', 'AAAACCCCAAAACCCC' + OV);
  const B = fragmentOf('B', 'B', OV + 'GGGGTTTTGGGGTTTT' + OV2);
  const C = fragmentOf('C', 'C', OV2 + 'ATATATATCGCGCGCG' + OV3);

  test('finds the homology and joins on it', () => {
    const r = assemble([A, B], { mode: 'overlap', topology: 'linear', minOverlap: 15 });
    assert.equal(r.assemblies.length, 1);
    assert.equal(r.assemblies[0].junctions[0].shared, OV);
  });

  test('the shared sequence appears once in the product, not twice', () => {
    const [asm] = assemble([A, B], { mode: 'overlap', topology: 'linear', minOverlap: 15 }).assemblies;
    const occurrences = asm.sequence.split(OV).length - 1;
    assert.equal(occurrences, 1, 'the overlap was duplicated');
    assert.equal(asm.sequence.length, A.seq.length + B.seq.length - OV.length);
  });

  test('three fragments assemble into one molecule, whichever order they arrive in', () => {
    const expected = A.seq + B.seq.slice(OV.length) + C.seq.slice(OV2.length);
    const r = assemble([C, A, B], { mode: 'overlap', topology: 'linear', minOverlap: 15 });

    assert.equal(r.assemblies.length, 1, 'a molecule and its reverse complement are one answer');
    const asm = r.assemblies[0];
    assert.equal(canonicalLinear(asm.sequence), canonicalLinear(expected));

    // The reading direction is arbitrary -- the engine may return the molecule
    // from either strand -- but the fragments must be adjacent in the same
    // relative order either way.
    const names = asm.order.map(p => p.name).join('-');
    assert.ok(names === 'A-B-C' || names === 'C-B-A', `unexpected order ${names}`);
    if (names === 'C-B-A') {
      assert.ok(asm.order.every(p => p.flipped), 'reading the other strand means every fragment is flipped');
      assert.equal(asm.sequence, revComp(expected));
    }
  });

  test('homology below the threshold is not a join', () => {
    const short = fragmentOf('S', 'S', 'CCCCCCCC' + 'ATCGATCG');
    const other = fragmentOf('T', 'T', 'ATCGATCG' + 'GGGGGGGG');
    const r = assemble([short, other], { mode: 'overlap', topology: 'linear', minOverlap: 15 });
    assert.equal(r.assemblies.length, 0, '8 bp is not a Gibson overlap');
  });

  test('the longest homology is used, not the shortest', () => {
    assert.equal(overlapLength('xxxxATCGATCGAT', 'ATCGATCGATyyyy', 4, 20), 10);
  });
});

describe('the same molecule is not counted twice', () => {
  test('rotations of a circle are one construct', () => {
    assert.equal(canonicalCircular('ATGCAA'), canonicalCircular('GCAAAT'));
    assert.equal(canonicalCircular('ATGCAA'), canonicalCircular('AATGCA'));
  });

  test('a circle and its reverse complement are one construct', () => {
    assert.equal(canonicalCircular('ATGCAA'), canonicalCircular(revComp('ATGCAA')));
  });

  test('different circles stay different', () => {
    assert.notEqual(canonicalCircular('ATGCAA'), canonicalCircular('ATGCAT'));
  });

  test('a linear molecule equals its reverse complement', () => {
    assert.equal(canonicalLinear('ATGGGC'), canonicalLinear(revComp('ATGGGC')));
  });
});

describe('round trip: cut a circle apart and put it back', () => {
  test('the reassembled construct is the sequence we started with', () => {
    // A circular plasmid conceptually cut at two sites leaving 4-base 5'
    // overhangs. Reassembling must return the original molecule -- the
    // strongest check there is, because it exercises the junction arithmetic
    // rather than asserting a hand-computed answer.
    const backbone = 'ATGGCGAATTCCTTGGACCATGGTCCAAGGAATTCGCATTTAGCCA';
    const insert   = 'CCCGGGTTTAAACCCGGGTTTAAACCCGGG';
    const oh1 = 'GGAG', oh2 = 'ATTG';

    const V = frag('V', backbone, sticky("5'", revComp(oh2)), sticky("5'", oh1));
    const I = frag('I', insert,   sticky("5'", revComp(oh1)), sticky("5'", oh2));

    const r = assemble([V, I], { mode: 'overhang', topology: 'circular' });
    assert.equal(r.assemblies.length, 1, 'expected exactly one way to close this');

    const built = r.assemblies[0].sequence;
    const expected = backbone + revComp(oh1) + insert + revComp(oh2);
    assert.equal(
      canonicalCircular(built), canonicalCircular(expected),
      `built ${built}\nwanted ${expected}`,
    );
    assert.equal(built.length, backbone.length + insert.length + 8);
  });
});

describe('problem reporting', () => {
  test('a fragment that joins nothing is named', () => {
    const A = frag('A', 'AAAA', sticky("5'", 'TTCG'), sticky("5'", 'GGAG'));
    const B = frag('B', 'CCCC', sticky("5'", 'CTCC'), sticky("5'", 'CGAA'));
    const orphan = frag('Orphan', 'TTTT', sticky("5'", 'AACC'), sticky("5'", 'AACC'));
    const r = assemble([A, B, orphan], { mode: 'overhang', topology: 'circular' });
    const p = r.problems.find(x => x.kind === 'orphan-fragment');
    assert.ok(p, `expected an orphan report, got: ${r.problems.map(x => x.kind).join(', ')}`);
    assert.match(p!.message, /Orphan/);
  });

  test('no fragments is a stated problem, not a crash', () => {
    const r = assemble([], { mode: 'overhang' });
    assert.equal(r.assemblies.length, 0);
    assert.ok(r.problems.some(p => p.kind === 'no-assembly'));
  });
});

describe('the search stays bounded', () => {
  test('fragments that all share one end do not hang the search', () => {
    // Eight identical ends generate an exponential number of paths that all
    // collapse to a couple of molecules. Before the budget existed this took
    // nearly three seconds, which in a browser is a frozen tab.
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 'S' + i, name: 'S' + i, seq: 'ACGT'.repeat(50),
      left: sticky("5'", 'GATC'), right: sticky("5'", 'GATC'),
    }));
    const t0 = Date.now();
    const r = assemble(many, { mode: 'overhang', topology: 'circular' });
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, `search took ${ms}ms`);
    assert.ok(
      r.problems.some(p => p.kind === 'search-truncated' || p.kind === 'ambiguous-end'),
      'a pathological set should be explained, not silently truncated',
    );
  });

  test('a well-formed assembly is nowhere near the budget', () => {
    const oh = ['GGAG', 'TTCG', 'TGCC', 'ACGA', 'GTCA', 'CCTT'];
    const parts = oh.map((_, i) => ({
      id: 'F' + i, name: 'F' + i, seq: 'ACGTTGCA'.repeat(20),
      left: sticky("5'", revComp(oh[i])),
      right: sticky("5'", oh[(i + 1) % oh.length]),
    }));
    const t0 = Date.now();
    const r = assemble(parts, { mode: 'overhang', topology: 'circular' });
    assert.ok(Date.now() - t0 < 300);
    assert.equal(r.problems.some(p => p.kind === 'search-truncated'), false);
    assert.ok(r.assemblies.length >= 1);
  });
});
