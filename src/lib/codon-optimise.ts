import { CODON_TABLE } from './molbuilder-logic';
import { SYNONYMS, cai, rareCodons, type CodonUsage } from './codon-usage';
import { ENZYMES } from './restrictionEnzymes';
import { hairpins } from './secondary-structure';
import { revComp } from './alignment';

/**
 * Rewriting a gene for a different host without changing the protein.
 *
 * The naive method -- replace every codon with its host's favourite -- is worse
 * than doing nothing, and it is what most tools shipped for years. It produces
 * long runs of the same codon, which deplete one tRNA locally; it flattens the
 * codon usage to something no real gene resembles; and by fixing each position
 * independently it has no way to avoid the things that actually break
 * expression: a restriction site landing in the middle of the insert, a hairpin
 * over the start codon, a repeat that makes the fragment unsynthesisable.
 *
 * What happens here instead: choose codons by sampling their host frequencies,
 * so the output looks like a gene from that organism rather than like a
 * spreadsheet, then repair the problems that sampling leaves behind. Every
 * repair is a synonymous change, so the protein is invariant by construction --
 * and that invariant is checked before anything is returned, because a codon
 * optimiser that silently changes the protein is worse than no optimiser.
 */

export interface OptimiseOptions {
  usage: CodonUsage;
  /** Enzymes whose sites must not appear. Names as in the enzyme table. */
  avoidSites?: string[];
  /** Keep GC in this band where synonymous choices allow. */
  gcRange?: [number, number];
  /** Avoid repeats at least this long, which make synthesis fail or misassemble. */
  maxRepeat?: number;
  /** Never emit a codon used less than this share of its family. */
  rareFloor?: number;
  /** Deterministic output. Same seed, same gene. */
  seed?: number;
}

export interface Change {
  /** 1-indexed codon number. */
  position: number;
  from: string;
  to: string;
  aa: string;
  reason: string;
}

export interface OptimiseResult {
  sequence: string;
  protein: string;
  changes: Change[];
  before: Metrics;
  after: Metrics;
  /** Problems that could not be fixed without changing the protein. */
  unresolved: string[];
  notes: string[];
}

export interface Metrics {
  cai: number;
  gc: number;
  rareCount: number;
  rareClusters: number;
  siteHits: { enzyme: string; positions: number[] }[];
  longestRepeat: number;
  startStructureDG: number;
}

/** Deterministic PRNG, so an optimisation is reproducible and reviewable. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

export function translate(seq: string): string {
  const s = seq.toUpperCase().replace(/U/g, 'T');
  let out = '';
  for (let i = 0; i + 3 <= s.length; i += 3) out += CODON_TABLE[s.slice(i, i + 3)] ?? 'X';
  return out;
}

function gcOf(s: string): number {
  return s.length ? (s.match(/[GC]/g) ?? []).length / s.length : 0;
}

/** Longest exactly repeated substring, capped at `limit` so the scan stays cheap. */
export function longestRepeat(s: string, limit = 30): number {
  for (let n = limit; n >= 8; n--) {
    const seen = new Set<string>();
    for (let i = 0; i + n <= s.length; i++) {
      const sub = s.slice(i, i + n);
      if (seen.has(sub)) return n;
      seen.add(sub);
    }
  }
  return 0;
}

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]', K: '[GT]', M: '[AC]',
  B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]',
};

/** A recognition pattern as a regex; ambiguity codes are real, not noise. */
function siteRegex(pattern: string): RegExp | null {
  const body = pattern.toUpperCase().split('').map(c => IUPAC[c]).join('');
  return body.length === pattern.length ? new RegExp(body, 'g') : null;
}

function findAll(seq: string, re: RegExp): number[] {
  const out: number[] = [];
  // Overlapping matches count: two sites can share bases, and skipping past a
  // whole match would miss the second one.
  for (let i = 0; i < seq.length; i++) {
    re.lastIndex = i;
    const m = re.exec(seq);
    if (!m || m.index !== i) continue;
    out.push(i);
  }
  return out;
}

function siteHits(seq: string, names: string[]): { enzyme: string; positions: number[] }[] {
  const out: { enzyme: string; positions: number[] }[] = [];
  for (const name of names) {
    const enz = ENZYMES[name];
    if (!enz?.pattern) continue;
    const positions = new Set<number>();
    // Both strands: a site is double-stranded, and an enzyme does not care
    // which strand the recognition sequence happened to be written on. For a
    // palindrome the two searches agree, which is why the set is a set.
    for (const pat of new Set([enz.pattern.toUpperCase(), revComp(enz.pattern.toUpperCase())])) {
      const re = siteRegex(pat);
      if (!re) continue;
      for (const i of findAll(seq, re)) positions.add(i);
    }
    if (positions.size) out.push({ enzyme: name, positions: [...positions].sort((a, b) => a - b) });
  }
  return out;
}

function measure(seq: string, opts: OptimiseOptions): Metrics {
  const rare = rareCodons(seq, opts.usage);
  // Fold only the start region; the whole CDS is neither affordable to fold nor
  // meaningful to fold as one structure.
  const startWindow = seq.slice(0, Math.min(seq.length, 60));
  const hp = hairpins(startWindow, { maxDG: -1 })[0];
  return {
    cai: cai(seq, opts.usage),
    gc: gcOf(seq),
    rareCount: rare.length,
    rareClusters: rare.filter(r => r.inCluster).length,
    siteHits: siteHits(seq, opts.avoidSites ?? []),
    longestRepeat: longestRepeat(seq),
    startStructureDG: hp?.dG ?? 0,
  };
}

/**
 * Codons for one amino acid, ordered by how good a choice they are here.
 *
 * Not simply by frequency: the pick is sampled from the frequency distribution
 * so the result has a realistic codon mix, but codons below the rare floor are
 * dropped first so sampling can never produce the very thing being optimised
 * away.
 */
function candidates(aa: string, usage: CodonUsage, rareFloor: number): string[] {
  const family = SYNONYMS[aa] ?? [];
  const usable = family.filter(c => (usage.freq[c] ?? 0) >= rareFloor);
  // An amino acid whose every codon is below the floor still has to be encoded.
  const pool = usable.length ? usable : family;
  return [...pool].sort((a, b) => (usage.freq[b] ?? 0) - (usage.freq[a] ?? 0));
}

function sample(aa: string, usage: CodonUsage, rareFloor: number, rand: () => number): string {
  const pool = candidates(aa, usage, rareFloor);
  const total = pool.reduce((s, c) => s + (usage.freq[c] ?? 0), 0);
  if (total <= 0) return pool[0];
  let r = rand() * total;
  for (const c of pool) {
    r -= usage.freq[c] ?? 0;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

export function optimise(cds: string, opts: OptimiseOptions): OptimiseResult {
  const original = cds.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T');
  const {
    usage, avoidSites = [], gcRange = [0.3, 0.7], maxRepeat = 15, rareFloor = 0.1, seed = 1,
  } = opts;

  if (original.length < 3) throw new Error('Give a coding sequence of at least one codon.');
  if (original.length % 3 !== 0) {
    throw new Error(
      `${original.length} bases is not a whole number of codons. ` +
      'Trim to the coding sequence first — optimising a partial codon would shift the frame.',
    );
  }

  const protein = translate(original);
  if (protein.includes('X')) throw new Error('The sequence contains bases that do not form a codon.');

  const rand = rng(seed);
  const before = measure(original, opts);
  const notes: string[] = [];

  // Pass 1: sample a codon for each residue.
  const codons: string[] = [];
  for (let i = 0; i < protein.length; i++) {
    const aa = protein[i];
    // A stop is not a choice about translation speed; keep the original.
    codons.push(aa === '*' ? original.slice(i * 3, i * 3 + 3) : sample(aa, usage, rareFloor, rand));
  }

  const unresolved: string[] = [];

  // Pass 2: repair. Each repair swaps one codon for a synonym, so the protein
  // cannot change; the loop re-measures after each so a fix that creates a new
  // problem is seen.
  const alternatives = (i: number, exclude: string) =>
    candidates(protein[i], usage, rareFloor).filter(c => c !== exclude);

  /** Try every synonym at each codon in `range`, keeping the first that helps. */
  const repair = (
    range: number[], describe: string, hurts: (seq: string) => boolean,
  ): boolean => {
    for (const i of range) {
      if (protein[i] === '*') continue;
      for (const alt of alternatives(i, codons[i])) {
        const saved = codons[i];
        codons[i] = alt;
        if (!hurts(codons.join(''))) return true;
        codons[i] = saved;
      }
    }
    unresolved.push(describe);
    return false;
  };

  // Restriction sites, which are the repair people care most about: a site
  // inside the insert makes the insert uncloneable by that enzyme.
  for (let guard = 0; guard < 200; guard++) {
    const hits = siteHits(codons.join(''), avoidSites);
    if (hits.length === 0) break;
    const { enzyme, positions } = hits[0];
    const at = positions[0];
    // Any codon overlapping the site can break it.
    const first = Math.floor(at / 3);
    const last = Math.floor((at + 7) / 3);
    const range = Array.from({ length: last - first + 1 }, (_, k) => first + k)
      .filter(i => i >= 0 && i < protein.length);
    const fixed = repair(
      range,
      `${enzyme} site at ${at + 1} could not be removed without changing the protein.`,
      s => siteHits(s, [enzyme]).some(h => h.positions.includes(at)),
    );
    if (!fixed) break;
    // Whether the site came in with the sequence or was created by the codon
    // sampling a moment ago is the difference between "your gene had this
    // problem" and "the optimiser nearly gave you one". Saying "removed" for
    // both leaves the reader hunting for a site that was never in their input.
    const wasOriginal = siteHits(original, [enzyme]).some(h => h.positions.includes(at));
    notes.push(wasOriginal
      ? `Removed the ${enzyme} site at position ${at + 1}.`
      : `Avoided introducing a ${enzyme} site at position ${at + 1}.`);
  }

  // Repeats, which make a fragment expensive or impossible to synthesise.
  for (let guard = 0; guard < 60; guard++) {
    const rep = longestRepeat(codons.join(''), Math.max(maxRepeat + 10, 30));
    if (rep <= maxRepeat) break;
    const seq = codons.join('');
    // Locate one copy of the offending repeat and rewrite a codon inside it.
    let where = -1;
    const seen = new Map<string, number>();
    for (let i = 0; i + rep <= seq.length; i++) {
      const sub = seq.slice(i, i + rep);
      if (seen.has(sub)) { where = i; break; }
      seen.set(sub, i);
    }
    if (where < 0) break;
    const first = Math.floor(where / 3);
    const range = Array.from({ length: Math.ceil(rep / 3) + 1 }, (_, k) => first + k)
      .filter(i => i < protein.length);
    const fixed = repair(
      range,
      `A ${rep} bp repeat could not be broken without changing the protein.`,
      s => longestRepeat(s, Math.max(maxRepeat + 10, 30)) > maxRepeat,
    );
    if (!fixed) break;
  }

  // Structure over the start codon, which decides expression more often than
  // any codon choice further in.
  {
    const startDG = () => hairpins(codons.join('').slice(0, 60), { maxDG: -1 })[0]?.dG ?? 0;
    if (startDG() <= -8) {
      const range = Array.from({ length: Math.min(12, protein.length) }, (_, k) => k);
      const fixed = repair(
        range,
        'A hairpin over the start codon could not be relieved by synonymous changes alone. A 5′ UTR change may be needed.',
        () => startDG() <= -8,
      );
      if (fixed) notes.push('Relaxed a hairpin over the start codon.');
    }
  }

  // GC, last: it is the softest constraint and the easiest to trade away.
  {
    const [lo, hi] = gcRange;
    for (let guard = 0; guard < 200; guard++) {
      const seq = codons.join('');
      const gc = gcOf(seq);
      if (gc >= lo && gc <= hi) break;
      const wantMoreGC = gc < lo;
      let moved = false;
      for (let i = 0; i < protein.length; i++) {
        if (protein[i] === '*') continue;
        for (const alt of alternatives(i, codons[i])) {
          const delta = gcOf(alt) - gcOf(codons[i]);
          if (wantMoreGC ? delta > 0 : delta < 0) {
            const saved = codons[i];
            codons[i] = alt;
            // Never undo a repair to satisfy GC.
            const s = codons.join('');
            if (siteHits(s, avoidSites).length === 0 && longestRepeat(s, maxRepeat + 10) <= maxRepeat) {
              moved = true;
              break;
            }
            codons[i] = saved;
          }
        }
        if (moved) break;
      }
      if (!moved) {
        unresolved.push(
          `GC settled at ${(gcOf(codons.join('')) * 100).toFixed(1)}%, outside the ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}% band. No further synonymous change moves it without undoing another fix.`,
        );
        break;
      }
    }
  }

  const sequence = codons.join('');

  // The invariant, checked rather than assumed. Every step above is synonymous
  // by construction, which is exactly the kind of claim that is true until one
  // day it is not.
  const after = translate(sequence);
  if (after !== protein) {
    throw new Error(
      'Internal error: optimisation changed the protein. Refusing to return the sequence.',
    );
  }

  const afterMetrics = measure(sequence, opts);

  // Notes so far describe what the repair loop did. A site can also disappear
  // simply because pass 1 resampled the codons under it, and that case reached
  // the reader as nothing at all -- the metrics said a site went away and no
  // line said why. Reconcile against what actually changed.
  for (const hit of before.siteHits) {
    if (afterMetrics.siteHits.some(h => h.enzyme === hit.enzyme)) continue;
    if (notes.some(n => n.includes(hit.enzyme))) continue;
    const n = hit.positions.length;
    notes.push(
      `Removed the ${hit.enzyme} site${n === 1 ? '' : `s (${n})`} at ` +
      `${hit.positions.map(x => x + 1).join(', ')}.`,
    );
  }

  const changes: Change[] = [];
  for (let i = 0; i < protein.length; i++) {
    const from = original.slice(i * 3, i * 3 + 3);
    if (from !== codons[i]) {
      changes.push({
        position: i + 1,
        from,
        to: codons[i],
        aa: protein[i],
        reason: `${((usage.freq[from] ?? 0) * 100).toFixed(0)}% → ${((usage.freq[codons[i]] ?? 0) * 100).toFixed(0)}% in ${usage.name}`,
      });
    }
  }

  return {
    sequence,
    protein,
    changes,
    before,
    after: afterMetrics,
    unresolved: [...new Set(unresolved)],
    notes,
  };
}
