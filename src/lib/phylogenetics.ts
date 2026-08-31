/**
 * Distance-based phylogenetic tree building.
 *
 * The question a lab actually asks is "which of these sequences are most
 * closely related, and how confident am I?" -- so this computes distances from
 * an alignment, builds a tree, and reports support, rather than drawing a
 * dendrogram and leaving the reader to assume it means something.
 *
 * Two methods, because they answer different questions:
 *
 *   Neighbour-joining does not assume the molecular clock. Branch lengths are
 *   free, so a lineage that evolved faster is drawn with a longer branch. This
 *   is what you want for a gene tree.
 *
 *   UPGMA does assume a clock: every tip ends up equidistant from the root. It
 *   is the right shape for a dendrogram of similarity, and the wrong shape for
 *   evolutionary history unless the clock genuinely holds.
 *
 * Distances are corrected for multiple substitutions. Counting raw differences
 * underestimates divergence as soon as sites start changing twice, and the
 * error grows with distance -- so uncorrected p-distance systematically pulls
 * distant taxa closer than they are.
 */

import { alignPair } from './alignment';

export type DistanceModel = 'p' | 'jc69' | 'k2p';

export interface Taxon {
  id: string;
  name: string;
  sequence: string;
}

export interface TreeNode {
  /** Present on tips only. */
  name?: string;
  /** Length of the branch leading to this node, in substitutions per site. */
  length: number;
  children?: TreeNode[];
  /** Bootstrap support for this clade, as a percentage, when computed. */
  support?: number;
}

export interface DistanceMatrix {
  names: string[];
  /** Symmetric, zero diagonal. */
  d: number[][];
  /** Sites compared after removing any column with a gap or an N. */
  sitesUsed: number;
}

const PURINES = new Set(['A', 'G']);
const BASES = new Set(['A', 'C', 'G', 'T']);

/** Columns where every sequence has an unambiguous base. */
function informativeSites(seqs: string[]): number[] {
  const n = seqs[0]?.length ?? 0;
  const keep: number[] = [];
  outer: for (let i = 0; i < n; i++) {
    for (const s of seqs) {
      const c = s[i];
      if (c !== 'A' && c !== 'C' && c !== 'G' && c !== 'T') continue outer;
    }
    keep.push(i);
  }
  return keep;
}

/**
 * Pairwise distances from an alignment.
 *
 * Complete deletion: a column is dropped for every pair if it has a gap in
 * any sequence. Pairwise deletion would use more data but makes the distances
 * mutually inconsistent, and an inconsistent matrix produces a tree whose
 * branch lengths cannot all be satisfied at once.
 */
export function distanceMatrix(taxa: Taxon[], model: DistanceModel = 'jc69'): DistanceMatrix {
  const seqs = taxa.map(t => t.sequence.toUpperCase());
  const len = seqs[0]?.length ?? 0;
  if (seqs.some(s => s.length !== len)) {
    throw new Error('Sequences must be aligned to the same length before distances can be computed.');
  }
  const sites = informativeSites(seqs);
  const n = taxa.length;
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let transitions = 0, transversions = 0;
      for (const k of sites) {
        const a = seqs[i][k], b = seqs[j][k];
        if (a === b) continue;
        // A<->G and C<->T are transitions; every other change is a transversion.
        if (PURINES.has(a) === PURINES.has(b)) transitions++;
        else transversions++;
      }
      d[i][j] = d[j][i] = correct(transitions, transversions, sites.length, model);
    }
  }
  return { names: taxa.map(t => t.name), d, sitesUsed: sites.length };
}

function correct(transitions: number, transversions: number, sites: number, model: DistanceModel): number {
  if (sites === 0) return 0;
  const P = transitions / sites;
  const Q = transversions / sites;
  const p = P + Q;

  if (model === 'p') return p;

  if (model === 'jc69') {
    // d = -3/4 ln(1 - 4p/3); undefined at p >= 0.75, where the sequences are
    // no more similar than two random ones.
    const x = 1 - (4 / 3) * p;
    return x <= 0 ? Infinity : -0.75 * Math.log(x);
  }

  // Kimura 2-parameter: transitions and transversions accumulate at different
  // rates, and pooling them underestimates distance when the ratio is skewed.
  const a = 1 - 2 * P - Q;
  const b = 1 - 2 * Q;
  if (a <= 0 || b <= 0) return Infinity;
  return -0.5 * Math.log(a) - 0.25 * Math.log(b);
}

/**
 * Distances from optimal pairwise alignments rather than one multiple alignment.
 *
 * A distance method does not need every sequence in one frame -- it needs each
 * pair measured well. Forcing them through a single progressive alignment makes
 * the whole matrix hostage to that alignment: one sequence placed badly against
 * the centre reads as saturated against everything, and the tree hangs it off a
 * long spurious branch. Aligning each pair on its own removes that failure.
 *
 * The cost is that the matrix is no longer guaranteed additive, since each pair
 * was optimised independently. For neighbour-joining that is acceptable -- it
 * does not assume additivity, only that the distances are roughly right.
 */
export function pairwiseDistanceMatrix(taxa: Taxon[], model: DistanceModel = 'jc69'): DistanceMatrix {
  const n = taxa.length;
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let minSites = Infinity;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = alignPair(taxa[i].sequence, taxa[j].sequence, { mode: 'global' });
      let transitions = 0, transversions = 0, sites = 0;
      for (let k = 0; k < a.alignedA.length; k++) {
        const x = a.alignedA[k], y = a.alignedB[k];
        if (!BASES.has(x) || !BASES.has(y)) continue; // gap or ambiguity
        sites++;
        if (x === y) continue;
        if (PURINES.has(x) === PURINES.has(y)) transitions++;
        else transversions++;
      }
      minSites = Math.min(minSites, sites);
      d[i][j] = d[j][i] = correct(transitions, transversions, sites, model);
    }
  }
  return { names: taxa.map(t => t.name), d, sitesUsed: Number.isFinite(minSites) ? minSites : 0 };
}

/**
 * Neighbour-joining (Saitou & Nei 1987).
 *
 * At each step it joins the pair minimising Q, not the pair with the smallest
 * distance -- that correction is the whole point of the method. Picking the
 * closest pair instead is the classic mistake, and it produces a wrong
 * topology whenever evolutionary rates differ between lineages.
 */
export function neighbourJoining(dm: DistanceMatrix): TreeNode {
  const n = dm.names.length;
  if (n < 2) throw new Error('A tree needs at least two sequences.');
  if (n === 2) {
    return { length: 0, children: [
      { name: dm.names[0], length: dm.d[0][1] / 2 },
      { name: dm.names[1], length: dm.d[0][1] / 2 },
    ] };
  }

  // Working copies: distances, and the node each row currently stands for.
  let d = dm.d.map(row => row.slice());
  let nodes: TreeNode[] = dm.names.map(name => ({ name, length: 0 }));

  while (nodes.length > 2) {
    const m = nodes.length;
    const r = d.map(row => row.reduce((a, b) => a + b, 0));

    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const q = (m - 2) * d[i][j] - r[i] - r[j];
        if (q < best) { best = q; bi = i; bj = j; }
      }
    }

    // Split the branch between the joined pair according to how far each sits
    // from everything else, so an unequal rate is not averaged away.
    const dij = d[bi][bj];
    let li = 0.5 * dij + (r[bi] - r[bj]) / (2 * (m - 2));
    let lj = dij - li;
    // Negative lengths are possible on non-additive data and mean nothing
    // biologically; clamp and move the difference to the sibling.
    if (li < 0) { lj -= li; li = 0; }
    if (lj < 0) { li -= lj; lj = 0; }

    const joined: TreeNode = {
      length: 0,
      children: [{ ...nodes[bi], length: li }, { ...nodes[bj], length: lj }],
    };

    const keep = [...Array(m).keys()].filter(k => k !== bi && k !== bj);
    const nd: number[][] = [];
    const nn: TreeNode[] = [];
    for (const k of keep) { nn.push(nodes[k]); }
    nn.push(joined);

    for (let x = 0; x < keep.length; x++) {
      nd.push([]);
      for (let y = 0; y < keep.length; y++) nd[x].push(d[keep[x]][keep[y]]);
      // Distance from the new node to each remaining one.
      nd[x].push(0.5 * (d[keep[x]][bi] + d[keep[x]][bj] - dij));
    }
    const last = keep.map((_, x) => nd[x][keep.length]);
    nd.push([...last, 0]);

    d = nd;
    nodes = nn;
  }

  const finalLen = d[0][1];
  return { length: 0, children: [
    { ...nodes[0], length: finalLen / 2 },
    { ...nodes[1], length: finalLen / 2 },
  ] };
}

/** UPGMA: average linkage, ultrametric by construction. */
export function upgma(dm: DistanceMatrix): TreeNode {
  const n = dm.names.length;
  if (n < 2) throw new Error('A tree needs at least two sequences.');

  let d = dm.d.map(r => r.slice());
  let nodes: TreeNode[] = dm.names.map(name => ({ name, length: 0 }));
  let sizes = new Array(n).fill(1);
  // Height above the tips, so branch lengths can be derived on joining.
  let heights = new Array(n).fill(0);

  while (nodes.length > 1) {
    const m = nodes.length;
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        if (d[i][j] < best) { best = d[i][j]; bi = i; bj = j; }
      }
    }

    const h = best / 2;
    const joined: TreeNode = {
      length: 0,
      children: [
        { ...nodes[bi], length: Math.max(0, h - heights[bi]) },
        { ...nodes[bj], length: Math.max(0, h - heights[bj]) },
      ],
    };

    const keep = [...Array(m).keys()].filter(k => k !== bi && k !== bj);
    const nd: number[][] = [];
    for (let x = 0; x < keep.length; x++) {
      nd.push([]);
      for (let y = 0; y < keep.length; y++) nd[x].push(d[keep[x]][keep[y]]);
      // Average weighted by cluster size, which is what makes this UPGMA
      // rather than WPGMA.
      const wi = sizes[bi], wj = sizes[bj];
      nd[x].push((wi * d[keep[x]][bi] + wj * d[keep[x]][bj]) / (wi + wj));
    }
    nd.push([...keep.map((_, x) => nd[x][keep.length]), 0]);

    d = nd;
    nodes = [...keep.map(k => nodes[k]), joined];
    sizes = [...keep.map(k => sizes[k]), sizes[bi] + sizes[bj]];
    heights = [...keep.map(k => heights[k]), h];
  }
  return nodes[0];
}

/** Newick, so the tree can be opened in FigTree, iTOL, MEGA or anything else. */
export function toNewick(root: TreeNode, decimals = 5): string {
  const fmt = (v: number) => Number(v.toFixed(decimals)).toString();
  const walk = (n: TreeNode): string => {
    if (!n.children?.length) return `${escapeName(n.name ?? '')}:${fmt(n.length)}`;
    const inner = n.children.map(walk).join(',');
    const label = n.support !== undefined ? String(Math.round(n.support)) : '';
    return `(${inner})${label}:${fmt(n.length)}`;
  };
  const inner = root.children?.map(walk).join(',') ?? '';
  return `(${inner});`;
}

function escapeName(name: string): string {
  // Newick reserves these; quoting is the standard escape.
  return /[\s(),:;'\[\]]/.test(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

/** Every tip name below a node, sorted -- the clade it defines. */
export function cladeOf(n: TreeNode): string[] {
  if (!n.children?.length) return n.name ? [n.name] : [];
  return n.children.flatMap(cladeOf).sort();
}

/** Path length between two tips, summing branch lengths through their ancestor. */
export function patristicDistance(root: TreeNode, a: string, b: string): number | null {
  const path = (n: TreeNode, target: string, acc: number): number | null => {
    if (!n.children?.length) return n.name === target ? acc + n.length : null;
    for (const c of n.children) {
      const r = path(c, target, acc + n.length);
      if (r !== null) return r;
    }
    return null;
  };
  // The lowest node containing both is where their paths meet.
  const lca = (n: TreeNode): TreeNode | null => {
    if (!n.children?.length) return null;
    const holds = (x: TreeNode, t: string): boolean =>
      x.children?.length ? x.children.some(c => holds(c, t)) : x.name === t;
    for (const c of n.children) {
      if (holds(c, a) && holds(c, b)) return lca(c) ?? c;
    }
    return holds(n, a) && holds(n, b) ? n : null;
  };
  const node = lca(root);
  if (!node) return null;
  const da = path(node, a, 0), db = path(node, b, 0);
  if (da === null || db === null) return null;
  return da + db - 2 * node.length;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Felsenstein's bootstrap.
 *
 * Resample the alignment's columns with replacement, rebuild the tree, and
 * count how often each grouping in the original tree reappears. A branch
 * supported by 95 replicates in 100 is one the data insists on; a branch
 * supported by 40 is one the drawing invented, and without this number the two
 * look identical on the page.
 *
 * Columns are the unit because sites are what vary independently. Resampling
 * sequences, or resampling before alignment, measures nothing meaningful.
 *
 * Comparison is by split, not by clade. Neighbour-joining produces an unrooted
 * tree; where this code puts the root is arbitrary, so the same biological
 * grouping can be written as two different clades. Counting clades would
 * undercount support on exactly the branches people care about.
 */

/** Deterministic generator, so the same input gives the same support twice. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One internal branch, written so the two halves of the split are
 * interchangeable: the same branch always produces the same key regardless of
 * where the tree happens to be rooted.
 */
function canonicalSplit(side: string[], all: string[]): string {
  const inSide = new Set(side);
  const a = [...side].sort().join(',');
  const b = all.filter(n => !inSide.has(n)).sort().join(',');
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Every non-trivial split in a tree. */
export function splitsOf(root: TreeNode, all: string[]): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode): string[] => {
    if (!n.children?.length) return n.name ? [n.name] : [];
    const below = n.children.flatMap(walk);
    // A split separating one tip, or none, says nothing: every tree has it.
    if (below.length > 1 && below.length < all.length - 1) {
      out.add(canonicalSplit(below, all));
    }
    return below;
  };
  walk(root);
  return out;
}

export interface BootstrapOptions {
  replicates?: number;
  model?: DistanceModel;
  method?: 'nj' | 'upgma';
  /** Fixed so a result can be reproduced; change it to resample differently. */
  seed?: number;
}

export interface BootstrapResult {
  /** The original tree, with `support` set on every internal node. */
  tree: TreeNode;
  replicates: number;
  /** Support keyed by canonical split, for reporting. */
  bySplit: Map<string, number>;
}

/**
 * Build a tree from `taxa` and attach bootstrap support to its branches.
 * `taxa` must be aligned: bootstrap resamples columns, so the columns have to
 * mean the same thing in every sequence.
 */
export function bootstrapTree(taxa: Taxon[], opts: BootstrapOptions = {}): BootstrapResult {
  const replicates = Math.max(1, Math.min(1000, opts.replicates ?? 100));
  const model = opts.model ?? 'jc69';
  const method = opts.method ?? 'nj';
  const build = method === 'nj' ? neighbourJoining : upgma;

  const names = taxa.map(t => t.name);
  const seqs = taxa.map(t => t.sequence.toUpperCase());
  const width = seqs[0]?.length ?? 0;
  if (seqs.some(s => s.length !== width)) {
    throw new Error('Bootstrap needs aligned sequences: columns must line up before they can be resampled.');
  }

  const reference = build(distanceMatrix(taxa, model));
  const refSplits = splitsOf(reference, names);
  const counts = new Map<string, number>();
  for (const s of refSplits) counts.set(s, 0);

  const rand = mulberry32(opts.seed ?? 20260101);

  for (let r = 0; r < replicates; r++) {
    // Draw `width` columns with replacement -- the same columns for every
    // sequence, which is what keeps the replicate an alignment.
    const pickCols = new Array(width);
    for (let k = 0; k < width; k++) pickCols[k] = Math.floor(rand() * width);

    const resampled = taxa.map((t, i) => {
      let s = '';
      for (const c of pickCols) s += seqs[i][c];
      return { id: t.id, name: t.name, sequence: s };
    });

    let tree: TreeNode;
    try {
      tree = build(distanceMatrix(resampled, model));
    } catch {
      // A replicate can be degenerate -- every column identical, or a pair
      // saturated. Skip it rather than letting one draw abort the run.
      continue;
    }
    const got = splitsOf(tree, names);
    for (const s of refSplits) if (got.has(s)) counts.set(s, counts.get(s)! + 1);
  }

  // Annotate the reference tree in place. A split is labelled once: the two
  // children of the root describe the same branch, because where the root sits
  // is arbitrary, and printing the number on both sides reads as two findings
  // when it is one.
  const labelled = new Set<string>();
  const annotate = (n: TreeNode): string[] => {
    if (!n.children?.length) return n.name ? [n.name] : [];
    const below = n.children.flatMap(annotate);
    if (below.length > 1 && below.length < names.length - 1) {
      const key = canonicalSplit(below, names);
      const c = counts.get(key);
      if (c !== undefined && !labelled.has(key)) {
        n.support = (c / replicates) * 100;
        labelled.add(key);
      }
    }
    return below;
  };
  annotate(reference);

  return { tree: reference, replicates, bySplit: counts };
}
