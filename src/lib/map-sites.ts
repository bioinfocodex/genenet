import { ENZYMES, findCutSites } from './restrictionEnzymes';
import type { ReSite } from '@/components/sequences/LinearMap';

/**
 * Every restriction site in a sequence, in the shape the maps draw.
 *
 * Shared rather than computed per view: the sequence viewer and the print view
 * must agree about where an enzyme cuts, and two copies of this arithmetic
 * would eventually disagree about the one thing a map is for.
 */

/** Distinguishable at a glance, and stable: an enzyme keeps its colour. */
export const RE_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4',
  '#f97316', '#ec4899', '#84cc16', '#78716c', '#0ea5e9', '#d946ef',
];

export function allSitesFor(sequence: string): ReSite[] {
  const sites: ReSite[] = [];
  Object.values(ENZYMES).forEach((enzyme, i) => {
    findCutSites(sequence, enzyme).forEach(cutPos => {
      const recognitionStart = cutPos - enzyme.cutBefore;
      sites.push({
        enzyme: enzyme.name,
        cutPos,
        /*
         * Both cut offsets are measured from the start of the recognition
         * site, so the bottom-strand cut is the site's start plus the enzyme's
         * own bottom offset. REBASE gives one for every enzyme in the table,
         * which is what lets a digest be drawn as the staggered cut it is.
         */
        cutBottom: recognitionStart + (enzyme.cutBottom ?? enzyme.cutBefore),
        recognitionStart,
        recognitionLen: enzyme.pattern.length,
        overhang: enzyme.overhang || 'blunt',
        overhangType: enzyme.overhangType,
        color: RE_COLORS[i % RE_COLORS.length],
      });
    });
  });
  return sites.sort((a, b) => a.cutPos - b.cutPos);
}
