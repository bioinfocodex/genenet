import { CODON_TABLE } from './molbuilder-logic';
import { SYNONYMS, type CodonUsage } from './codon-usage';
import { ENZYMES } from './restrictionEnzymes';
import { revComp } from './alignment';

/**
 * Changing the DNA without changing the protein.
 *
 * Two jobs, one mechanism. Adding a silent restriction site gives a clone a
 * diagnostic digest that tells the right construct from the wrong one in an
 * afternoon, instead of waiting on sequencing. Removing one clears an internal
 * site that is blocking the cloning strategy. Both come down to: which
 * synonymous codon substitutions, over this stretch, produce the DNA I want and
 * the protein I already have.
 *
 * The search is exhaustive over the codons a site could span, which is at most
 * four or five for the usual six-base cutters -- small enough to enumerate
 * rather than approximate. Candidates are ranked by how few bases change and
 * how common the resulting codons are in the host, because a site introduced
 * with a codon the host never uses buys a diagnostic digest at the cost of
 * expression.
 */

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]', K: '[GT]', M: '[AC]',
  B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]',
};

/** Concrete bases an ambiguity code stands for. */
const EXPAND: Record<string, string[]> = {
  A: ['A'], C: ['C'], G: ['G'], T: ['T'],
  R: ['A', 'G'], Y: ['C', 'T'], S: ['G', 'C'], W: ['A', 'T'],
  K: ['G', 'T'], M: ['A', 'C'],
  B: ['C', 'G', 'T'], D: ['A', 'G', 'T'], H: ['A', 'C', 'T'], V: ['A', 'C', 'G'],
  N: ['A', 'C', 'G', 'T'],
};

function siteRegex(pattern: string): RegExp | null {
  const body = pattern.toUpperCase().split('').map(c => IUPAC[c]).join('');
  return body.length === pattern.length ? new RegExp(body) : null;
}

export function translate(seq: string): string {
  const s = seq.toUpperCase().replace(/U/g, 'T');
  let out = '';
  for (let i = 0; i + 3 <= s.length; i += 3) out += CODON_TABLE[s.slice(i, i + 3)] ?? 'X';
  return out;
}

export interface SilentChange {
  /** 1-indexed codon number within the CDS. */
  codonPosition: number;
  from: string;
  to: string;
  aa: string;
  /** How common the new codon is in the chosen host, 0..1. */
  hostFrequency: number;
}

export interface SiteCandidate {
  enzyme: string;
  /** 0-indexed position in the CDS where the new site starts. */
  position: number;
  /** The CDS after the change. */
  sequence: string;
  changes: SilentChange[];
  /** Bases changed, summed over the changes. */
  basesChanged: number;
  /**
   * Lowest host frequency among the codons introduced. A candidate needing a
   * codon the host barely uses is a worse trade than one that does not.
   */
  worstCodonFrequency: number;
  /** True when this enzyme cuts nowhere else in the sequence. */
  unique: boolean;
}

/** Every concrete sequence an ambiguous recognition pattern can take. */
function expandPattern(pattern: string, cap = 256): string[] {
  let out = [''];
  for (const c of pattern.toUpperCase()) {
    const bases = EXPAND[c];
    if (!bases) return [];
    const next: string[] = [];
    for (const prefix of out) for (const b of bases) next.push(prefix + b);
    // A fully degenerate pattern would explode; those enzymes are not useful as
    // diagnostic sites anyway, so stopping is the right answer.
    if (next.length > cap) return [];
    out = next;
  }
  return out;
}

function countSites(seq: string, pattern: string): number {
  const re = siteRegex(pattern);
  if (!re) return 0;
  let n = 0;
  for (let i = 0; i < seq.length; i++) {
    const m = re.exec(seq.slice(i, i + pattern.length));
    if (m && m.index === 0) n++;
  }
  return n;
}

/**
 * Places a silent restriction site can be introduced into a coding sequence.
 *
 * Walks every position, and at each asks whether the site's bases can be
 * spelled by synonymous codons. Only positions where the answer is yes come
 * back, each with the exact codon changes needed.
 */
export function findSilentSites(
  cds: string,
  enzymeNames: string[],
  usage: CodonUsage,
  opts: { uniqueOnly?: boolean; maxPerEnzyme?: number } = {},
): SiteCandidate[] {
  const { uniqueOnly = false, maxPerEnzyme = 20 } = opts;
  const seq = cds.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T');
  if (seq.length % 3 !== 0) {
    throw new Error(`${seq.length} bases is not a whole number of codons.`);
  }
  const protein = translate(seq);
  const out: SiteCandidate[] = [];

  for (const name of enzymeNames) {
    const enz = ENZYMES[name];
    if (!enz?.pattern) continue;
    const spellings = expandPattern(enz.pattern);
    if (spellings.length === 0) continue;

    // Both orientations: a site introduced on either strand is a site.
    const targets = [...new Set(spellings.flatMap(s => [s, revComp(s)]))];
    const existing = countSites(seq, enz.pattern);
    let found = 0;

    for (let at = 0; at + enz.pattern.length <= seq.length && found < maxPerEnzyme; at++) {
      const firstCodon = Math.floor(at / 3);
      const lastCodon = Math.floor((at + enz.pattern.length - 1) / 3);

      for (const target of targets) {
        const candidate = seq.slice(0, at) + target + seq.slice(at + target.length);
        // The only question that matters: is the protein the same?
        if (translate(candidate) !== protein) continue;

        const changes: SilentChange[] = [];
        for (let c = firstCodon; c <= lastCodon; c++) {
          const from = seq.slice(c * 3, c * 3 + 3);
          const to = candidate.slice(c * 3, c * 3 + 3);
          if (from === to) continue;
          changes.push({
            codonPosition: c + 1,
            from,
            to,
            aa: protein[c],
            hostFrequency: usage.freq[to] ?? 0,
          });
        }
        if (changes.length === 0) continue;   // the site was already there

        const total = countSites(candidate, enz.pattern);
        const unique = total === 1;
        if (uniqueOnly && !unique) continue;

        out.push({
          enzyme: name,
          position: at,
          sequence: candidate,
          changes,
          basesChanged: changes.reduce(
            (s, ch) => s + [...ch.from].filter((b, i) => b !== ch.to[i]).length, 0,
          ),
          worstCodonFrequency: Math.min(...changes.map(ch => ch.hostFrequency)),
          unique,
        });
        found++;
        break;   // one spelling per position is enough
      }
    }
    void existing;
  }

  // Fewest bases changed first, then the friendliest codons. A one-base change
  // is one mutagenesis primer; a four-base change across two codons is a
  // synthesis order.
  return out.sort((a, b) =>
    a.basesChanged - b.basesChanged ||
    b.worstCodonFrequency - a.worstCodonFrequency ||
    a.position - b.position);
}

export interface RemovalCandidate {
  enzyme: string;
  /** 0-indexed position of the site being removed. */
  position: number;
  sequence: string;
  changes: SilentChange[];
  basesChanged: number;
  worstCodonFrequency: number;
}

/**
 * Ways to remove an unwanted site without changing the protein.
 *
 * The site is removed by changing one codon that overlaps it; every synonym of
 * every overlapping codon is tried, and any that breaks the site is a
 * candidate. When none does, the site cannot be removed silently -- which
 * happens, and is worth saying plainly rather than returning an empty list that
 * looks like "nothing to do".
 */
export function removeSiteSilently(
  cds: string,
  enzymeName: string,
  usage: CodonUsage,
): { candidates: RemovalCandidate[]; sites: number[]; impossible: number[] } {
  const seq = cds.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T');
  if (seq.length % 3 !== 0) {
    throw new Error(`${seq.length} bases is not a whole number of codons.`);
  }
  const enz = ENZYMES[enzymeName];
  if (!enz?.pattern) throw new Error(`Unknown enzyme "${enzymeName}".`);

  const protein = translate(seq);
  const re = siteRegex(enz.pattern);
  if (!re) return { candidates: [], sites: [], impossible: [] };

  const sites: number[] = [];
  for (let i = 0; i + enz.pattern.length <= seq.length; i++) {
    const m = re.exec(seq.slice(i, i + enz.pattern.length));
    if (m && m.index === 0) sites.push(i);
  }

  const candidates: RemovalCandidate[] = [];
  const impossible: number[] = [];

  for (const at of sites) {
    const first = Math.floor(at / 3);
    const last = Math.floor((at + enz.pattern.length - 1) / 3);
    let any = false;

    for (let c = first; c <= last; c++) {
      const from = seq.slice(c * 3, c * 3 + 3);
      const aa = protein[c];
      for (const alt of SYNONYMS[aa] ?? []) {
        if (alt === from) continue;
        const candidate = seq.slice(0, c * 3) + alt + seq.slice(c * 3 + 3);
        // Still the same protein by construction, but check the site is gone
        // from this position specifically.
        const stillThere = (() => {
          const m = re.exec(candidate.slice(at, at + enz.pattern.length));
          return !!m && m.index === 0;
        })();
        if (stillThere) continue;

        any = true;
        candidates.push({
          enzyme: enzymeName,
          position: at,
          sequence: candidate,
          changes: [{
            codonPosition: c + 1, from, to: alt, aa, hostFrequency: usage.freq[alt] ?? 0,
          }],
          basesChanged: [...from].filter((b, i) => b !== alt[i]).length,
          worstCodonFrequency: usage.freq[alt] ?? 0,
        });
      }
    }
    if (!any) impossible.push(at);
  }

  candidates.sort((a, b) =>
    a.basesChanged - b.basesChanged || b.worstCodonFrequency - a.worstCodonFrequency);

  return { candidates, sites, impossible };
}
