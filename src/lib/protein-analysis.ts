/**
 * What a protein sequence says about the protein, along its length.
 *
 * The protein record already carries molecular weight, pI and GRAVY. Those are
 * three numbers for the whole chain, and the whole chain is rarely the
 * question: GRAVY near zero is the normal answer for a membrane protein whose
 * hydrophobic helices are cancelled out by its loops. What is wanted is where
 * along the sequence those helices are, what the protein's charge will be in
 * the buffer actually on the bench, and how much light it absorbs -- the three
 * things that decide a purification.
 *
 * Every table here is published and small enough to be checked by eye.
 */

/** Kyte & Doolittle (1982) J Mol Biol 157:105, hydropathy index. */
const HYDROPATHY: Record<string, number> = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, E: -3.5, Q: -3.5, G: -0.4,
  H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8,
  T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

/**
 * Side-chain and terminal pKa values: Bjellqvist et al. (1993)
 * Electrophoresis 14:1023, the set ExPASy ProtParam uses.
 *
 * Which set is a real choice, not a detail. Three published sets put
 * ribonuclease A's pI at 8.28, 8.39 and 8.64, and only one of those can be
 * compared with the figure somebody read off ProtParam. These are ProtParam's,
 * so a pI from here is the pI they would quote -- verified against it for
 * ribonuclease A, which comes out at 8.64 either way.
 */
const PKA_ACID: Record<string, number> = { D: 4.05, E: 4.45, C: 9.0, Y: 10.0 };
const PKA_BASE: Record<string, number> = { K: 10.0, R: 12.0, H: 5.98 };
const PKA_C_TERM = 3.55;
const PKA_N_TERM = 7.5;

export const AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';

export function cleanProtein(seq: string): string {
  return seq.toUpperCase().replace(/[^A-Z]/g, '').replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
}

// ─── Hydropathy along the chain ───────────────────────────────────────────────

export interface HydropathyPoint {
  /** 1-based position of the window's centre. */
  position: number;
  value: number;
}

/**
 * Kyte-Doolittle hydropathy, averaged over a sliding window.
 *
 * The window is the whole method: a single residue's value is noise, and it is
 * the average over a stretch that separates a buried helix from a loop. Nine
 * is the usual choice for surface character, nineteen for membrane-spanning
 * segments, because that is about how many residues it takes to cross a lipid
 * bilayer as an alpha helix.
 */
export function hydropathyProfile(seq: string, window = 9): HydropathyPoint[] {
  const s = cleanProtein(seq);
  const w = Math.max(1, Math.min(window, s.length));
  if (!s.length) return [];
  const out: HydropathyPoint[] = [];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    sum += HYDROPATHY[s[i]] ?? 0;
    if (i >= w) sum -= HYDROPATHY[s[i - w]] ?? 0;
    if (i >= w - 1) {
      out.push({ position: i - Math.floor((w - 1) / 2) + 1, value: Math.round((sum / w) * 1000) / 1000 });
    }
  }
  return out;
}

export interface Segment {
  start: number;
  end: number;
  /** Mean hydropathy across the segment. */
  score: number;
}

/**
 * Stretches hydrophobic enough, for long enough, to cross a membrane.
 *
 * Kyte and Doolittle's own criterion: a 19-residue window averaging above
 * about 1.6 marks a candidate membrane-spanning segment. It is a criterion,
 * not a prediction -- a long hydrophobic stretch can equally be a buried core
 * or a signal peptide, and this says only that the stretch is hydrophobic.
 */
export function hydrophobicSegments(seq: string, window = 19, threshold = 1.6): Segment[] {
  const profile = hydropathyProfile(seq, window);
  const out: Segment[] = [];
  let run: HydropathyPoint[] = [];
  const close = () => {
    if (run.length === 0) return;
    // The positions whose own window is above the threshold -- not the extent
    // of those windows, which would reach half a window beyond the hydrophobic
    // stretch in each direction and report a segment wider than the feature.
    // The cost is the opposite: a stretch only as long as the window has a
    // narrow plateau, so a segment reads a few residues shorter than it is.
    out.push({
      start: run[0].position,
      end: run[run.length - 1].position,
      score: Math.round((run.reduce((n, p) => n + p.value, 0) / run.length) * 100) / 100,
    });
    run = [];
  };
  for (const p of profile) {
    if (p.value >= threshold) run.push(p);
    else close();
  }
  close();
  return out;
}

// ─── Charge, and the pH it is measured at ────────────────────────────────────

/**
 * Net charge, unrounded.
 *
 * The pI search needs this rather than the rounded figure below: rounding to
 * two places turns a smooth curve into a staircase, and bisecting a staircase
 * stops at the edge of a step. It put ribonuclease A's pI a hundredth below
 * the published one, and left a residual charge at the pI it returned.
 */
function netCharge(seq: string, ph: number): number {
  const s = cleanProtein(seq);
  if (!s.length) return 0;
  const count: Record<string, number> = {};
  for (const aa of s) count[aa] = (count[aa] ?? 0) + 1;

  // A base is protonated, and so positive, below its pKa; an acid is
  // deprotonated, and so negative, above its own.
  let charge = 1 / (1 + 10 ** (ph - PKA_N_TERM));
  for (const [aa, pka] of Object.entries(PKA_BASE)) {
    charge += (count[aa] ?? 0) / (1 + 10 ** (ph - pka));
  }
  charge -= 1 / (1 + 10 ** (PKA_C_TERM - ph));
  for (const [aa, pka] of Object.entries(PKA_ACID)) {
    charge -= (count[aa] ?? 0) / (1 + 10 ** (pka - ph));
  }
  return charge;
}

/** Net charge of the chain at a given pH, to two places. */
export function chargeAtPh(seq: string, ph: number): number {
  return Math.round(netCharge(seq, ph) * 100) / 100;
}

/** The pH at which the chain carries no net charge, by bisection. */
export function isoelectricPoint(seq: string): number {
  const s = cleanProtein(seq);
  if (!s.length) return 7;
  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (netCharge(s, mid) > 0) low = mid; else high = mid;
  }
  return Math.round(((low + high) / 2) * 100) / 100;
}

/** Net charge across the pH range, for picking an ion-exchange buffer. */
export function chargeCurve(seq: string, from = 2, to = 12, step = 0.25): { ph: number; charge: number }[] {
  const out: { ph: number; charge: number }[] = [];
  for (let ph = from; ph <= to + 1e-9; ph += step) {
    out.push({ ph: Math.round(ph * 100) / 100, charge: chargeAtPh(seq, ph) });
  }
  return out;
}

// ─── Absorbance ──────────────────────────────────────────────────────────────

export interface Absorbance {
  /** M⁻¹cm⁻¹, assuming every cysteine pair forms a cystine. */
  extinctionOxidised: number;
  /** M⁻¹cm⁻¹ with all cysteines reduced, which contribute nothing. */
  extinctionReduced: number;
  /** A280 of a 1 mg/mL solution, 1 cm path, oxidised. */
  a280Oxidised: number;
  a280Reduced: number;
  molecularWeight: number;
  /** True when there is no W, Y or cystine: A280 cannot measure it. */
  blind: boolean;
}

/** Residue masses, average isotopic, minus water. */
const RESIDUE_MASS: Record<string, number> = {
  A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388,
  E: 129.1155, Q: 128.1307, G: 57.0519, H: 137.1411, I: 113.1594,
  L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766, P: 97.1167,
  S: 87.0782, T: 101.1051, W: 186.2132, Y: 163.1760, V: 99.1326,
};

/**
 * How strongly the protein absorbs at 280 nm, by Pace et al. (1995) Protein
 * Sci 4:2411: tryptophan 5500, tyrosine 1490, and a cystine 125 M⁻¹cm⁻¹.
 *
 * Both forms are given because the difference is the question actually being
 * asked at the bench: a sample in reducing buffer has no cystines, and using
 * the oxidised coefficient for it overstates the concentration. A protein with
 * no W, Y or cystine absorbs nothing at 280 and cannot be measured this way at
 * all -- worth saying rather than returning a zero to divide by.
 */
export function absorbance(seq: string): Absorbance {
  const s = cleanProtein(seq);
  const count = (aa: string) => (s.match(new RegExp(aa, 'g')) ?? []).length;
  const w = count('W');
  const y = count('Y');
  const cystines = Math.floor(count('C') / 2);

  const extinctionReduced = w * 5500 + y * 1490;
  const extinctionOxidised = extinctionReduced + cystines * 125;
  let mass = 18.0153;
  for (const aa of s) mass += RESIDUE_MASS[aa] ?? 110;

  return {
    extinctionOxidised,
    extinctionReduced,
    a280Oxidised: mass ? Math.round((extinctionOxidised / mass) * 1000) / 1000 : 0,
    a280Reduced: mass ? Math.round((extinctionReduced / mass) * 1000) / 1000 : 0,
    molecularWeight: Math.round(mass * 100) / 100,
    blind: extinctionOxidised === 0,
  };
}

// ─── Composition ─────────────────────────────────────────────────────────────

export interface CompositionEntry {
  aa: string;
  count: number;
  /** Percentage of the chain, one decimal. */
  percent: number;
}

export function composition(seq: string): CompositionEntry[] {
  const s = cleanProtein(seq);
  const counts = new Map<string, number>();
  for (const aa of s) counts.set(aa, (counts.get(aa) ?? 0) + 1);
  return AMINO_ACIDS.split('').map(aa => {
    const count = counts.get(aa) ?? 0;
    return { aa, count, percent: s.length ? Math.round((count / s.length) * 1000) / 10 : 0 };
  });
}
