import { CODON_TABLE } from './molbuilder-logic';

/**
 * What a single-base change does to the proteins encoded across it.
 *
 * The Mutagenesis panel used to translate a 29-base window starting wherever
 * the window happened to start. Two times in three that is the wrong reading
 * frame, so "silent" and "missense" were decided by codons the ribosome never
 * reads -- and a base on the bottom strand, or in the second exon of a spliced
 * gene, was read forwards from the wrong end besides.
 *
 * The frame belongs to a coding feature, so the answer is computed from one:
 * the CDS is assembled in the direction it is read -- exons joined, the
 * reverse complement taken for the bottom strand -- the changed base is found
 * within it, and its codon is translated before and after. A base inside no
 * annotated CDS has no protein consequence this can know, and that is what is
 * reported rather than a guess at a frame.
 */

/** The parts of a feature this needs. Coordinates 1-indexed, inclusive. */
export interface CodingFeature {
  name: string;
  type: string;
  start: number;
  end: number;
  strand: 1 | -1;
  segments?: { start: number; end: number }[];
}

export type Effect = 'silent' | 'missense' | 'nonsense' | 'stop-loss' | 'start-loss';

export interface CodingChange {
  feature: string;
  strand: 1 | -1;
  /** 1-based codon number within the CDS, which is the residue number. */
  codonNumber: number;
  /** 1-3: which base of the codon changed. */
  codonPosition: number;
  originalCodon: string;
  mutantCodon: string;
  originalAA: string;
  mutantAA: string;
  effect: Effect;
  /** Protein-change shorthand, e.g. A123D, R45*, M1?. */
  notation: string;
  /**
   * Set when the CDS length is not a multiple of three, or the changed codon
   * runs past its end -- the annotation is suspect and the call may be too.
   */
  caution?: string;
}

const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

/** True for feature types that carry a reading frame. */
export function isCoding(type: string): boolean {
  return /^(cds|orf)$/i.test(type.trim());
}

/** Genomic positions (1-indexed) of a CDS in reading order: 5'->3' along the coding strand. */
export function readingOrder(f: CodingFeature): number[] {
  const blocks = (f.segments?.length ? f.segments : [{ start: f.start, end: f.end }])
    .map(b => ({ start: Math.min(b.start, b.end), end: Math.max(b.start, b.end) }))
    .sort((a, b) => a.start - b.start);
  const positions: number[] = [];
  for (const b of blocks) for (let p = b.start; p <= b.end; p++) positions.push(p);
  return f.strand === 1 ? positions : positions.reverse();
}

/**
 * The effect of changing the base at `position` (1-indexed) to `base`, on
 * every coding feature that contains it. Empty when none does.
 */
export function codingChanges(
  sequence: string,
  features: CodingFeature[],
  position: number,
  base: string,
): CodingChange[] {
  const seq = sequence.toUpperCase();
  const newBase = base.toUpperCase();
  const out: CodingChange[] = [];

  for (const f of features) {
    if (!isCoding(f.type)) continue;
    // A feature drawn through the origin of a plasmid (end before start) is
    // not handled here; better no answer than one read in the wrong order.
    if (!f.segments?.length && f.end < f.start) continue;

    const order = readingOrder(f);
    const index = order.indexOf(position);
    if (index === -1) continue; // not in this CDS, or in one of its introns

    const read = (p: number, sub?: string) => {
      const b = sub ?? seq[p - 1] ?? 'N';
      return f.strand === 1 ? b : (COMP[b] ?? 'N');
    };

    const codonStart = index - (index % 3);
    const codonPositions = order.slice(codonStart, codonStart + 3);
    const originalCodon = codonPositions.map(p => read(p)).join('');
    const mutantCodon = codonPositions.map(p => read(p, p === position ? newBase : undefined)).join('');

    const codonNumber = codonStart / 3 + 1;
    const originalAA = CODON_TABLE[originalCodon] ?? 'X';
    const mutantAA = CODON_TABLE[mutantCodon] ?? 'X';

    let effect: Effect;
    if (originalAA === mutantAA) effect = 'silent';
    else if (codonNumber === 1 && originalCodon === 'ATG') effect = 'start-loss';
    else if (originalAA === '*') effect = 'stop-loss';
    else if (mutantAA === '*') effect = 'nonsense';
    else effect = 'missense';

    const notation = effect === 'start-loss'
      ? 'M1?'
      : `${originalAA}${codonNumber}${effect === 'silent' ? '=' : mutantAA}`;

    const cautions: string[] = [];
    if (order.length % 3 !== 0) cautions.push(`${f.name} is ${order.length} bp, not a whole number of codons; check the annotation`);
    if (codonPositions.length < 3) cautions.push('the changed base is in an incomplete final codon');

    out.push({
      feature: f.name,
      strand: f.strand,
      codonNumber,
      codonPosition: (index % 3) + 1,
      originalCodon,
      mutantCodon,
      originalAA,
      mutantAA,
      effect,
      notation,
      caution: cautions.length ? cautions.join('; ') : undefined,
    });
  }
  return out;
}
