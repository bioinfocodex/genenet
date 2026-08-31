/**
 * Melting temperature by nearest-neighbour thermodynamics.
 *
 * The GC-content formula already in simulation.ts is fine for a rough number
 * on a short oligo, but it cannot see sequence order: ATATATAT and AATTAATT
 * have identical GC content and melt several degrees apart, because stacking
 * between adjacent bases is where most of the stability sits. Junction design
 * needs to compare overlaps against each other, so the difference matters.
 *
 * Unified parameters from SantaLucia (1998) PNAS 95:1460, with the salt
 * correction from SantaLucia & Hicks (2004). Values are ΔH in kcal/mol and ΔS
 * in cal/(mol·K) for each stacked pair read 5'->3' on the top strand.
 */

export interface NN { dH: number; dS: number }

export const STACK: Record<string, NN> = {
  AA: { dH: -7.9, dS: -22.2 }, TT: { dH: -7.9, dS: -22.2 },
  AT: { dH: -7.2, dS: -20.4 },
  TA: { dH: -7.2, dS: -21.3 },
  CA: { dH: -8.5, dS: -22.7 }, TG: { dH: -8.5, dS: -22.7 },
  GT: { dH: -8.4, dS: -22.4 }, AC: { dH: -8.4, dS: -22.4 },
  CT: { dH: -7.8, dS: -21.0 }, AG: { dH: -7.8, dS: -21.0 },
  GA: { dH: -8.2, dS: -22.2 }, TC: { dH: -8.2, dS: -22.2 },
  CG: { dH: -10.6, dS: -27.2 },
  GC: { dH: -9.8, dS: -24.4 },
  GG: { dH: -8.0, dS: -19.9 }, CC: { dH: -8.0, dS: -19.9 },
};

/** Helix initiation, which differs depending on the terminal base pair. */
const INIT_GC: NN = { dH: 0.1, dS: -2.8 };
const INIT_AT: NN = { dH: 2.3, dS: 4.1 };

const R = 1.9872; // cal/(mol·K)

export interface TmOptions {
  /** Total strand concentration, mol/L. 0.25 µM is the usual primer working concentration. */
  strandConc?: number;
  /** Monovalent cation concentration, mol/L. */
  sodium?: number;
}

export interface Thermo {
  /** °C. NaN when the sequence is too short or not readable. */
  tm: number;
  /** kcal/mol */
  dH: number;
  /** cal/(mol·K) */
  dS: number;
  gc: number;
  length: number;
}

/** Full thermodynamics, for callers that want more than a temperature. */
export function duplexThermo(seq: string, opts: TmOptions = {}): Thermo {
  const { strandConc = 0.25e-6, sodium = 0.05 } = opts;
  const s = seq.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T');
  const gc = s ? (s.match(/[GC]/g) ?? []).length / s.length : 0;

  if (s.length < 2) return { tm: NaN, dH: 0, dS: 0, gc, length: s.length };

  let dH = 0, dS = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const pair = STACK[s.slice(i, i + 2)];
    // An unrecognised pair means an ambiguity code survived the filter.
    if (!pair) return { tm: NaN, dH: 0, dS: 0, gc, length: s.length };
    dH += pair.dH;
    dS += pair.dS;
  }

  for (const end of [s[0], s[s.length - 1]]) {
    const init = end === 'G' || end === 'C' ? INIT_GC : INIT_AT;
    dH += init.dH;
    dS += init.dS;
  }

  // Salt correction applies per phosphate, hence length - 1.
  const dSsalt = dS + 0.368 * (s.length - 1) * Math.log(sodium);

  // Non-self-complementary duplex: the concentration term is CT/4.
  const selfComp = s === revCompLocal(s);
  const ct = selfComp ? strandConc : strandConc / 4;

  const tmK = (dH * 1000) / (dSsalt + R * Math.log(ct));
  return { tm: tmK - 273.15, dH, dS: dSsalt, gc, length: s.length };
}

/** Melting temperature in °C. */
export function nnTm(seq: string, opts: TmOptions = {}): number {
  return duplexThermo(seq, opts).tm;
}

function revCompLocal(s: string): string {
  const c: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += c[s[i]] ?? 'N';
  return out;
}
