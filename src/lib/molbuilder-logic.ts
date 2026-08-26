/**
 * Molbuilder Professional Sequence Studio - Logic & Constants
 * Ported for GeneNet (lab-network) integration.
 */

// ─── AMINO ACID LOOKUP ────────────────────────────────────────────────────────

export const AA3: Record<string, string> = {
  X: 'Xaa', A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', E: 'Glu', Q: 'Gln',
  G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro',
  S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': '***', '?': '???'
};

export const AA3BG: Record<string, string> = {
  Xaa: '#f5f5f5', Ala: '#e8eaf6', Val: '#e8eaf6', Ile: '#e8eaf6', Leu: '#e8eaf6',
  Gly: '#fce4ec', Pro: '#fce4ec', Phe: '#f3e5f5', Trp: '#f3e5f5', Tyr: '#f3e5f5',
  Met: '#fff3e0', Cys: '#fff3e0', Ser: '#e8f5e9', Thr: '#e8f5e9', Lys: '#e3f2fd',
  Arg: '#e3f2fd', His: '#e1f5fe', Asp: '#fbe9e7', Glu: '#fbe9e7', Asn: '#f5f5f5',
  Gln: '#f5f5f5', '***': '#ffebee', '???': '#fafafa'
};

export const AA3FG: Record<string, string> = {
  Xaa: '#9e9e9e', Ala: '#3949ab', Val: '#3949ab', Ile: '#3949ab', Leu: '#3949ab',
  Gly: '#c62828', Pro: '#c62828', Phe: '#7b1fa2', Trp: '#7b1fa2', Tyr: '#7b1fa2',
  Met: '#e65100', Cys: '#e65100', Ser: '#2e7d32', Thr: '#2e7d32', Lys: '#1565c0',
  Arg: '#1565c0', His: '#0277bd', Asp: '#bf360c', Glu: '#bf360c', Asn: '#424242',
  Gln: '#424242', '***': '#c62828', '???': '#9e9e9e'
};

// ─── NUCLEOTIDE COLORS (SnapGene Standard) ───────────────────────────────────

export const NT_COL: Record<string, string> = {
  A: '#2158c2', T: '#c22121', G: '#218028', C: '#b06a00',
  a: '#2158c2', t: '#c22121', g: '#218028', c: '#b06a00',
  U: '#c22121', u: '#c22121', N: '#9e9e9e', n: '#9e9e9e'
};

export const NT_BOT: Record<string, string> = {
  A: '#6699cc', T: '#d4706a', G: '#5a9a62', C: '#b07830',
  a: '#6699cc', t: '#d4706a', g: '#5a9a62', c: '#b07830',
  N: '#bbbbbb', n: '#bbbbbb', U: '#d4706a', u: '#d4706a'
};

export const AA_COL_SEQ: Record<string, string> = {
  A: '#2158c2', R: '#c22121', N: '#218028', D: '#9333ea', C: '#c22121',
  Q: '#218028', E: '#9333ea', G: '#b06a00', H: '#0891b2', I: '#2158c2',
  L: '#2158c2', K: '#c22121', M: '#b45309', F: '#2158c2', P: '#d97706',
  S: '#218028', T: '#218028', W: '#2158c2', Y: '#0891b2', V: '#2158c2',
  X: '#9e9e9e', '*': '#c22121', '?': '#9e9e9e'
};

export const AA_BG_SEQ: Record<string, string> = {
  A: '#eef3ff', R: '#fff0f0', N: '#f0fff0', D: '#f8f0ff', C: '#fff0f0',
  Q: '#f0fff0', E: '#f8f0ff', G: '#fff8ee', H: '#edfafa', I: '#eef3ff',
  L: '#eef3ff', K: '#fff0f0', M: '#fff8ee', F: '#eef3ff', P: '#fffaee',
  S: '#f0fff0', T: '#f0fff0', W: '#eef3ff', Y: '#edfafa', V: '#eef3ff',
  X: '#f5f5f5', '*': '#fff0f0', '?': '#f5f5f5'
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

export const COMP_MAP: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', N: 'N',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D'
};

/** Get feature color by type (SnapGene-inspired palette) */
export function getFeatureColor(type: string): string {
  const t = type.toLowerCase();
  if (t === 'cds' || t === 'gene') return '#3b82f6'; // Blue
  if (t === 'promoter') return '#f59e0b'; // Amber
  if (t === 'terminator') return '#ef4444'; // Red
  if (t === 'rep_origin' || t === 'ori') return '#8b5cf6'; // Purple
  if (t === 'primer_bind') return '#ec4899'; // Pink
  if (t === 'misc_feature') return '#6b7280'; // Gray
  if (t === 'rbs') return '#14b8a6'; // Teal
  return '#94a3b8'; // Default
}

/** Wallace rule Tm calculation (matching Molbuilder's implementation) */
export function wallaceTm(seq: string): number {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  const gc = (s.match(/[GC]/g) ?? []).length;
  const at = (s.match(/[AT]/g) ?? []).length;
  return 2 * at + 4 * gc;
}


// ─── AMINO ACIDS (Translation) ────────────────────────────────────────────────

export const CODON_TABLE: Record<string, string> = {
  TTT:'F', TTC:'F', TTA:'L', TTG:'L',
  CTT:'L', CTC:'L', CTA:'L', CTG:'L',
  ATT:'I', ATC:'I', ATA:'I', ATG:'M',
  GTT:'V', GTC:'V', GTA:'V', GTG:'V',
  TCT:'S', TCC:'S', TCA:'S', TCG:'S',
  CCT:'P', CCC:'P', CCA:'P', CCG:'P',
  ACT:'T', ACC:'T', ACA:'T', ACG:'T',
  GCT:'A', GCC:'A', GCA:'A', GCG:'A',
  TAT:'Y', TAC:'Y', TAA:'*', TAG:'*',
  CAT:'H', CAC:'H', CAA:'Q', CAG:'Q',
  AAT:'N', AAC:'N', AAA:'K', AAG:'K',
  GAT:'D', GAC:'D', GAA:'E', GAG:'E',
  TGT:'C', TGC:'C', TGA:'*', TGG:'W',
  CGT:'R', CGC:'R', CGA:'R', CGG:'R',
  AGT:'S', AGC:'S', AGA:'R', AGG:'R',
  GGT:'G', GGC:'G', GGA:'G', GGG:'G',
};

/** Get amino acid color based on chemical properties (Clustal/SnapGene-ish) */
export function getAAStyle(aa: string): { bg: string; fg: string } {
  if (['R', 'K', 'H'].includes(aa)) return { bg: '#eef2ff', fg: '#4f46e5' }; // Basic
  if (['D', 'E'].includes(aa)) return { bg: '#fef2f2', fg: '#ef4444' }; // Acidic
  if (['A', 'V', 'I', 'L', 'M', 'F', 'Y', 'W'].includes(aa)) return { bg: '#f8fafc', fg: '#475569' }; // Nonpolar
  if (['S', 'T', 'N', 'Q'].includes(aa)) return { bg: '#f0fdf4', fg: '#22c55e' }; // Polar
  if (aa === '*') return { bg: '#fee2e2', fg: '#dc2626' }; // Stop
  return { bg: '#f1f5f9', fg: '#94a3b8' };
}

/** Translate sequence in a specific frame */
export function translateSeq(seq: string, frame: number): (string | null)[] {
  const strand = frame > 0 ? seq : seq.split('').reverse().map(b => COMP_MAP[b] || 'N').join('');
  const absFrame = Math.abs(frame) - 1;
  const res: (string | null)[] = new Array(seq.length).fill(null);
  
  for (let i = absFrame; i + 2 < strand.length; i += 3) {
    const codon = strand.substring(i, i + 3);
    const aa = CODON_TABLE[codon] || 'X';
    // For reverse strand, we need to map the position back to the original index
    const pos = frame > 0 ? i : seq.length - 1 - i;
    res[pos] = aa;
  }
  return res;
}
