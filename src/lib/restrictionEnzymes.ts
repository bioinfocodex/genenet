export interface Enzyme {
  name: string;
  pattern: string;
  /**
   * Top-strand cut, as an offset from the start of the recognition site.
   * For Type IIS enzymes this is past the end of the site: BsaI recognises
   * GGTCTC and cuts one base beyond it, so cutBefore is 7.
   */
  cutBefore: number;
  /** Bottom-strand cut, same frame of reference. */
  cutBottom?: number;
  /**
   * The overhang sequence, when the site fixes it. Empty for blunt cutters and
   * for Type IIS, where the overhang is whatever the target sequence happens to
   * be at the cut -- which is exactly why Golden Gate works.
   */
  overhang: string;
  overhangType: '5prime' | '3prime' | 'blunt';
  /** Overhang length in bases, known even when the sequence is not. */
  overhangLength?: number;
  /** Cuts outside its recognition site. */
  typeIIS?: boolean;
}

/**
 * Every Type II restriction enzyme in REBASE that has a commercial supplier.
 *
 * This was a hand-written table of twenty. The digest logic was never the
 * limitation -- it worked; it simply had almost nothing to work on, and a
 * cloning tool that does not know BsaI cannot do Golden Gate.
 *
 * All twenty of the original entries were checked against REBASE before being
 * replaced, and all twenty agreed on pattern, cut position, overhang and
 * overhang type.
 */
export { REBASE_ENZYMES } from './restrictionEnzymes.data';
export const ENZYMES: Record<string, Enzyme> = REBASE_TABLE;

// Enzyme pairs that produce compatible cohesive ends (can ligate together)
const COMPATIBLE_PAIRS = new Set([
  'XhoI:SalI', 'SalI:XhoI',
  'BamHI:BglII', 'BglII:BamHI',
  'XbaI:SpeI', 'SpeI:XbaI',
  'XbaI:NheI', 'NheI:XbaI',
  'SpeI:NheI', 'NheI:SpeI',
]);

export function areEndsCompatible(e1: string, e2: string): boolean {
  if (e1 === e2) return true;
  return COMPATIBLE_PAIRS.has(`${e1}:${e2}`);
}

import { REBASE_ENZYMES as REBASE_TABLE } from './restrictionEnzymes.data';

// IUPAC nucleotide base matching
function matchesIUPAC(base: string, code: string): boolean {
  const map: Record<string, string[]> = {
    A: ['A'], T: ['T'], G: ['G'], C: ['C'],
    R: ['A', 'G'], Y: ['C', 'T'], S: ['G', 'C'], W: ['A', 'T'],
    K: ['G', 'T'], M: ['A', 'C'], B: ['C', 'G', 'T'], D: ['A', 'G', 'T'],
    H: ['A', 'C', 'T'], V: ['A', 'C', 'G'], N: ['A', 'T', 'G', 'C'],
  };
  return (map[code] ?? [code]).includes(base);
}

function matchesPattern(seq: string, pattern: string): boolean {
  if (seq.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (!matchesIUPAC(seq[i], pattern[i])) return false;
  }
  return true;
}

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
  return seq.split('').reverse().map(b => comp[b] ?? b).join('');
}

export function findCutSites(sequence: string, enzyme: Enzyme): number[] {
  const seq = sequence.toUpperCase();
  const pat = enzyme.pattern;
  const positions = new Set<number>();

  for (let i = 0; i <= seq.length - pat.length; i++) {
    const sub = seq.substring(i, i + pat.length);
    if (matchesPattern(sub, pat)) {
      positions.add(i + enzyme.cutBefore);
    }
    // Check reverse complement (for non-palindromes)
    const rc = reverseComplement(sub);
    if (rc !== sub && matchesPattern(rc, pat)) {
      positions.add(i + (pat.length - enzyme.cutBefore));
    }
  }

  return [...positions].sort((a, b) => a - b);
}

export interface Fragment {
  size: number;
  startPos: number;
  endPos: number;
  label: string;
  fromEnzyme: string; // enzyme that produced the 5' end ('start' or 'end' for termini)
  toEnzyme: string;   // enzyme that produced the 3' end
}

export interface DigestResult {
  fragments: Fragment[];
  cutSites: { enzyme: string; position: number }[];
}

// Digest a LINEAR sequence (e.g. PCR product / gene insert)
export function digestLinear(sequence: string, enzymeNames: string[]): DigestResult {
  const cutSites: { enzyme: string; position: number }[] = [];

  for (const name of enzymeNames) {
    const enzyme = ENZYMES[name];
    if (!enzyme) continue;
    findCutSites(sequence, enzyme).forEach(pos => cutSites.push({ enzyme: name, position: pos }));
  }

  cutSites.sort((a, b) => a.position - b.position);

  const boundaries = [0, ...cutSites.map(c => c.position), sequence.length];
  const fragments: Fragment[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    fragments.push({
      size: end - start,
      startPos: start,
      endPos: end,
      label: `${end - start} bp`,
      fromEnzyme: i === 0 ? 'start' : cutSites[i - 1].enzyme,
      toEnzyme: i === cutSites.length ? 'end' : cutSites[i].enzyme,
    });
  }

  return { fragments, cutSites };
}

// Digest a CIRCULAR sequence (plasmid)
export function digestCircular(sequence: string, enzymeNames: string[]): DigestResult {
  const cutSites: { enzyme: string; position: number }[] = [];

  for (const name of enzymeNames) {
    const enzyme = ENZYMES[name];
    if (!enzyme) continue;
    findCutSites(sequence, enzyme).forEach(pos => cutSites.push({ enzyme: name, position: pos }));
  }

  cutSites.sort((a, b) => a.position - b.position);

  if (cutSites.length === 0) return { fragments: [], cutSites: [] };

  const len = sequence.length;
  const fragments: Fragment[] = [];

  for (let i = 0; i < cutSites.length; i++) {
    const start = cutSites[i].position;
    const nextIdx = (i + 1) % cutSites.length;
    const end = cutSites[nextIdx].position;
    const size = i < cutSites.length - 1 ? end - start : len - start + cutSites[0].position;

    fragments.push({
      size,
      startPos: start,
      endPos: end,
      label: `${size} bp`,
      fromEnzyme: cutSites[i].enzyme,
      toEnzyme: cutSites[nextIdx].enzyme,
    });
  }

  return { fragments, cutSites };
}

// Identify the insert fragment (fragment flanked by the two enzyme cut sites)
export function findInsertFragment(result: DigestResult, enzyme1: string, enzyme2?: string): Fragment | null {
  if (result.fragments.length === 0) return null;

  if (!enzyme2 || enzyme1 === enzyme2) {
    // Single enzyme: return the largest fragment (typically the insert)
    return result.fragments.reduce((a, b) => a.size > b.size ? a : b);
  }

  // Two enzymes: fragment that starts at enzyme1 and ends at enzyme2 (or vice versa)
  for (const frag of result.fragments) {
    const fwd = frag.fromEnzyme === enzyme1 && frag.toEnzyme === enzyme2;
    const rev = frag.fromEnzyme === enzyme2 && frag.toEnzyme === enzyme1;
    if (fwd || rev) return frag;
  }

  return null;
}

// Vector backbone = largest fragment after circular digest
export function findVectorBackbone(result: DigestResult): Fragment | null {
  if (result.fragments.length === 0) return null;
  return result.fragments.reduce((a, b) => a.size > b.size ? a : b);
}

// Design primers to add restriction sites when they're absent in the gene
export function designPrimers(sequence: string, enzyme1: string, enzyme2?: string) {
  const e1 = ENZYMES[enzyme1];
  const e2 = enzyme2 ? ENZYMES[enzyme2] : null;
  const extraBases = 'AAGC'; // improves cutting efficiency near end of linear DNA
  const geneStart = sequence.substring(0, 20).toUpperCase();
  const geneEnd = reverseComplement(sequence.substring(sequence.length - 20).toUpperCase());

  return {
    forward: `5'-${extraBases}${e1?.pattern ?? ''}${geneStart}-3'`,
    reverse: `5'-${extraBases}${(e2 ?? e1)?.pattern ?? ''}${geneEnd}-3'`,
    note: `Add ~4 extra bases (${extraBases}) before the restriction site to allow efficient cutting at the end of a linear PCR product.`,
  };
}
