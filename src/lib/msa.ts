import { alignPair, type AlignmentOptions, type MultipleAlignment } from './alignment';
import { upgma, type TreeNode, type DistanceMatrix } from './phylogenetics';

/**
 * Progressive multiple alignment along a guide tree.
 *
 * The centre-star method already here aligns everything to one chosen sequence.
 * That is defensible for a few near-identical colonies, but it degrades exactly
 * where alignment matters: given two close pairs that are distant from each
 * other, every sequence is forced through the geometry of whichever one sat in
 * the middle, and gaps placed to suit that one sequence are propagated to all
 * the rest.
 *
 * The progressive method aligns the closest pair first, then the next closest,
 * merging alignments as whole profiles rather than as rows. A gap placed early,
 * between two sequences that agree about it, stays put -- "once a gap, always a
 * gap", which is the known weakness of the method and also the reason it is
 * stable. Order comes from a UPGMA tree over pairwise distances: rooted, and
 * its merge order is already sorted by increasing distance, which is precisely
 * the order a progressive alignment wants.
 *
 * This is ClustalW's shape, not its every refinement -- no position-specific
 * gap penalties, no sequence weighting. Those matter for distant proteins; for
 * the DNA a lab actually compares, the guide tree is the part that counts.
 */

export interface Profile {
  names: string[];
  /** Aligned rows, all the same length. */
  rows: string[];
}

const BASES = ['A', 'C', 'G', 'T'] as const;

interface Columns {
  width: number;
  /** Per column, the fraction of rows carrying each base. */
  freq: Float64Array[];
  /** Per column, the fraction of rows carrying any base at all. */
  occupancy: Float64Array;
}

function summarise(rows: string[]): Columns {
  const width = rows[0]?.length ?? 0;
  const freq: Float64Array[] = [];
  const occupancy = new Float64Array(width);
  for (let k = 0; k < width; k++) {
    const f = new Float64Array(4);
    let residues = 0;
    for (const r of rows) {
      const i = BASES.indexOf(r[k] as typeof BASES[number]);
      if (i >= 0) { f[i]++; residues++; }
    }
    // Frequencies over the whole column, gaps included: a column that is mostly
    // gaps should score weakly against anything, not strongly against whatever
    // its few residues happen to be.
    for (let i = 0; i < 4; i++) f[i] /= rows.length;
    occupancy[k] = residues / rows.length;
    freq.push(f);
  }
  return { width, freq, occupancy };
}

/**
 * Sum-of-pairs score between one column of each profile.
 *
 * Every residue in one column is scored against every residue in the other and
 * the result averaged, so two columns that agree perfectly score `match`
 * whatever their depth, and a column of mixed bases scores in between.
 */
function columnScore(a: Columns, i: number, b: Columns, j: number, match: number, mismatch: number): number {
  const fa = a.freq[i], fb = b.freq[j];
  let s = 0;
  for (let x = 0; x < 4; x++) {
    if (fa[x] === 0) continue;
    for (let y = 0; y < 4; y++) {
      if (fb[y] === 0) continue;
      s += fa[x] * fb[y] * (x === y ? match : mismatch);
    }
  }
  return s;
}

/**
 * Align two alignments, keeping the columns within each one intact.
 *
 * Gotoh over columns rather than bases. Gap penalties are scaled by how full
 * the opposing column is: opening a gap opposite a column that is already
 * mostly gaps is nearly free, which is what stops an early indel in one
 * sequence from being charged again to every sequence added afterwards.
 */
export function alignProfiles(a: Profile, b: Profile, opts: AlignmentOptions = {}): Profile {
  const match = opts.match ?? 2;
  const mismatch = opts.mismatch ?? -3;
  const gapOpen = opts.gapOpen ?? -5;
  const gapExtend = opts.gapExtend ?? -2;

  const A = summarise(a.rows);
  const B = summarise(b.rows);
  const n = A.width, m = B.width;

  const NEG = -1e18;
  // M: columns paired. X: a column of A against a gap. Y: a column of B.
  const M: Float64Array[] = [], X: Float64Array[] = [], Y: Float64Array[] = [];
  for (let i = 0; i <= n; i++) {
    M.push(new Float64Array(m + 1).fill(NEG));
    X.push(new Float64Array(m + 1).fill(NEG));
    Y.push(new Float64Array(m + 1).fill(NEG));
  }
  // Traceback: 0 = from M, 1 = from X, 2 = from Y.
  const ptrM = new Uint8Array((n + 1) * (m + 1));
  const ptrX = new Uint8Array((n + 1) * (m + 1));
  const ptrY = new Uint8Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;

  M[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    X[i][0] = i === 1 ? gapOpen : X[i - 1][0] + gapExtend;
    ptrX[at(i, 0)] = i === 1 ? 0 : 1;
  }
  for (let j = 1; j <= m; j++) {
    Y[0][j] = j === 1 ? gapOpen : Y[0][j - 1] + gapExtend;
    ptrY[at(0, j)] = j === 1 ? 0 : 2;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = columnScore(A, i - 1, B, j - 1, match, mismatch);
      const best3 = (p: number, q: number, r: number): [number, number] => {
        if (p >= q && p >= r) return [p, 0];
        if (q >= r) return [q, 1];
        return [r, 2];
      };

      const [mv, mp] = best3(M[i - 1][j - 1], X[i - 1][j - 1], Y[i - 1][j - 1]);
      M[i][j] = mv + s;
      ptrM[at(i, j)] = mp;

      // A gap opposite column j-1 of B, priced by how occupied that column is.
      const openX = gapOpen * B.occupancy[j - 1];
      const extX = gapExtend * B.occupancy[j - 1];
      const [xv, xp] = best3(M[i - 1][j] + openX, X[i - 1][j] + extX, Y[i - 1][j] + openX);
      X[i][j] = xv;
      ptrX[at(i, j)] = xp;

      const openY = gapOpen * A.occupancy[i - 1];
      const extY = gapExtend * A.occupancy[i - 1];
      const [yv, yp] = best3(M[i][j - 1] + openY, X[i][j - 1] + openY, Y[i][j - 1] + extY);
      Y[i][j] = yv;
      ptrY[at(i, j)] = yp;
    }
  }

  // Trace back, emitting for each step which column each side contributes.
  const colsA: number[] = [], colsB: number[] = [];
  let i = n, j = m;
  let state = 0;
  {
    const ends: [number, number][] = [[M[n][m], 0], [X[n][m], 1], [Y[n][m], 2]];
    ends.sort((p, q) => q[0] - p[0]);
    state = ends[0][1];
  }
  while (i > 0 || j > 0) {
    if (state === 0) {
      const from = ptrM[at(i, j)];
      colsA.push(--i); colsB.push(--j);
      state = from;
    } else if (state === 1) {
      const from = ptrX[at(i, j)];
      colsA.push(--i); colsB.push(-1);
      state = from;
    } else {
      const from = ptrY[at(i, j)];
      colsA.push(-1); colsB.push(--j);
      state = from;
    }
  }
  colsA.reverse(); colsB.reverse();

  const project = (rows: string[], cols: number[]) =>
    rows.map(r => cols.map(c => (c < 0 ? '-' : r[c])).join(''));

  return {
    names: [...a.names, ...b.names],
    rows: [...project(a.rows, colsA), ...project(b.rows, colsB)],
  };
}

/**
 * The guide tree, and the distances it was built from.
 *
 * Exposed because the tree is worth seeing: it is the same object the
 * phylogenetics page draws, and an alignment whose guide tree groups the wrong
 * two sequences is an alignment worth doubting.
 */
export function guideTree(
  input: { name: string; sequence: string }[],
): { tree: TreeNode; distances: DistanceMatrix } {
  const { tree, distances } = guideTreeIndexed(input);
  return { tree: relabel(tree, input), distances: { ...distances, names: input.map(s => s.name) } };
}

/**
 * The guide tree over positions rather than names.
 *
 * Two sequences in a library can share a name -- two colonies both called
 * "clone 3" is the ordinary case, not a pathological one -- so everything
 * internal is keyed by position and the display names are put back at the end.
 * Keying by name would silently align one sequence twice and drop the other.
 */
function guideTreeIndexed(
  input: { name: string; sequence: string }[],
): { tree: TreeNode; distances: DistanceMatrix } {
  const distances = guideDistances(input);
  return { tree: upgma(distances), distances };
}

/**
 * Distances for ordering the merges: one minus pairwise alignment identity,
 * counting a gap as a difference.
 *
 * Deliberately not the substitution-model distance the phylogenetics module
 * uses. That one discards every column containing a gap, which is right for
 * estimating evolutionary distance and wrong here: two sequences differing only
 * by a twelve-base deletion come out at distance zero, so the guide tree pairs
 * them ahead of two sequences that differ by a single substitution, and the
 * progressive alignment then merges in the worst possible order. A guide tree
 * wants overall similarity, indels included.
 */
export function guideDistances(input: { name: string; sequence: string }[]): DistanceMatrix {
  const n = input.length;
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let minSites = Infinity;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = alignPair(input[i].sequence.toUpperCase(), input[j].sequence.toUpperCase(), { mode: 'global' });
      let same = 0;
      for (let k = 0; k < a.alignedA.length; k++) if (a.alignedA[k] === a.alignedB[k]) same++;
      const width = a.alignedA.length || 1;
      minSites = Math.min(minSites, width);
      d[i][j] = d[j][i] = 1 - same / width;
    }
  }
  return {
    names: input.map((_, i) => String(i)),
    d,
    sitesUsed: Number.isFinite(minSites) ? minSites : 0,
  };
}

function relabel(node: TreeNode, input: { name: string }[]): TreeNode {
  if (!node.children) return { ...node, name: input[Number(node.name)]?.name ?? node.name };
  return { ...node, children: node.children.map(c => relabel(c, input)) };
}

/**
 * Align several sequences along a guide tree.
 */
export function alignProgressive(
  input: { name: string; sequence: string }[],
  opts: AlignmentOptions = {},
): MultipleAlignment & { tree: TreeNode; distances: DistanceMatrix } {
  const seqs = input.filter(s => s.sequence.trim());
  if (seqs.length < 2) throw new Error('Need at least two sequences to align.');

  const { tree: indexed, distances } = guideTreeIndexed(seqs);

  // Post-order: every internal node merges the profiles its children produced,
  // and UPGMA has already put the closest pair deepest.
  const build = (node: TreeNode): Profile => {
    if (!node.children || node.children.length === 0) {
      return { names: [node.name!], rows: [seqs[Number(node.name)].sequence.toUpperCase()] };
    }
    return node.children.map(build).reduce((acc, next) => alignProfiles(acc, next, opts));
  };

  const profile = build(indexed);

  // Back into the caller's order; the tree's order is the tree's business.
  const width = Math.max(...profile.rows.map(r => r.length));
  const padded = profile.rows.map(r => r.padEnd(width, '-'));
  const rows = seqs.map((_, i) => padded[profile.names.indexOf(String(i))]);
  const names = seqs.map(s => s.name);

  let agreed = 0;
  let consensus = '';
  for (let k = 0; k < width; k++) {
    const col = rows.map(r => r[k]);
    const same = col.every(c => c === col[0] && c !== '-');
    consensus += same ? '*' : ' ';
    if (same) agreed++;
  }

  return {
    names, rows, consensus,
    identity: width ? agreed / width : 0,
    tree: relabel(indexed, seqs),
    distances: { ...distances, names: seqs.map(s => s.name) },
  };
}
