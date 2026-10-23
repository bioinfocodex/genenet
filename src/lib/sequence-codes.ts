import { nextCode } from './fields';

/**
 * A short identifier for a construct, of the kind that gets written on a tube.
 *
 * Samples, oligos and registry entities all carry one; sequences did not, so
 * the only way to refer to a plasmid was by its name. Names are not
 * identifiers: two people make "pEGFP-N1 v2", somebody renames one, and the
 * freezer label now points at a record nobody can find. A code is issued once
 * and does not change when the name does.
 */

/** PL for plasmids, GN for everything else, which is genes. */
export const PREFIXES: Record<string, string> = {
  plasmid: 'PL',
  gene: 'GN',
};

export const DEFAULT_PREFIX = 'GN';

export function prefixFor(type: string | null | undefined): string {
  if (!type) return DEFAULT_PREFIX;
  return PREFIXES[type.toLowerCase()] ?? DEFAULT_PREFIX;
}

export interface Codeable {
  id: string;
  type: string;
  code: string | null;
  /** Used only to order the backfill, so the oldest construct gets 001. */
  createdAt: string;
}

export interface BackfillPlan {
  /** The code each record would be given, in the order they would be issued. */
  assignments: { id: string; code: string }[];
  /** Records that already have one and are left alone. */
  alreadyCoded: number;
}

/**
 * What a one-off backfill would hand out.
 *
 * Oldest first, so the numbers run in the order the lab made the things rather
 * than in whatever order the database returns rows. That matters only once --
 * but it is the once that decides what PL-001 is for ever.
 *
 * Codes already issued are kept and counted, so a backfill run twice issues
 * nothing the second time, and a run after somebody has coded a few by hand
 * does not collide with them.
 */
export function planBackfill(records: Codeable[]): BackfillPlan {
  const taken: Record<string, string[]> = {};
  let alreadyCoded = 0;

  for (const r of records) {
    if (!r.code) continue;
    alreadyCoded++;
    const prefix = r.code.split('-')[0];
    (taken[prefix] ??= []).push(r.code);
  }

  const assignments: { id: string; code: string }[] = [];
  const pending = records
    .filter(r => !r.code)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));

  for (const r of pending) {
    const prefix = prefixFor(r.type);
    const code = nextCode(prefix, taken[prefix] ?? []);
    (taken[prefix] ??= []).push(code);
    assignments.push({ id: r.id, code });
  }

  return { assignments, alreadyCoded };
}

/**
 * Whether something typed is a sequence code rather than a name.
 *
 * Used to tell a scan from a search: somebody who scans PL-014 wants that
 * construct, not every construct whose notes mention it.
 */
export function looksLikeCode(text: string): boolean {
  return /^[A-Z]{2,6}-\d{1,6}$/.test(text.trim().toUpperCase());
}
