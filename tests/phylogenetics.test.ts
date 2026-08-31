import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMatrix, pairwiseDistanceMatrix, neighbourJoining, upgma, toNewick, cladeOf, patristicDistance,
  type DistanceMatrix, type TreeNode,
} from '../src/lib/phylogenetics.ts';

/** The worked example from Saitou & Nei, as reproduced on Wikipedia. */
const ADDITIVE: DistanceMatrix = {
  names: ['a', 'b', 'c', 'd', 'e'],
  d: [
    [0,  5,  9,  9,  8],
    [5,  0, 10, 10,  9],
    [9, 10,  0,  8,  7],
    [9, 10,  8,  0,  3],
    [8,  9,  7,  3,  0],
  ],
  sitesUsed: 100,
};

describe('neighbour-joining', () => {
  test('an additive matrix is reconstructed exactly', () => {
    // This is the defining property: if the distances can be realised on a
    // tree, NJ must find that tree, and every path length must come back
    // identical. It catches a wrong Q matrix, a wrong branch split and a wrong
    // distance update, none of which a topology check would notice.
    const tree = neighbourJoining(ADDITIVE);
    for (let i = 0; i < ADDITIVE.names.length; i++) {
      for (let j = i + 1; j < ADDITIVE.names.length; j++) {
        const want = ADDITIVE.d[i][j];
        const got = patristicDistance(tree, ADDITIVE.names[i], ADDITIVE.names[j]);
        assert.ok(got !== null, `no path between ${ADDITIVE.names[i]} and ${ADDITIVE.names[j]}`);
        assert.ok(
          Math.abs(got! - want) < 1e-9,
          `${ADDITIVE.names[i]}-${ADDITIVE.names[j]}: tree says ${got}, matrix says ${want}`,
        );
      }
    }
  });

  test('it recovers the expected clades', () => {
    const tree = neighbourJoining(ADDITIVE);
    const clades = new Set<string>();
    const walk = (n: TreeNode) => {
      if (n.children?.length) { clades.add(cladeOf(n).join(',')); n.children.forEach(walk); }
    };
    walk(tree);
    assert.ok(clades.has('a,b'), 'a and b are each other\'s closest relatives');
    assert.ok(clades.has('d,e'), 'd and e are each other\'s closest relatives');
  });

  test('every tip appears exactly once', () => {
    const tips = cladeOf(neighbourJoining(ADDITIVE));
    assert.deepEqual(tips, ['a', 'b', 'c', 'd', 'e']);
  });

  test('two sequences make a two-tip tree split down the middle', () => {
    const t = neighbourJoining({ names: ['x', 'y'], d: [[0, 0.4], [0.4, 0]], sitesUsed: 10 });
    assert.equal(t.children!.length, 2);
    assert.equal(t.children![0].length, 0.2);
    assert.equal(patristicDistance(t, 'x', 'y'), 0.4);
  });

  test('one sequence is refused rather than half-drawn', () => {
    assert.throws(() => neighbourJoining({ names: ['only'], d: [[0]], sitesUsed: 1 }), /at least two/);
  });

  test('branch lengths are never negative', () => {
    // Real data is not additive, and the arithmetic can go below zero.
    const noisy: DistanceMatrix = {
      names: ['p', 'q', 'r', 's'],
      d: [[0, 0.9, 0.1, 0.9], [0.9, 0, 0.9, 0.1], [0.1, 0.9, 0, 0.9], [0.9, 0.1, 0.9, 0]],
      sitesUsed: 50,
    };
    const seen: number[] = [];
    const walk = (n: TreeNode) => { seen.push(n.length); n.children?.forEach(walk); };
    walk(neighbourJoining(noisy));
    assert.ok(seen.every(l => l >= 0), `negative branch length: ${seen.filter(l => l < 0)}`);
  });
});

describe('UPGMA', () => {
  test('the result is ultrametric: every tip is the same distance from the root', () => {
    const tree = upgma(ADDITIVE);
    const depths: number[] = [];
    const walk = (n: TreeNode, acc: number) => {
      const total = acc + n.length;
      if (!n.children?.length) depths.push(total);
      else n.children.forEach(c => walk(c, total));
    };
    walk(tree, 0);
    const first = depths[0];
    for (const d of depths) {
      assert.ok(Math.abs(d - first) < 1e-9, `tip depths differ: ${depths.join(', ')}`);
    }
  });

  test('it keeps every tip', () => {
    assert.deepEqual(cladeOf(upgma(ADDITIVE)), ['a', 'b', 'c', 'd', 'e']);
  });
});

describe('distances', () => {
  const taxa = [
    { id: '1', name: 'one', sequence: 'AAAACCCCGGGGTTTT' },
    { id: '2', name: 'two', sequence: 'AAAACCCCGGGGTTTA' },  // 1 transversion
    { id: '3', name: 'three', sequence: 'GAAACCCCGGGGTTTT' }, // 1 transition
  ];

  test('p-distance counts differences per site', () => {
    const { d } = distanceMatrix(taxa, 'p');
    assert.ok(Math.abs(d[0][1] - 1 / 16) < 1e-12);
  });

  test('corrections are larger than the raw count, and JC69 <= K2P here', () => {
    const p = distanceMatrix(taxa, 'p').d[0][1];
    const jc = distanceMatrix(taxa, 'jc69').d[0][1];
    const k2 = distanceMatrix(taxa, 'k2p').d[0][1];
    assert.ok(jc > p, 'correcting for multiple hits must increase distance');
    assert.ok(k2 >= jc, 'a single transversion is penalised at least as much under K2P');
  });

  test('the matrix is symmetric with a zero diagonal', () => {
    const { d } = distanceMatrix(taxa, 'jc69');
    for (let i = 0; i < d.length; i++) {
      assert.equal(d[i][i], 0);
      for (let j = 0; j < d.length; j++) assert.equal(d[i][j], d[j][i]);
    }
  });

  test('columns with a gap or an N are dropped from every comparison', () => {
    const withGap = [
      { id: '1', name: 'a', sequence: 'AAAA' },
      { id: '2', name: 'b', sequence: 'AA-A' },
      { id: '3', name: 'c', sequence: 'ANAA' },
    ];
    const { sitesUsed } = distanceMatrix(withGap, 'p');
    assert.equal(sitesUsed, 2, 'only the two clean columns are usable');
  });

  test('unaligned sequences are refused, not silently truncated', () => {
    assert.throws(() => distanceMatrix([
      { id: '1', name: 'a', sequence: 'AAAA' },
      { id: '2', name: 'b', sequence: 'AAA' },
    ]), /aligned/);
  });

  test('saturated sequences give an infinite JC69 distance rather than NaN', () => {
    const far = [
      { id: '1', name: 'a', sequence: 'AAAAAAAAAAAA' },
      { id: '2', name: 'b', sequence: 'TTTTTTTTTTTT' },
    ];
    assert.equal(distanceMatrix(far, 'jc69').d[0][1], Infinity);
  });
});

describe('newick output', () => {
  test('it is well formed and carries the lengths', () => {
    const nwk = toNewick(neighbourJoining(ADDITIVE));
    assert.ok(nwk.endsWith(';'), 'a Newick string must be terminated');
    assert.equal((nwk.match(/\(/g) || []).length, (nwk.match(/\)/g) || []).length, 'unbalanced parentheses');
    for (const n of ADDITIVE.names) assert.match(nwk, new RegExp(`\\b${n}:`), `${n} missing`);
  });

  test('names needing escapes are quoted', () => {
    const t: TreeNode = { length: 0, children: [
      { name: 'E. coli K-12', length: 0.1 },
      { name: 'plain', length: 0.2 },
    ] };
    const nwk = toNewick(t);
    assert.match(nwk, /'E\. coli K-12':/, 'a name with spaces must be quoted');
    assert.match(nwk, /(^|,)plain:/, 'a plain name must not be');
  });
});

describe('distances from pairwise alignments', () => {
  // Two pairs, each pair close, the pairs far from each other. A correct
  // method must recover exactly that grouping.
  const A = 'ATGCGTACGTTAGCCATGGCATTACGGATCCGTTAAGCTAGCTAGGCATCGATCGTAGCTA';
  const mut = (s: string, at: number[]) => {
    const c = s.split('');
    for (const i of at) c[i] = c[i] === 'A' ? 'C' : 'A';
    return c.join('');
  };
  const far = mut(A, [2, 7, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56]);

  const taxa = [
    { id: '1', name: 'a1', sequence: mut(A, [4]) },
    { id: '2', name: 'a2', sequence: mut(A, [9]) },
    { id: '3', name: 'b1', sequence: mut(far, [14]) },
    { id: '4', name: 'b2', sequence: mut(far, [19]) },
  ];

  test('sequences need not be pre-aligned', () => {
    // Unequal lengths would throw in distanceMatrix; here they are aligned
    // pair by pair, which is the point.
    const ragged = [
      { id: '1', name: 'x', sequence: A },
      { id: '2', name: 'y', sequence: A.slice(0, 50) },
    ];
    const dm = pairwiseDistanceMatrix(ragged, 'p');
    assert.ok(Number.isFinite(dm.d[0][1]));
  });

  test('within-pair distance is far smaller than between-pair', () => {
    const dm = pairwiseDistanceMatrix(taxa, 'jc69');
    const i = (n: string) => dm.names.indexOf(n);
    const within = Math.max(dm.d[i('a1')][i('a2')], dm.d[i('b1')][i('b2')]);
    const between = Math.min(dm.d[i('a1')][i('b1')], dm.d[i('a2')][i('b2')]);
    assert.ok(within < between, `within ${within} should be below between ${between}`);
  });

  test('both methods recover the true grouping', () => {
    const dm = pairwiseDistanceMatrix(taxa, 'jc69');
    for (const [label, build] of [['nj', neighbourJoining], ['upgma', upgma]] as const) {
      const clades = new Set<string>();
      const walk = (n: TreeNode) => { if (n.children?.length) { clades.add(cladeOf(n).join(',')); n.children.forEach(walk); } };
      walk(build(dm));
      assert.ok(clades.has('a1,a2'), `${label} lost the a clade: ${[...clades].join(' | ')}`);
      assert.ok(clades.has('b1,b2'), `${label} lost the b clade: ${[...clades].join(' | ')}`);
    }
  });

  test('the matrix is symmetric with a zero diagonal', () => {
    const { d } = pairwiseDistanceMatrix(taxa, 'k2p');
    for (let i = 0; i < d.length; i++) {
      assert.equal(d[i][i], 0);
      for (let j = 0; j < d.length; j++) assert.equal(d[i][j], d[j][i]);
    }
  });
});
