import { CODON_TABLE } from './molbuilder-logic';

/**
 * Codon usage for the hosts a lab actually expresses in.
 *
 * Values are per-thousand codon counts from the Kazusa codon usage database,
 * normalised on load into the fraction each codon takes of its own amino
 * acid's family. Everything below wants the per-amino-acid fraction, and
 * converting from per-thousand at each call site is where normalisation errors
 * get in.
 *
 * These are whole-genome frequencies, and that is worth remembering before
 * treating them as a specification. Codon usage is a property of a genome under
 * its own tRNA pool; a gene run off a strong plasmid promoter is not competing
 * for tRNA on the same terms as its chromosomal neighbours, and for very highly
 * expressed constructs the tRNA pool is itself a variable. A lab with its own
 * expression data should trust that over any table here.
 */

export interface CodonUsage {
  id: string;
  name: string;
  organism: string;
  /** codon -> that codon's share of its amino acid family, 0..1. */
  freq: Record<string, number>;
  /** codon -> per-thousand count across the genome, as published. */
  perThousand: Record<string, number>;
}

const RAW: Record<string, { name: string; organism: string; counts: Record<string, number> }> = {
  ecoli: {
    name: 'E. coli K-12',
    organism: 'Escherichia coli',
    counts: {
      TTT: 22.4, TTC: 16.6, TTA: 13.9, TTG: 13.7,
      CTT: 11.0, CTC: 11.0, CTA: 3.9, CTG: 52.6,
      ATT: 30.3, ATC: 25.1, ATA: 4.4, ATG: 27.9,
      GTT: 18.3, GTC: 15.3, GTA: 10.9, GTG: 26.4,
      TCT: 8.5, TCC: 8.6, TCA: 7.2, TCG: 8.9, AGT: 8.7, AGC: 16.1,
      CCT: 7.0, CCC: 5.5, CCA: 8.4, CCG: 23.2,
      ACT: 8.9, ACC: 23.4, ACA: 7.1, ACG: 14.4,
      GCT: 15.4, GCC: 25.5, GCA: 20.2, GCG: 33.6,
      TAT: 16.2, TAC: 12.2,
      CAT: 12.9, CAC: 9.7, CAA: 15.3, CAG: 28.8,
      AAT: 17.7, AAC: 21.6, AAA: 33.6, AAG: 10.3,
      GAT: 32.7, GAC: 19.1, GAA: 39.4, GAG: 17.8,
      TGT: 5.2, TGC: 6.4, TGG: 15.2,
      CGT: 20.9, CGC: 22.0, CGA: 3.6, CGG: 5.4, AGA: 2.1, AGG: 1.2,
      GGT: 24.7, GGC: 29.6, GGA: 8.0, GGG: 11.1,
      TAA: 2.0, TAG: 0.2, TGA: 0.9,
    },
  },
  yeast: {
    name: 'S. cerevisiae',
    organism: 'Saccharomyces cerevisiae',
    counts: {
      TTT: 26.1, TTC: 18.4, TTA: 26.2, TTG: 27.2,
      CTT: 12.3, CTC: 5.4, CTA: 13.4, CTG: 10.5,
      ATT: 30.1, ATC: 17.2, ATA: 17.8, ATG: 20.9,
      GTT: 22.1, GTC: 11.8, GTA: 11.8, GTG: 10.8,
      TCT: 23.5, TCC: 14.2, TCA: 18.7, TCG: 8.6, AGT: 14.2, AGC: 9.8,
      CCT: 13.5, CCC: 6.8, CCA: 18.3, CCG: 5.3,
      ACT: 20.3, ACC: 12.7, ACA: 17.8, ACG: 8.0,
      GCT: 21.2, GCC: 12.6, GCA: 16.2, GCG: 6.2,
      TAT: 18.8, TAC: 14.8,
      CAT: 13.6, CAC: 7.8, CAA: 27.3, CAG: 12.1,
      AAT: 35.7, AAC: 24.8, AAA: 41.9, AAG: 30.8,
      GAT: 37.6, GAC: 20.2, GAA: 45.6, GAG: 19.2,
      TGT: 8.1, TGC: 4.8, TGG: 10.4,
      CGT: 6.4, CGC: 2.6, CGA: 3.0, CGG: 1.7, AGA: 21.3, AGG: 9.2,
      GGT: 23.9, GGC: 9.8, GGA: 10.9, GGG: 6.0,
      TAA: 1.1, TAG: 0.5, TGA: 0.7,
    },
  },
  human: {
    name: 'H. sapiens',
    organism: 'Homo sapiens',
    counts: {
      TTT: 17.6, TTC: 20.3, TTA: 7.7, TTG: 12.9,
      CTT: 13.2, CTC: 19.6, CTA: 7.2, CTG: 39.6,
      ATT: 16.0, ATC: 20.8, ATA: 7.5, ATG: 22.0,
      GTT: 11.0, GTC: 14.5, GTA: 7.1, GTG: 28.1,
      TCT: 15.2, TCC: 17.7, TCA: 12.2, TCG: 4.4, AGT: 12.1, AGC: 19.5,
      CCT: 17.5, CCC: 19.8, CCA: 16.9, CCG: 6.9,
      ACT: 13.1, ACC: 18.9, ACA: 15.1, ACG: 6.1,
      GCT: 18.4, GCC: 27.7, GCA: 15.8, GCG: 7.4,
      TAT: 12.2, TAC: 15.3,
      CAT: 10.9, CAC: 15.1, CAA: 12.3, CAG: 34.2,
      AAT: 17.0, AAC: 19.1, AAA: 24.4, AAG: 31.9,
      GAT: 21.8, GAC: 25.1, GAA: 29.0, GAG: 39.6,
      TGT: 10.6, TGC: 12.6, TGG: 13.2,
      CGT: 4.5, CGC: 10.4, CGA: 6.2, CGG: 11.4, AGA: 12.2, AGG: 12.0,
      GGT: 10.8, GGC: 22.2, GGA: 16.5, GGG: 16.5,
      TAA: 1.0, TAG: 0.8, TGA: 1.6,
    },
  },
  pichia: {
    name: 'P. pastoris',
    organism: 'Komagataella phaffii',
    counts: {
      TTT: 22.5, TTC: 19.0, TTA: 15.1, TTG: 30.6,
      CTT: 15.6, CTC: 8.0, CTA: 8.9, CTG: 15.6,
      ATT: 28.6, ATC: 20.2, ATA: 9.9, ATG: 21.0,
      GTT: 25.0, GTC: 14.4, GTA: 8.0, GTG: 14.1,
      TCT: 23.3, TCC: 15.7, TCA: 13.6, TCG: 7.6, AGT: 11.7, AGC: 9.2,
      CCT: 15.4, CCC: 6.4, CCA: 17.0, CCG: 4.9,
      ACT: 21.1, ACC: 15.1, ACA: 12.5, ACG: 6.1,
      GCT: 26.0, GCC: 16.1, GCA: 13.4, GCG: 4.9,
      TAT: 17.0, TAC: 18.5,
      CAT: 13.1, CAC: 9.3, CAA: 25.9, CAG: 14.1,
      AAT: 25.5, AAC: 25.0, AAA: 29.0, AAG: 35.6,
      GAT: 34.9, GAC: 23.1, GAA: 40.8, GAG: 26.3,
      TGT: 6.5, TGC: 3.5, TGG: 10.4,
      CGT: 8.2, CGC: 3.2, CGA: 4.4, CGG: 2.3, AGA: 21.1, AGG: 7.5,
      GGT: 24.4, GGC: 9.4, GGA: 17.4, GGG: 6.2,
      TAA: 1.1, TAG: 0.6, TGA: 0.5,
    },
  },
};

/** Codons grouped by the amino acid they encode. */
export const SYNONYMS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [codon, aa] of Object.entries(CODON_TABLE)) {
    (out[aa] ??= []).push(codon);
  }
  return out;
})();

function normalise(counts: Record<string, number>): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const family of Object.values(SYNONYMS)) {
    const total = family.reduce((s, c) => s + (counts[c] ?? 0), 0);
    for (const c of family) freq[c] = total > 0 ? (counts[c] ?? 0) / total : 0;
  }
  return freq;
}

export const HOSTS: Record<string, CodonUsage> = Object.fromEntries(
  Object.entries(RAW).map(([id, r]) => [
    id,
    { id, name: r.name, organism: r.organism, freq: normalise(r.counts), perThousand: r.counts },
  ]),
);

export const HOST_LIST = Object.values(HOSTS);

export function host(id: string): CodonUsage {
  const h = HOSTS[id];
  if (!h) throw new Error(`Unknown host "${id}". Known: ${Object.keys(HOSTS).join(', ')}.`);
  return h;
}

/** The most-used codon for each amino acid in this host. */
export function preferredCodons(usage: CodonUsage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [aa, family] of Object.entries(SYNONYMS)) {
    out[aa] = family.reduce((best, c) => (usage.freq[c] > usage.freq[best] ? c : best), family[0]);
  }
  return out;
}

/**
 * Relative adaptiveness: each codon's frequency over the best in its family.
 *
 * This is the w of Sharp & Li's CAI, and the reason CAI uses a ratio rather
 * than the raw frequency: an amino acid with six codons would otherwise always
 * score lower than one with two, whatever the sequence does.
 */
export function relativeAdaptiveness(usage: CodonUsage): Record<string, number> {
  const w: Record<string, number> = {};
  for (const family of Object.values(SYNONYMS)) {
    const max = Math.max(...family.map(c => usage.freq[c] ?? 0));
    for (const c of family) w[c] = max > 0 ? (usage.freq[c] ?? 0) / max : 0;
  }
  return w;
}

/**
 * Codon adaptation index (Sharp & Li 1987): the geometric mean of the relative
 * adaptiveness of every codon in the sequence.
 *
 * Methionine and tryptophan are excluded because they have one codon each --
 * their w is 1 by definition, and including them inflates the index by an
 * amount that depends only on how many M and W the protein happens to contain.
 * Stops are excluded for the same reason of not being a choice the ribosome
 * makes during elongation.
 */
export function cai(sequence: string, usage: CodonUsage): number {
  const w = relativeAdaptiveness(usage);
  const s = sequence.toUpperCase().replace(/U/g, 'T');
  let sum = 0, n = 0;

  for (let i = 0; i + 3 <= s.length; i += 3) {
    const codon = s.slice(i, i + 3);
    const aa = CODON_TABLE[codon];
    if (!aa || aa === '*' || aa === 'M' || aa === 'W') continue;
    const wi = w[codon];
    // A codon this host never uses would send the geometric mean to zero and
    // take the whole index with it; the convention is to floor it.
    sum += Math.log(wi > 0 ? wi : 0.01);
    n++;
  }
  return n === 0 ? 0 : Math.exp(sum / n);
}

/** Codons used less than this share of their family are the ones that stall. */
export const RARE_THRESHOLD = 0.1;

export interface RareCodon {
  /** 1-indexed codon number in the CDS. */
  position: number;
  codon: string;
  aa: string;
  fraction: number;
  /** True when this is part of a run of rare codons, which is far worse. */
  inCluster: boolean;
}

/**
 * Rare codons, and whether they cluster.
 *
 * A single rare codon in a gene is a non-event -- the ribosome pauses and moves
 * on. Several within a short window is what causes real trouble: the pause is
 * long enough for the ribosome behind to catch up, and tandem rare codons are a
 * documented cause of frameshifting and truncation. Reporting the two the same
 * way would bury the case that matters under the case that does not.
 */
export function rareCodons(sequence: string, usage: CodonUsage, windowSize = 10): RareCodon[] {
  const s = sequence.toUpperCase().replace(/U/g, 'T');
  const all: RareCodon[] = [];

  for (let i = 0, n = 0; i + 3 <= s.length; i += 3, n++) {
    const codon = s.slice(i, i + 3);
    const aa = CODON_TABLE[codon];
    if (!aa || aa === '*') continue;
    const f = usage.freq[codon] ?? 0;
    if (f < RARE_THRESHOLD) {
      all.push({ position: n + 1, codon, aa, fraction: f, inCluster: false });
    }
  }

  for (const r of all) {
    const near = all.filter(o => Math.abs(o.position - r.position) < windowSize).length;
    r.inCluster = near >= 3;
  }
  return all;
}
