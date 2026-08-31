import { ENZYMES, findCutSites, type Enzyme } from './restrictionEnzymes';

/**
 * Narrowing 570 enzymes to the ones worth looking at.
 *
 * Every view in the tool showed the whole table, which on a real plasmid means
 * a wall of names with thousands of cuts among them and no way to find the
 * three that matter. What a person actually asks is narrower: what cuts this
 * once, what does not cut it at all, what do I have in the freezer, and if this
 * one is no good what else reads the same site.
 */

export interface EnzymeHit {
  name: string;
  enzyme: Enzyme;
  cuts: number[];
}

/** Cut counts for a set of enzymes against one sequence. */
export function profile(sequence: string, names: string[] = Object.keys(ENZYMES)): EnzymeHit[] {
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const out: EnzymeHit[] = [];
  for (const name of names) {
    const enzyme = ENZYMES[name];
    if (!enzyme) continue;
    out.push({ name, enzyme, cuts: findCutSites(seq, enzyme) });
  }
  return out;
}

/**
 * Enzymes cutting exactly once.
 *
 * The single most useful question about a vector, because a unique site is
 * where something can be put without losing anything.
 */
export function uniqueCutters(hits: EnzymeHit[]): EnzymeHit[] {
  return hits.filter(h => h.cuts.length === 1).sort((a, b) => a.cuts[0] - b.cuts[0]);
}

/** Enzymes that leave the sequence alone, which is what you want for a backbone. */
export function nonCutters(hits: EnzymeHit[]): EnzymeHit[] {
  return hits.filter(h => h.cuts.length === 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** Enzymes cutting between two and `max` times, for a diagnostic digest. */
export function fewCutters(hits: EnzymeHit[], max = 3): EnzymeHit[] {
  return hits
    .filter(h => h.cuts.length >= 2 && h.cuts.length <= max)
    .sort((a, b) => a.cuts.length - b.cuts.length || a.name.localeCompare(b.name));
}

/**
 * Enzymes reading the same site as this one.
 *
 * REBASE groups isoschizomers under a prototype, so two enzymes are
 * isoschizomers when they resolve to the same prototype. The distinction worth
 * drawing is between those that also cut in the same place and those that do
 * not: KpnI and Acc65I both read GGTACC, but one leaves a 3' overhang and the
 * other a 5', and swapping them changes what the fragment will ligate to.
 */
export interface Isoschizomers {
  /** Same site, same cut: a drop-in substitute. */
  identical: string[];
  /** Same site, different cut position, so different ends. */
  neoschizomers: string[];
}

export function isoschizomersOf(name: string): Isoschizomers {
  const self = ENZYMES[name];
  if (!self) return { identical: [], neoschizomers: [] };
  const group = self.prototype || name;

  const identical: string[] = [];
  const neoschizomers: string[] = [];

  for (const [other, e] of Object.entries(ENZYMES)) {
    if (other === name) continue;
    if ((e.prototype || other) !== group) continue;
    // Same recognition sequence is implied by the group, but the cut may differ.
    if (e.cutBefore === self.cutBefore && e.cutBottom === self.cutBottom) identical.push(other);
    else neoschizomers.push(other);
  }
  return {
    identical: identical.sort(),
    neoschizomers: neoschizomers.sort(),
  };
}

/**
 * A named set of enzymes, such as what a lab keeps in the freezer.
 *
 * Filtering by what is actually available is the difference between a list of
 * options and a list of suggestions, and it is the filter people reach for
 * first.
 */
export interface EnzymeSet {
  name: string;
  enzymes: string[];
}

/** Common starting points, so a set does not have to be built from nothing. */
export const STARTER_SETS: EnzymeSet[] = [
  {
    name: 'Common six-cutters',
    enzymes: ['EcoRI', 'BamHI', 'HindIII', 'XbaI', 'XhoI', 'SalI', 'PstI', 'SacI',
              'KpnI', 'SmaI', 'NotI', 'SpeI', 'NcoI', 'NdeI', 'BglII', 'ClaI'],
  },
  {
    name: 'Golden Gate (Type IIS)',
    enzymes: ['BsaI', 'BsmBI', 'BbsI', 'SapI', 'Esp3I', 'PaqCI', 'AarI'],
  },
  {
    name: 'Blunt cutters',
    enzymes: ['SmaI', 'EcoRV', 'PvuII', 'StuI', 'ScaI', 'HpaI', 'NruI', 'SspI', 'DraI'],
  },
];

/** Only the enzymes in `set` that this build actually knows. */
export function resolveSet(set: EnzymeSet): string[] {
  return set.enzymes.filter(n => ENZYMES[n]);
}
