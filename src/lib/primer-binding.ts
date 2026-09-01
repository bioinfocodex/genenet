import { revComp } from './alignment';

/**
 * Where a primer sits on a template.
 *
 * The obvious implementation searches the template for the whole primer, and it
 * fails on the primers this application itself designs. Every cloning method in
 * the wizard adds a 5' tail — a restriction site, a Gibson arm, an att site, a
 * CACC for directional TOPO — and none of that tail is in the template. An
 * exact full-length search finds nothing for precisely the oligos someone most
 * wants to see on their map.
 *
 * A primer binds by its 3' end, and the 3' end is what has to match. So the
 * search is for the longest 3'-anchored stretch that occurs in the template.
 * The tail is reported separately rather than ignored, because a 40 bp oligo
 * annealing over 18 of them is a fact worth drawing.
 *
 * Orientation, which is the part that is easy to get backwards: a forward
 * primer's sequence reads along the top strand, so its 3' end is the right-hand
 * end of the match. A reverse primer's reverse complement reads along the top
 * strand, so the primer's 3' end is the *left-hand* end. Searching for suffixes
 * in both cases puts every reverse primer's arrow on the wrong end of its own
 * binding site.
 */

export type Strand = 'forward' | 'reverse';

export interface PrimerBinding {
  /** 0-indexed, inclusive, on the top strand — the annealing region only. */
  start: number;
  end: number;
  /** Which strand the primer anneals to, in the usual sense. */
  strand: Strand;
  /** Bases of the primer's 3' end that match. */
  annealLength: number;
  /** Bases at the primer's 5' end that do not — the tail. */
  tailLength: number;
  /** True when the whole primer matches, tail and all. */
  exact: boolean;
  /** True when the annealing region runs through the origin of a circle. */
  wrapsOrigin: boolean;
}

export interface BindingOptions {
  /** Shortest 3' match worth reporting. Below this it is chance, not annealing. */
  minAnneal?: number;
  circular?: boolean;
  /** Stop after this many sites per direction. */
  maxSites?: number;
}

/** Every index at which `needle` occurs in `haystack`, overlaps included. */
function occurrences(haystack: string, needle: string, limit: number): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1 && out.length < limit) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * Find where one primer anneals.
 *
 * Returns every site the longest 3' match occurs at. A primer that anneals in
 * two places is a real and important finding — it is why a PCR gives two bands
 * — so all of them come back rather than the first.
 */
export function findBindings(
  primerSeq: string,
  template: string,
  opts: BindingOptions = {},
): PrimerBinding[] {
  const { minAnneal = 12, circular = false, maxSites = 20 } = opts;

  const primer = primerSeq.toUpperCase().replace(/[^ACGT]/g, '');
  const top = template.toUpperCase().replace(/[^ACGT]/g, '');
  if (primer.length < minAnneal || top.length === 0) return [];

  // A circular template is searched across its own origin, so a primer sitting
  // over the join is found. The overlap only needs to be as long as the primer.
  const scan = circular && top.length > primer.length
    ? top + top.slice(0, primer.length - 1)
    : top;

  const out: PrimerBinding[] = [];

  for (const strand of ['forward', 'reverse'] as Strand[]) {
    // Forward: the primer reads along the top strand, 3' end on the right, so
    // the matching part is a suffix of the primer.
    // Reverse: its reverse complement reads along the top strand with the
    // primer's 3' end on the left, so the matching part is a prefix of that.
    const asTop = strand === 'forward' ? primer : revComp(primer);

    for (let n = primer.length; n >= minAnneal; n--) {
      const probe = strand === 'forward'
        ? asTop.slice(asTop.length - n)     // 3'-anchored suffix
        : asTop.slice(0, n);                // 3' end is the left edge here

      const hits = occurrences(scan, probe, maxSites);
      if (hits.length === 0) continue;

      for (const at of hits) {
        // A hit found only in the wrapped tail is the same site as one already
        // reported at the start of the sequence.
        if (at >= top.length) continue;
        const endRaw = at + n - 1;
        out.push({
          start: at,
          end: circular ? endRaw % top.length : Math.min(endRaw, top.length - 1),
          strand,
          annealLength: n,
          tailLength: primer.length - n,
          exact: n === primer.length,
          wrapsOrigin: circular && endRaw >= top.length,
        });
      }
      // Longest match wins; shorter ones are the same site reported worse.
      break;
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

export interface PrimerLike {
  id: string;
  name: string;
  sequence: string;
  direction?: string;
}

export interface PlacedPrimer extends PrimerBinding {
  id: string;
  name: string;
  /** The direction recorded on the primer, which may disagree with the match. */
  recordedDirection: Strand | null;
  /**
   * True when the primer was filed as forward and anneals as reverse, or the
   * other way about. Worth surfacing rather than silently trusting either.
   */
  directionMismatch: boolean;
}

/** Place a whole set of primers on a template. */
export function placePrimers(
  primers: PrimerLike[],
  template: string,
  opts: BindingOptions = {},
): PlacedPrimer[] {
  const out: PlacedPrimer[] = [];

  for (const p of primers) {
    const recorded: Strand | null =
      p.direction === 'forward' ? 'forward' : p.direction === 'reverse' ? 'reverse' : null;

    for (const b of findBindings(p.sequence, template, opts)) {
      out.push({
        ...b,
        id: p.id,
        name: p.name,
        recordedDirection: recorded,
        directionMismatch: recorded !== null && recorded !== b.strand,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** What to say about a binding in a tooltip. */
export function bindingTitle(p: PlacedPrimer): string {
  const lines = [
    `${p.name} — ${p.strand}, ${(p.start + 1).toLocaleString()}–${(p.end + 1).toLocaleString()}`,
  ];
  if (p.tailLength > 0) {
    lines.push(`${p.annealLength} nt anneal, ${p.tailLength} nt 5′ tail that does not bind here`);
  }
  if (p.wrapsOrigin) lines.push('Runs through the origin');
  if (p.directionMismatch) {
    lines.push(`Filed as ${p.recordedDirection} but anneals as ${p.strand}`);
  }
  return lines.join('\n');
}
