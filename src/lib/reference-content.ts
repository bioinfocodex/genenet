import type { SequenceFeature } from './features';
import type { Annotation } from './annotation';

/**
 * Reference content: the vectors and primers a lab uses every day.
 *
 * Both lists follow the feature library's rule -- published sequence only,
 * nothing reconstructed. The vectors are GenBank accession numbers, fetched
 * from NCBI when someone imports them, so no sequence is shipped here and
 * none can drift from its source. Each accession was checked against NCBI's
 * own title on 2026-10-14; records that turned out to be a clone carrying an
 * insert, or were marked UNVERIFIED, were left out. The pET series is not
 * deposited in GenBank by its supplier and so is not here.
 *
 * The primers are the short, public universal primers, each kept only after
 * it was found to anneal exactly, full length, to at least one of these
 * records. T7 terminator was dropped for that reason: it sits in pET, which
 * none of these records is.
 */

export type VectorUse =
  | 'cloning' | 'E. coli expression' | 'mammalian expression' | 'reporter';

export interface ReferenceVector {
  accession: string;
  name: string;
  use: VectorUse;
  note?: string;
}

export const REFERENCE_VECTORS: ReferenceVector[] = [
  { accession: 'L09137', name: 'pUC19', use: 'cloning', note: 'GenBank record is pUC19c, the same plasmid written from the other strand' },
  { accession: 'L09136', name: 'pUC18', use: 'cloning' },
  { accession: 'Y14837', name: 'pUC57', use: 'cloning' },
  { accession: 'J01749', name: 'pBR322', use: 'cloning' },
  { accession: 'X06403', name: 'pACYC184', use: 'cloning' },
  { accession: 'X52328', name: 'pBluescript II SK(+)', use: 'cloning' },
  { accession: 'X52327', name: 'pBluescript II KS(+)', use: 'cloning' },
  { accession: 'X65308', name: 'pGEM-5Zf(+)', use: 'cloning' },
  { accession: 'U13853', name: 'pGEX-4T-1', use: 'E. coli expression' },
  { accession: 'U78872', name: 'pGEX-6P-1', use: 'E. coli expression' },
  { accession: 'M22744', name: 'pTrc99A', use: 'E. coli expression' },
  { accession: 'M77749', name: 'pKK223-3', use: 'E. coli expression' },
  { accession: 'X81837', name: 'pBAD24', use: 'E. coli expression' },
  { accession: 'LC760188', name: 'pBAD33', use: 'E. coli expression' },
  { accession: 'MN996867', name: 'pcDNA3.1(+)', use: 'mammalian expression' },
  { accession: 'U55762', name: 'pEGFP-N1', use: 'mammalian expression' },
  { accession: 'U55763', name: 'pEGFP-C1', use: 'mammalian expression' },
  { accession: 'U02451', name: 'pCMVβ', use: 'reporter' },
  { accession: 'U47295', name: 'pGL3-Basic', use: 'reporter' },
  { accession: 'AF025846', name: 'pRL-TK', use: 'reporter' },
];

export interface StandardPrimer {
  name: string;
  sequence: string;
  /** Accessions it anneals to exactly, full length, as checked. */
  verifiedOn: string[];
}

export const STANDARD_PRIMERS: StandardPrimer[] = [
  { name: 'M13 F (-20)', sequence: 'GTAAAACGACGGCCAGT', verifiedOn: ['L09137', 'X52328', 'X65308', 'U13853'] },
  { name: 'M13 F (-40)', sequence: 'GTTTTCCCAGTCACGAC', verifiedOn: ['L09137', 'X52328', 'X65308'] },
  { name: 'M13 R', sequence: 'CAGGAAACAGCTATGAC', verifiedOn: ['L09137', 'X52328', 'MN996867', 'U13853'] },
  { name: 'M13/pUC R (-48)', sequence: 'AGCGGATAACAATTTCACACAGGA', verifiedOn: ['L09137', 'M22744', 'U13853'] },
  { name: 'T7 promoter', sequence: 'TAATACGACTCACTATAGGG', verifiedOn: ['MN996867', 'X52328', 'X65308'] },
  { name: 'T3', sequence: 'AATTAACCCTCACTAAAGGG', verifiedOn: ['X52328', 'X52327'] },
  { name: 'SP6', sequence: 'ATTTAGGTGACACTATAG', verifiedOn: ['X65308'] },
  { name: 'CMV forward', sequence: 'CGCAAATGGGCGGTAGGCGTG', verifiedOn: ['MN996867', 'U55762', 'U55763'] },
  { name: 'BGH reverse', sequence: 'TAGAAGGCACAGTCGAGG', verifiedOn: ['MN996867'] },
  { name: 'EGFP-C forward', sequence: 'CATGGTCCTGCTGGAGTTCGTG', verifiedOn: ['U55762', 'U55763'] },
  { name: 'EGFP-N reverse', sequence: 'CGTCGCCGTCCAGCTCGACCAG', verifiedOn: ['U55762', 'U55763'] },
  { name: 'pGEX 5′', sequence: 'GGGCTGGCAAGCCACGTTTGGTG', verifiedOn: ['U13853', 'U78872'] },
  { name: 'pGEX 3′', sequence: 'CCGGGAGCTGCATGTGTCAGAGG', verifiedOn: ['U13853', 'U78872'] },
  { name: 'pBAD forward', sequence: 'ATGCCATAGCATTTTTATCC', verifiedOn: ['X81837', 'LC760188'] },
  { name: 'pBAD reverse', sequence: 'GATTTAATCTGTATCAGG', verifiedOn: ['X81837', 'LC760188'] },
  { name: 'pTrc forward', sequence: 'TTGACAATTAATCATCCGGC', verifiedOn: ['M22744'] },
  { name: 'RVprimer3', sequence: 'CTAGCAAAATAGGCTGTCCC', verifiedOn: ['U47295'] },
  { name: 'GLprimer2', sequence: 'CTTTATGTTTTTGGCGTCTTCCA', verifiedOn: ['U47295'] },
  { name: 'SV40 pA reverse', sequence: 'GAAATTTGTGATGCTATTGC', verifiedOn: ['MN996867', 'U55762', 'U47295'] },
  { name: 'pBR322 ori forward', sequence: 'GGTATCTGCGCTCTGCTGAAG', verifiedOn: ['J01749', 'L09137'] },
  { name: 'Amp reverse', sequence: 'ATAATACCGCGCCACATAGC', verifiedOn: ['J01749', 'L09137'] },
];

/** Tag written on an imported reference vector, so it is not imported twice. */
export const accessionTag = (accession: string) => `accession:${accession}`;
export const REFERENCE_TAG = 'reference-vector';

/**
 * GenBank's own annotation, filled out with what auto-annotation finds.
 *
 * Many vector records carry almost nothing -- pUC19's has its source line and
 * no features -- so a reference vector imported as it stands would open as a
 * bare circle. The record's own features are kept as they are; a detected part
 * is added only where the record has nothing of the same type over most of
 * its span, so a properly annotated record is not cluttered with duplicates.
 */
export function mergeAnnotations(record: SequenceFeature[], detected: Annotation[]): SequenceFeature[] {
  const out = [...record];
  let n = 0;
  // Same kind of thing over most of the same bases: the record already has
  // it, under whatever name its submitter used (bla for AmpR, nptII for KanR).
  const overlap = (f: SequenceFeature, d: Annotation) =>
    Math.max(0, Math.min(f.end, d.end) - Math.max(f.start, d.start) + 1) / (d.end - d.start + 1);
  for (const d of detected) {
    const covered = record.some(f =>
      (f.type.toLowerCase() === d.type.toLowerCase() || f.name.toLowerCase() === d.name.toLowerCase())
      && overlap(f, d) >= 0.5,
    );
    if (covered) continue;
    out.push({
      id: `detected-${++n}-${d.start}`, name: d.name, type: d.type, color: d.color,
      start: d.start, end: d.end, strand: d.strand,
      notes: d.identity < 1 ? `Detected at ${(d.identity * 100).toFixed(0)}% identity` : 'Detected',
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
