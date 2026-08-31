// ─── Nucleotide utilities ─────────────────────────────────────────────────────

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G',
  R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B',
  D: 'H', H: 'D', N: 'N',
};

export function reverseComplement(seq: string): string {
  return seq.toUpperCase().split('').reverse().map(b => COMPLEMENT[b] ?? 'N').join('');
}

export function calcGC(seq: string): number {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!s.length) return 0;
  return Math.round(((s.match(/[GC]/g) ?? []).length / s.length) * 100);
}

/** Wallace rule Tm (°C). For primers >13 bp uses nearest-neighbour approximation. */
export function calcTm(seq: string): number {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  const gc = (s.match(/[GC]/g) ?? []).length;
  const at = (s.match(/[AT]/g) ?? []).length;
  if (s.length <= 13) return 2 * at + 4 * gc;
  return Math.round(64.9 + 41 * (gc - 16.4) / s.length);
}

// ─── PCR Simulation ───────────────────────────────────────────────────────────

export interface PCRResult {
  success: boolean;
  message: string;
  product: string;
  size: number;
  fwdPos: number;
  revPos: number;
}

export function simulatePCR(template: string, fwdPrimer: string, revPrimer: string): PCRResult {
  const t   = template.toUpperCase();
  const fwd = fwdPrimer.toUpperCase().replace(/[^ACGT]/g, '');
  const rev = revPrimer.toUpperCase().replace(/[^ACGT]/g, '');

  if (!fwd || !rev) return { success: false, message: 'Primers cannot be empty', product: '', size: 0, fwdPos: -1, revPos: -1 };

  const revRC = reverseComplement(rev);

  const fwdPos = t.indexOf(fwd);
  const revRC_pos = t.indexOf(revRC);

  if (fwdPos === -1) return { success: false, message: 'Forward primer not found in template', product: '', size: 0, fwdPos: -1, revPos: -1 };
  if (revRC_pos === -1) return { success: false, message: 'Reverse primer binding site not found in template', product: '', size: 0, fwdPos, revPos: -1 };
  if (fwdPos >= revRC_pos) return { success: false, message: 'Forward primer is downstream of reverse primer — no amplicon', product: '', size: 0, fwdPos, revPos: revRC_pos };

  const product = t.substring(fwdPos, revRC_pos + revRC.length);
  return { success: true, message: `Amplicon: ${product.length} bp`, product, size: product.length, fwdPos, revPos: revRC_pos };
}

// ─── Ligation Simulation ──────────────────────────────────────────────────────

export interface LigationResult {
  success: boolean;
  message: string;
  product: string;
  size: number;
  isCircular: boolean;
}

export function simulateLigation(
  vector: string,
  insert: string,
  vectorCut5: string,   // overhang left of cut in vector
  vectorCut3: string,   // overhang right of cut in vector
  insertEnds: { left: string; right: string },
): LigationResult {
  const v = vector.toUpperCase();
  const ins = insert.toUpperCase();

  // Simple compatibility check: overhangs must match
  const leftOk  = !vectorCut5 || !insertEnds.right || vectorCut5 === insertEnds.right;
  const rightOk = !vectorCut3 || !insertEnds.left  || vectorCut3 === insertEnds.left;

  if (!leftOk || !rightOk) {
    return { success: false, message: 'Incompatible sticky ends — cannot ligate', product: '', size: 0, isCircular: true };
  }

  // Construct: vector_upstream + insert + vector_downstream (simplified linear concat)
  const product = v + ins;
  return {
    success: true,
    message: `Ligation product: ${product.length} bp (circular plasmid)`,
    product,
    size: product.length,
    isCircular: true,
  };
}

/** Quick ligation: just join two fragments (blunt or assumed compatible) */
export function ligateFragments(vectorSeq: string, insertSeq: string): LigationResult {
  const product = vectorSeq.toUpperCase() + insertSeq.toUpperCase();
  return { success: true, message: `Construct: ${product.length} bp`, product, size: product.length, isCircular: true };
}

// ─── File Parsers ─────────────────────────────────────────────────────────────

export interface ParsedSequence {
  name: string;
  description: string;
  sequence: string;
  type: 'gene' | 'plasmid';
  features: ParsedFeature[];
}

export interface ParsedFeature {
  name: string;
  type: string;
  start: number;
  end: number;
  strand: '+' | '-';
  color: string;
}

const FEATURE_COLORS: Record<string, string> = {
  CDS: '#3b82f6', gene: '#10b981', promoter: '#f59e0b',
  terminator: '#ef4444', rep_origin: '#8b5cf6', misc_feature: '#6b7280',
  primer_bind: '#ec4899', RBS: '#14b8a6',
};

export function parseFasta(text: string): ParsedSequence | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  let name = 'Imported Sequence';
  let description = '';
  const seqLines: string[] = [];
  let inSeq = false;

  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('>')) {
      const header = l.slice(1).trim();
      const parts = header.split(/\s+/);
      name = parts[0] || name;
      description = parts.slice(1).join(' ');
      inSeq = true;
    } else if (inSeq && l) {
      seqLines.push(l);
    }
  }

  const sequence = seqLines.join('').replace(/[^ACGTacgtRYSWKMBDHVNryswkmbdhvn]/g, '').toUpperCase();
  if (!sequence) return null;

  const type = sequence.length > 3000 ? 'plasmid' : 'gene';
  return { name, description, sequence, type, features: [] };
}

export function parseGenBank(text: string): ParsedSequence | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Extract name from LOCUS line
  const locusMatch = trimmed.match(/^LOCUS\s+(\S+)/m);
  const name = locusMatch?.[1] ?? 'Imported Sequence';

  // Detect if circular
  const isCircular = /circular/i.test(trimmed.split('\n')[0] ?? '');

  // Extract DEFINITION
  const defMatch = trimmed.match(/^DEFINITION\s+([\s\S]+?)(?=\n[A-Z])/m);
  const description = defMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

  // Extract ORIGIN sequence
  const originMatch = trimmed.match(/ORIGIN\s*([\s\S]*?)(?:\/\/|$)/);
  if (!originMatch) return null;
  const sequence = originMatch[1].replace(/[^acgtACGT]/g, '').toUpperCase();
  if (!sequence) return null;

  // Extract features from FEATURES section
  const features: ParsedFeature[] = [];
  const featuresMatch = trimmed.match(/FEATURES\s+Location\/Qualifiers\s*([\s\S]*?)(?=ORIGIN|CONTIG)/);
  if (featuresMatch) {
    const featureBlocks = featuresMatch[1].split(/\n(?=\s{5}\w)/);
    for (const block of featureBlocks) {
      const lines = block.split('\n').map(l => l.trim());
      if (!lines[0]) continue;
      const typeParts = lines[0].match(/^(\w+)\s+(?:complement\()?(\d+)\.\.(\d+)/);
      if (!typeParts) continue;
      const ftype = typeParts[1];
      const start = parseInt(typeParts[2]) - 1;
      const end   = parseInt(typeParts[3]) - 1;
      const strand: '+' | '-' = lines[0].includes('complement') ? '-' : '+';
      const geneMatch = block.match(/\/(?:gene|locus_tag|product)="([^"]+)"/);
      const fname = geneMatch?.[1] ?? ftype;
      features.push({ name: fname, type: ftype, start, end, strand, color: FEATURE_COLORS[ftype] ?? '#6b7280' });
    }
  }

  const type: 'gene' | 'plasmid' = isCircular || sequence.length > 3000 ? 'plasmid' : 'gene';
  return { name, description, sequence, type, features };
}

// ─── Protein / Translation Utilities ─────────────────────────────────────────

const CODON_TABLE: Record<string, string> = {
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

/** Translate a DNA sequence in frame 0 to protein (stops at stop codon or end) */
export function translateDNA(dna: string, stopAtStop = true): string {
  const s = dna.toUpperCase().replace(/[^ACGT]/g, '');
  let protein = '';
  for (let i = 0; i + 2 < s.length; i += 3) {
    const codon = s.substring(i, i + 3);
    const aa = CODON_TABLE[codon] ?? 'X';
    if (aa === '*' && stopAtStop) break;
    if (aa !== '*') protein += aa;
  }
  return protein;
}

export interface ORF {
  frame: number;   // 1, 2, 3, -1, -2, -3
  start: number;   // 0-indexed position in original sequence
  end: number;     // 0-indexed exclusive
  length: number;  // nt
  protein: string;
  strand: '+' | '-';
}

/** Biologically valid start codons (ATG canonical, GTG/TTG alternative) */
const START_CODONS = new Set(['ATG', 'GTG', 'TTG']);
/** Stop codons */
const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);

/** Find all ORFs ≥ minLen nt across all 6 frames.
 *  Uses ATG (canonical), GTG, and TTG as start codons. */
export function findORFs(seq: string, minLen = 100): ORF[] {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  const rc = reverseComplement(s);
  const orfs: ORF[] = [];

  for (const [strand, tpl] of [['+', s], ['-', rc]] as ['+' | '-', string][]) {
    for (let frame = 0; frame < 3; frame++) {
      let inORF = false;
      let orfStart = 0;
      for (let i = frame; i + 2 < tpl.length; i += 3) {
        const codon = tpl.substring(i, i + 3);
        if (!inORF && START_CODONS.has(codon)) {
          inORF = true;
          orfStart = i;
        } else if (inORF && STOP_CODONS.has(codon)) {
          const orfSeq = tpl.substring(orfStart, i + 3);
          if (orfSeq.length >= minLen) {
            const realStart = strand === '+' ? orfStart : s.length - (i + 3);
            const realEnd   = strand === '+' ? i + 3    : s.length - orfStart;
            orfs.push({
              frame: strand === '+' ? frame + 1 : -(frame + 1),
              start: realStart,
              end: realEnd,
              length: orfSeq.length,
              protein: translateDNA(orfSeq),
              strand,
            });
          }
          inORF = false;
        }
      }
    }
  }
  return orfs.sort((a, b) => b.length - a.length);
}

// ─── Amino Acid Properties ────────────────────────────────────────────────────

/** Residue molecular weights (monoisotopic-approximate, Da) */
const AA_MW: Record<string, number> = {
  A:71.0788, R:156.1875, N:114.1038, D:115.0886, C:103.1388,
  E:129.1155, Q:128.1307, G:57.0519,  H:137.1411, I:113.1594,
  L:113.1594, K:128.1741, M:131.1926, F:147.1766, P:97.1167,
  S:87.0782,  T:101.1051, W:186.2132, Y:163.1760, V:99.1326,
};

/** Kyte-Doolittle hydropathy values */
const AA_HYDRO: Record<string, number> = {
  A:1.8, R:-4.5, N:-3.5, D:-3.5, C:2.5, E:-3.5, Q:-3.5, G:-0.4,
  H:-3.2, I:4.5, L:3.8, K:-3.9, M:1.9, F:2.8, P:-1.6, S:-0.8,
  T:-0.7, W:-0.9, Y:-1.3, V:4.2,
};


export interface ProteinProperties {
  length: number;
  mw: number;       // Da
  isoelectric: number; // pI
  gravy: number;
  aaComposition: Record<string, number>;
  formulaString: string; // e.g. "254 aa, 28.4 kDa"
}

export function calcProteinProperties(seq: string): ProteinProperties {
  const s = seq.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
  if (!s.length) return { length: 0, mw: 0, isoelectric: 7, gravy: 0, aaComposition: {}, formulaString: '' };

  // MW = sum residue masses + water
  let mw = 18.0153;
  for (const aa of s) mw += AA_MW[aa] ?? 110;

  // GRAVY
  const gravy = parseFloat((s.split('').reduce((sum, aa) => sum + (AA_HYDRO[aa] ?? 0), 0) / s.length).toFixed(3));

  // AA composition
  const aaComposition: Record<string, number> = {};
  for (const aa of s) aaComposition[aa] = (aaComposition[aa] ?? 0) + 1;

  // pI via Henderson-Hasselbalch iteration
  const nAsp = aaComposition['D'] ?? 0;
  const nGlu = aaComposition['E'] ?? 0;
  const nCys = aaComposition['C'] ?? 0;
  const nTyr = aaComposition['Y'] ?? 0;
  const nHis = aaComposition['H'] ?? 0;
  const nLys = aaComposition['K'] ?? 0;
  const nArg = aaComposition['R'] ?? 0;

  let isoelectric = 7;
  for (let pH = 0; pH <= 14; pH += 0.01) {
    const charge =
      1 / (1 + Math.pow(10, pH - 8.6))       // N-terminus
      - 1 / (1 + Math.pow(10, 3.65 - pH)) * nAsp
      - 1 / (1 + Math.pow(10, 4.25 - pH)) * nGlu
      - 1 / (1 + Math.pow(10, 10.46 - pH)) * nTyr
      - 1 / (1 + Math.pow(10, 8.18 - pH)) * nCys
      - 1 / (1 + Math.pow(10, 3.1 - pH))     // C-terminus
      + 1 / (1 + Math.pow(10, pH - 6.0)) * nHis
      + 1 / (1 + Math.pow(10, pH - 10.53)) * nLys
      + 1 / (1 + Math.pow(10, pH - 12.48)) * nArg;
    if (charge <= 0) { isoelectric = parseFloat(pH.toFixed(2)); break; }
  }

  return {
    length: s.length,
    mw: parseFloat((mw / 1000).toFixed(2)),   // kDa
    isoelectric,
    gravy,
    aaComposition,
    formulaString: `${s.length} aa · ${(mw / 1000).toFixed(1)} kDa`,
  };
}

// ─── Gel band utilities ───────────────────────────────────────────────────────

/** Standard 1kb ladder bands in bp */
export const LADDER_1KB = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250, 100];

/**
 * Calculates fragment sizes from cut positions.
 * For circular DNA (plasmids), it includes the 'wrap-around' fragment.
 */
export function calculateFragments(totalLen: number, cuts: number[], isCircular: boolean): number[] {
  if (cuts.length === 0) return [totalLen];
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  const fragments: number[] = [];

  if (isCircular) {
    // Fragments between consecutive cuts
    for (let i = 0; i < sorted.length - 1; i++) {
      fragments.push(sorted[i + 1] - sorted[i]);
    }
    // The wrap-around fragment: (total - lastCut) + firstCut
    fragments.push((totalLen - sorted[sorted.length - 1]) + sorted[0]);
  } else {
    // Linear logic: fragments relative to 0 and totalLen
    let prev = 0;
    for (const cut of sorted) {
      if (cut > prev) fragments.push(cut - prev);
      prev = cut;
    }
    if (totalLen > prev) fragments.push(totalLen - prev);
  }

  return fragments.filter(f => f > 0).sort((a, b) => b - a);
}

/** Log-scale Y position (0=top, 1=bottom) for a band of given size */
export function gelPosition(size: number, min = 100, max = 10000): number {
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const logSize = Math.log10(Math.max(min, Math.min(max, size)));
  return (logMax - logSize) / (logMax - logMin);
}

// ─── Reverse Translation ──────────────────────────────────────────────────────

/** Most-used codons per amino acid (E. coli optimized) */
const AA_TO_CODON: Record<string, string> = {
  F:'TTT', L:'CTG', I:'ATT', M:'ATG', V:'GTG', S:'TCT', P:'CCG', T:'ACC',
  A:'GCG', Y:'TAT', H:'CAT', Q:'CAG', N:'AAT', K:'AAA', D:'GAT', E:'GAA',
  C:'TGT', W:'TGG', R:'CGT', G:'GGT', '*':'TAA',
};

/** Reverse translate protein → DNA (E. coli codon usage by default) */
export function reverseTranslate(protein: string): string {
  return protein.toUpperCase().split('').map(aa => AA_TO_CODON[aa] ?? 'NNN').join('');
}

// Auto-feature detection moved to lib/annotation.ts, which finds every copy of
// a part rather than the first, tolerates variants through a seeded search
// instead of scanning every offset, and reads its parts from a library that can
// be added to. The table that lived here is now lib/features.data.ts.

