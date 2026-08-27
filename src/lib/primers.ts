import { reverseComplement } from './simulation';

/**
 * Where a primer sits on a template.
 *
 * Primers are stored as a name, a sequence, a Tm and a GC figure -- there are
 * no coordinates on the record, because a primer is an oligo rather than a
 * feature of any particular sequence. To draw one on a map, its position has
 * to be recovered by finding where it anneals.
 *
 * A forward primer matches the template as written. A reverse primer matches
 * the other strand, so its reverse complement is what appears in the stored
 * sequence -- and the coordinates returned are still template coordinates,
 * which is what the renderer draws in.
 *
 * Matching is exact. A primer carrying a deliberate mismatch (site-directed
 * mutagenesis, an added restriction site in a tail) will not be found, and
 * that is the honest answer: it does not anneal to this template as written.
 * Such a primer is reported as unlocated rather than drawn in the wrong place.
 */

/** 1-indexed, inclusive -- the convention features and enzyme sites use. */
export interface PrimerSite {
  start: number;
  end: number;
  /** Which strand the primer anneals to. */
  strand: 1 | -1;
}

const CLEAN = /[^ACGTUN]/gi;

/** Every exact match of `primer` on `template`, in template coordinates. */
export function locatePrimer(
  template: string,
  primer: string,
  direction: string,
): PrimerSite[] {
  const t = template.toUpperCase().replace(CLEAN, '').replace(/U/g, 'T');
  const raw = primer.toUpperCase().replace(CLEAN, '').replace(/U/g, 'T');
  if (!t || !raw) return [];

  const reverse = direction === 'reverse';
  // A reverse primer is written 5'->3' on the bottom strand, so what appears
  // on the template is its reverse complement.
  const needle = reverse ? reverseComplement(raw) : raw;
  if (!needle || needle.length > t.length) return [];

  const sites: PrimerSite[] = [];
  // Overlapping matches count: a primer that anneals twice in close proximity
  // is worth seeing, not worth hiding.
  for (let i = t.indexOf(needle); i !== -1; i = t.indexOf(needle, i + 1)) {
    sites.push({ start: i + 1, end: i + needle.length, strand: reverse ? -1 : 1 });
  }
  return sites;
}

export interface LocatedPrimer<T> {
  primer: T;
  site: PrimerSite;
}

/**
 * Locate a whole set, keeping the ones that could not be placed separate so
 * the caller can say so rather than silently showing fewer primers than the
 * user saved.
 */
export function locatePrimers<T extends { sequence: string; direction: string }>(
  template: string,
  primers: readonly T[],
): { located: LocatedPrimer<T>[]; unlocated: T[] } {
  const located: LocatedPrimer<T>[] = [];
  const unlocated: T[] = [];

  for (const primer of primers) {
    const sites = locatePrimer(template, primer.sequence, primer.direction);
    if (sites.length === 0) unlocated.push(primer);
    else for (const site of sites) located.push({ primer, site });
  }
  return { located, unlocated };
}
