/**
 * Deterministic test sequences.
 *
 * Counter-based rather than a running generator: every position is hashed from
 * (seed, position) independently, so two different seeds give two genuinely
 * unrelated sequences. A plain linear-congruential generator does not -- its
 * low bits have short periods, and two streams started from different seeds
 * drift into producing the same bases and then stay there. A library of
 * fixtures built that way shares hundreds of bases of accidental homology,
 * which a sequence-search test will faithfully report and which will look
 * exactly like a bug in the search.
 */
export function makeSeq(n: number, seed = 7): string {
  const bases = 'ACGT';
  let out = '';
  for (let i = 0; i < n; i++) {
    let h = (Math.imul(seed, 0x9e3779b9) + Math.imul(i, 0x85ebca6b)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
    h ^= h >>> 16;
    out += bases[h & 3];
  }
  return out;
}

/** Longest run of bases two sequences share, for checking fixtures are clean. */
export function longestSharedRun(a: string, b: string): number {
  const seen = new Set<string>();
  const w = 20;
  for (let i = 0; i + w <= a.length; i++) seen.add(a.slice(i, i + w));
  for (let i = 0; i + w <= b.length; i++) if (seen.has(b.slice(i, i + w))) return w;
  return 0;
}
