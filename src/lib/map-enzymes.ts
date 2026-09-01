import { ENZYMES } from './restrictionEnzymes';

/**
 * Choosing which restriction sites belong on a map.
 *
 * A 450-enzyme scan of a 3.7 kb plasmid finds around five thousand cuts. Drawing
 * them is not a map, it is a smear: the first version of this put 109 labels at
 * 32 positions, with BstSNI, Eco105I, SnaBI, SalI, AccI, FblI and XmiI stacked
 * on top of each other at one site. Every one of those is correct and the result
 * is unreadable, which is worse than showing less.
 *
 * Two rules do nearly all the work, and they are the ones SnapGene settled on:
 *
 *   - one label per site, not per enzyme. Isoschizomers recognise the same
 *     sequence, so they are one place to cut, and a map that names all seven is
 *     answering a question nobody asked.
 *   - six bases or more. A four-cutter lands every few hundred bases; its sites
 *     are real and are not decisions anyone makes from a map.
 *
 * Both are defaults rather than truths, so both are options.
 */

export interface SiteLike {
  enzyme: string;
  cutPos: number;
  /**
   * Where the bottom strand is cut, in the same coordinates as `cutPos`.
   *
   * The two are equal for a blunt cutter and differ by the overhang for every
   * other one. Carried rather than recomputed because the offset is a property
   * of the enzyme, and the sequence view has to draw both cuts to show what
   * end a digest actually leaves.
   */
  cutBottom: number;
  recognitionStart: number;
  recognitionLen: number;
  overhang: string;
  overhangType: string;
  color: string;
}

export interface MapSite {
  /** The name to draw. */
  enzyme: string;
  cutPos: number;
  /** Bottom-strand cut, in the same coordinates. Equal to `cutPos` when blunt. */
  cutBottom: number;
  recognitionStart: number;
  recognitionLen: number;
  overhang: string;
  overhangType: string;
  color: string;
  /** Other enzymes recognising this same stretch, best-known first. */
  alternatives: string[];
  /** How many times the chosen enzyme cuts the whole molecule. */
  cuts: number;
}

export interface ChooseOptions {
  /** Shortest recognition sequence worth drawing. */
  minSiteLength?: number;
  /** Most cuts an enzyme may make and still be drawn. 1 is "unique cutters". */
  maxCuts?: number;
  /** Names to prefer as the label when several share a site. */
  prefer?: string[];
  /**
   * Draw only these enzymes.
   *
   * Distinct from `prefer`, which only decides whose name is shown at a site
   * several enzymes share. Narrowing to a working set — the Golden Gate
   * enzymes, the ones in the freezer — is a different act from choosing what
   * to call a site, and conflating them would mean picking a set silently
   * dropped every site none of its members cut.
   */
  restrictTo?: string[];
  /** Hard ceiling, so a pathological sequence cannot fill the ring. */
  maxLabels?: number;
}

/**
 * Which of several enzymes at one site gets to be the label.
 *
 * Preference order: a name the caller asked for (their chosen enzyme set),
 * then REBASE's prototype for the family, then the shortest name, then
 * alphabetical. The prototype is the principled choice — REBASE names it as
 * the family's reference — and the tie-breaks after it only matter for sites
 * where REBASE has no opinion, where any stable answer will do so long as it
 * is the same one every time the map is drawn.
 */
function pickName(names: string[], prefer: Set<string>): string {
  const sorted = [...names].sort((a, b) => a.length - b.length || a.localeCompare(b));

  const chosen = sorted.find(n => prefer.has(n));
  if (chosen) return chosen;

  // A prototype that is itself present at this site.
  const prototype = sorted.find(n => {
    const p = ENZYMES[n]?.prototype;
    return !p || p === n;
  });
  return prototype ?? sorted[0];
}

/**
 * Collapse a full site scan down to what a map should carry.
 *
 * Sites are grouped by the stretch of DNA they recognise, so two enzymes
 * reading the same bases become one label whether they are true isoschizomers
 * or merely happen to match the same place.
 */
export function chooseMapEnzymes(
  sites: SiteLike[],
  cutCounts: Map<string, number>,
  opts: ChooseOptions = {},
): MapSite[] {
  const { minSiteLength = 6, maxCuts = 1, prefer = [], restrictTo, maxLabels = 60 } = opts;
  const preferred = new Set(prefer);
  const allowed = restrictTo ? new Set(restrictTo) : null;

  const eligible = sites.filter(s =>
    (!allowed || allowed.has(s.enzyme)) &&
    s.recognitionLen >= minSiteLength &&
    (cutCounts.get(s.enzyme) ?? Infinity) <= maxCuts);

  // Group by the recognised stretch, not by cut position: a neoschizomer cuts
  // the same site in a different place, and it is still the same site.
  const groups = new Map<string, SiteLike[]>();
  for (const s of eligible) {
    const key = `${s.recognitionStart}:${s.recognitionLen}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const out: MapSite[] = [];
  for (const group of groups.values()) {
    const names = [...new Set(group.map(g => g.enzyme))];
    const label = pickName(names, preferred);
    const chosen = group.find(g => g.enzyme === label) ?? group[0];
    out.push({
      enzyme: label,
      cutPos: chosen.cutPos,
      cutBottom: chosen.cutBottom,
      recognitionStart: chosen.recognitionStart,
      recognitionLen: chosen.recognitionLen,
      overhang: chosen.overhang,
      overhangType: chosen.overhangType,
      color: chosen.color,
      alternatives: names.filter(n => n !== label).sort(),
      cuts: cutCounts.get(label) ?? group.length,
    });
  }

  out.sort((a, b) => a.cutPos - b.cutPos);

  // Past the ceiling, keep the ones spread furthest apart rather than the first
  // sixty round the circle — a map crowded on one side and bare on the other is
  // a worse picture than an evenly thinned one.
  if (out.length <= maxLabels) return out;
  const step = out.length / maxLabels;
  return Array.from({ length: maxLabels }, (_, i) => out[Math.floor(i * step)]);
}

/** Cut counts per enzyme, which the filter needs and a site list does not carry. */
export function countCuts(sites: SiteLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sites) counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
  return counts;
}

/** How the label should read when several enzymes share the site. */
export function siteLabel(site: MapSite): string {
  return site.alternatives.length ? `${site.enzyme} +${site.alternatives.length}` : site.enzyme;
}

/** How the digest leaves the ends, in words. */
export function endDescription(site: MapSite): string {
  if (site.overhangType === 'blunt' || site.cutBottom === site.cutPos) return 'blunt ends';
  const n = Math.abs(site.cutBottom - site.cutPos);
  const kind = site.overhangType === '3prime' ? "3′" : "5′";
  // Type IIS enzymes cut outside their site, so the overhang is whatever the
  // target happens to be there -- known in length but not in sequence.
  const seq = site.overhang ? ` ${site.overhang}` : '';
  return `${n} nt ${kind} overhang${seq}`;
}

/** The full list, for a tooltip. */
export function siteTitle(site: MapSite): string {
  const where = `cuts at ${(site.cutPos + 1).toLocaleString()}`;
  const ends = endDescription(site);
  const head = `${site.enzyme} — ${where}, ${ends}`;
  if (!site.alternatives.length) return head;
  return `${head}\nSame site: ${site.alternatives.join(', ')}`;
}
