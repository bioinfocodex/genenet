import { revComp } from './alignment';

/**
 * Searching the library by sequence.
 *
 * The question is "do we already have this?", asked of a few hundred plasmids
 * rather than of GenBank. Comparing a query against every record with a full
 * alignment is exact and far too slow to sit behind a text box; a k-mer index
 * turns it into a lookup.
 *
 * BLAST-shaped, not BLAST-sized: index every k-mer of the library, find query
 * k-mers that hit, group hits onto diagonals, and extend the promising ones
 * with an X-drop. Extension is ungapped, which is the honest limitation here --
 * a match spanning an insertion comes back as two segments either side of it,
 * not one hit with a gap. Two segments on the same diagonal, at the same
 * offset, is usually enough to see what happened; when it is not, the pairwise
 * aligner is one click away and is exact.
 *
 * There is no E-value. An E-value is a statement about the odds of a hit
 * arising by chance in a database of a given size, and it means something for
 * a database of a given size. Printing one for a search of four hundred
 * plasmids would be borrowing authority the number does not have here.
 */

export interface LibrarySequence {
  id: string;
  name: string;
  sequence: string;
  topology?: 'linear' | 'circular';
}

export interface LibraryIndex {
  k: number;
  sequences: LibrarySequence[];
  /** k-mer -> flat [seqIndex, position, seqIndex, position, ...] */
  postings: Map<string, number[]>;
  /** k-mers dropped for being too common to be informative. */
  masked: number;
}

export interface Hit {
  id: string;
  name: string;
  /** 1-indexed, inclusive. */
  queryStart: number;
  queryEnd: number;
  subjectStart: number;
  subjectEnd: number;
  /** True when the hit runs through position 1 of a circular sequence. */
  wrapsOrigin?: boolean;
  /** '-' when the query matches the library sequence's other strand. */
  strand: '+' | '-';
  length: number;
  identity: number;
  score: number;
}

export interface SearchOptions {
  /** Shortest hit worth reporting. */
  minLength?: number;
  minIdentity?: number;
  /** How far the extension may fall below its best score before stopping. */
  xDrop?: number;
  maxHits?: number;
}

const DEFAULT_K = 11;
/**
 * A k-mer occurring more often than this is repetitive -- a poly-A run, a
 * tandem repeat, the backbone shared by half the library. Seeding from it costs
 * far more than it finds, so it is dropped. The count is reported rather than
 * hidden, because a masked k-mer is a place the search is blind.
 */
const MAX_POSTINGS = 200;

export function buildIndex(sequences: LibrarySequence[], k = DEFAULT_K): LibraryIndex {
  const postings = new Map<string, number[]>();

  sequences.forEach((s, si) => {
    const seq = s.sequence.toUpperCase();
    // A circular sequence is searched across its own origin, so a hit spanning
    // the join is not cut in half by an arbitrary numbering choice.
    const scan = s.topology === 'circular' && seq.length > k ? seq + seq.slice(0, k - 1) : seq;
    for (let i = 0; i + k <= scan.length; i++) {
      const kmer = scan.slice(i, i + k);
      if (kmer.includes('N')) continue;
      let list = postings.get(kmer);
      if (!list) postings.set(kmer, (list = []));
      list.push(si, i);
    }
  });

  let masked = 0;
  for (const [kmer, list] of postings) {
    if (list.length / 2 > MAX_POSTINGS) { postings.delete(kmer); masked++; }
  }

  return { k, sequences, postings, masked };
}

/**
 * Ungapped extension in one direction, stopping when the score falls away.
 *
 * `wrap`, when set, is the length of a circular subject: subject positions are
 * then taken modulo it, so an extension that runs off either end continues
 * round the plasmid instead of stopping at a numbering boundary. `budget` caps
 * how far it may go, which is what keeps a query made of tandem repeats from
 * circling the plasmid indefinitely.
 */
function extend(
  q: string, s: string, qi: number, si: number, step: 1 | -1, xDrop: number,
  wrap?: number, budget = Infinity,
): { steps: number; matches: number; score: number } {
  let score = 0, best = 0, bestSteps = 0, bestMatches = 0, matches = 0;
  let n = 0;
  while (n < budget) {
    const qp = qi + step * n;
    const spRaw = si + step * n;
    if (qp < 0 || qp >= q.length) break;
    let sp = spRaw;
    if (wrap !== undefined) sp = ((spRaw % wrap) + wrap) % wrap;
    else if (spRaw < 0 || spRaw >= s.length) break;
    if (q[qp] === s[sp]) { score += 1; matches++; } else { score -= 3; }
    n++;
    if (score > best) { best = score; bestSteps = n; bestMatches = matches; }
    if (best - score > xDrop) break;
  }
  return { steps: bestSteps, matches: bestMatches, score: best };
}

export function search(index: LibraryIndex, queryRaw: string, opts: SearchOptions = {}): Hit[] {
  const { minLength = 30, minIdentity = 0.8, xDrop = 20, maxHits = 50 } = opts;
  const { k } = index;
  const query = queryRaw.toUpperCase().replace(/[^ACGTN]/g, '');
  if (query.length < k) return [];

  const hits: Hit[] = [];

  for (const strand of ['+', '-'] as const) {
    const q = strand === '+' ? query : revComp(query);

    // Seeds grouped by subject and diagonal. Two k-mers on one diagonal are
    // almost always one alignment, so extending each separately would do the
    // same work several times over.
    const diagonals = new Map<string, { si: number; seeds: { qi: number; sPos: number }[] }>();
    for (let i = 0; i + k <= q.length; i++) {
      const list = index.postings.get(q.slice(i, i + k));
      if (!list) continue;
      for (let p = 0; p < list.length; p += 2) {
        const si = list[p], sPos = list[p + 1];
        const key = `${si}:${sPos - i}`;
        let d = diagonals.get(key);
        if (!d) diagonals.set(key, (d = { si, seeds: [] }));
        // The subject position travels with the seed. Recovering it later from
        // the k-mer would mean guessing which of that k-mer's occurrences this
        // seed came from, and a k-mer that occurs twice in one plasmid makes
        // that guess wrong.
        d.seeds.push({ qi: i, sPos });
      }
    }

    for (const { si, seeds } of diagonals.values()) {
      const subject = index.sequences[si];
      const s = subject.sequence.toUpperCase();
      const circular = subject.topology === 'circular';
      // One extension per diagonal, from its first seed; the X-drop carries it
      // through the rest.
      const covered: { from: number; to: number }[] = [];

      for (const { qi, sPos } of seeds) {
        if (covered.some(c => qi >= c.from && qi <= c.to)) continue;
        // Positions past the end belong to the wrapped copy of a circular
        // sequence; bring them back into range.
        const sStart = circular ? sPos % s.length : sPos;

        const wrap = circular ? s.length : undefined;
        // A hit can never be longer than the plasmid itself; the two directions
        // share that budget so an extension cannot lap the origin.
        const right = extend(q, s, qi + k, sStart + k, 1, xDrop, wrap, s.length - k);
        const left = extend(q, s, qi - 1, sStart - 1, -1, xDrop, wrap, s.length - k - right.steps);

        const qFrom = qi - left.steps;
        const qTo = qi + k - 1 + right.steps;
        const sFrom = sStart - left.steps;
        const sTo = sStart + k - 1 + right.steps;
        const length = qTo - qFrom + 1;
        const matches = left.matches + k + right.matches;
        const identity = matches / length;

        covered.push({ from: qFrom, to: qTo });
        if (length < minLength || identity < minIdentity) continue;

        // Report query coordinates against the sequence the caller handed in,
        // not against its reverse complement.
        const [qs, qe] = strand === '+'
          ? [qFrom + 1, qTo + 1]
          : [query.length - qTo, query.length - qFrom];

        // On a circular plasmid a hit through the origin is reported with its
        // end before its start, the way GenBank writes a wrapped feature. It is
        // one hit, and pretending otherwise would be the bug this fixes.
        const norm = (p: number) => (circular ? ((p % s.length) + s.length) % s.length : p) + 1;

        hits.push({
          id: subject.id,
          name: subject.name,
          queryStart: qs,
          queryEnd: qe,
          subjectStart: norm(sFrom),
          subjectEnd: norm(sTo),
          wrapsOrigin: circular && norm(sTo) < norm(sFrom),
          strand,
          length,
          identity,
          score: left.score + k + right.score,
        });
      }
    }
  }

  // One diagonal can still yield overlapping segments from different seeds.
  const kept: Hit[] = [];
  for (const h of hits.sort((a, b) => b.score - a.score)) {
    // Overlap is judged on the query only. Two segments on one subject that
    // cover the same stretch of the query are the same finding; comparing
    // subject ranges as well would treat a hit wrapped past the origin, whose
    // end number is smaller than its start, as a separate one.
    const dup = kept.some(x =>
      x.id === h.id && x.strand === h.strand &&
      h.queryStart <= x.queryEnd && h.queryEnd >= x.queryStart);
    if (!dup) kept.push(h);
    if (kept.length >= maxHits) break;
  }
  return kept;
}

export interface SearchSummary {
  hits: Hit[];
  /** Set when one hit covers essentially the whole query at high identity. */
  alreadyHave?: { id: string; name: string; identity: number; coverage: number };
}

/**
 * The search, plus the one conclusion people actually want from it.
 *
 * "You already have this" is worth saying outright: a near-full-length,
 * near-identical hit is the difference between ordering a synthesis and
 * fetching a tube from the freezer.
 */
export function searchLibrary(
  index: LibraryIndex, query: string, opts: SearchOptions = {},
): SearchSummary {
  const hits = search(index, query, opts);
  const clean = query.toUpperCase().replace(/[^ACGTN]/g, '');
  const top = hits[0];
  if (!top || clean.length === 0) return { hits };

  const coverage = top.length / clean.length;
  if (coverage >= 0.95 && top.identity >= 0.98) {
    return {
      hits,
      alreadyHave: { id: top.id, name: top.name, identity: top.identity, coverage },
    };
  }
  return { hits };
}
