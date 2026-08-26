export interface Enzyme {
  name: string;
  pattern: string;
  cutBefore: number;   // cut position on top strand (0-indexed within pattern)
  overhang: string;
  overhangType: '5prime' | '3prime' | 'blunt';
}

export const ENZYMES: Record<string, Enzyme> = {
  EcoRI:   { name: 'EcoRI',   pattern: 'GAATTC',   cutBefore: 1, overhang: 'AATT', overhangType: '5prime' },
  BamHI:   { name: 'BamHI',   pattern: 'GGATCC',   cutBefore: 1, overhang: 'GATC', overhangType: '5prime' },
  HindIII: { name: 'HindIII', pattern: 'AAGCTT',   cutBefore: 1, overhang: 'AGCT', overhangType: '5prime' },
  XhoI:    { name: 'XhoI',    pattern: 'CTCGAG',   cutBefore: 1, overhang: 'TCGA', overhangType: '5prime' },
  SalI:    { name: 'SalI',    pattern: 'GTCGAC',   cutBefore: 1, overhang: 'TCGA', overhangType: '5prime' },
  NcoI:    { name: 'NcoI',    pattern: 'CCATGG',   cutBefore: 1, overhang: 'CATG', overhangType: '5prime' },
  XbaI:    { name: 'XbaI',    pattern: 'TCTAGA',   cutBefore: 1, overhang: 'CTAG', overhangType: '5prime' },
  SpeI:    { name: 'SpeI',    pattern: 'ACTAGT',   cutBefore: 1, overhang: 'CTAG', overhangType: '5prime' },
  NheI:    { name: 'NheI',    pattern: 'GCTAGC',   cutBefore: 1, overhang: 'CTAG', overhangType: '5prime' },
  BglII:   { name: 'BglII',   pattern: 'AGATCT',   cutBefore: 1, overhang: 'GATC', overhangType: '5prime' },
  NotI:    { name: 'NotI',    pattern: 'GCGGCCGC', cutBefore: 2, overhang: 'GGCC', overhangType: '5prime' },
  AgeI:    { name: 'AgeI',    pattern: 'ACCGGT',   cutBefore: 1, overhang: 'CCGG', overhangType: '5prime' },
  NdeI:    { name: 'NdeI',    pattern: 'CATATG',   cutBefore: 2, overhang: 'TA',   overhangType: '5prime' },
  ClaI:    { name: 'ClaI',    pattern: 'ATCGAT',   cutBefore: 2, overhang: 'CG',   overhangType: '5prime' },
  MluI:    { name: 'MluI',    pattern: 'ACGCGT',   cutBefore: 1, overhang: 'CGCG', overhangType: '5prime' },
  SmaI:    { name: 'SmaI',    pattern: 'CCCGGG',   cutBefore: 3, overhang: '',     overhangType: 'blunt'  },
  EcoRV:   { name: 'EcoRV',   pattern: 'GATATC',   cutBefore: 3, overhang: '',     overhangType: 'blunt'  },
  KpnI:    { name: 'KpnI',    pattern: 'GGTACC',   cutBefore: 5, overhang: 'GTAC', overhangType: '3prime' },
  SacI:    { name: 'SacI',    pattern: 'GAGCTC',   cutBefore: 5, overhang: 'AGCT', overhangType: '3prime' },
  PstI:    { name: 'PstI',    pattern: 'CTGCAG',   cutBefore: 5, overhang: 'TGCA', overhangType: '3prime' },
};

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
