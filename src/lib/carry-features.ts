import { revComp } from './alignment';
import type { SequenceFeature } from './features';

/**
 * Carrying the parents' annotation into an assembled construct.
 *
 * Every construct saved from the Cloning Wizard opened as a bare circle: the
 * assembly engine works on sequences and knows nothing about features, so a
 * vector's AmpR and origin and an insert's CDS were all lost at the moment the
 * product was made -- exactly when they are most wanted, because the whole
 * point of simulating the assembly is to get a construct you can read.
 *
 * A feature is carried when its own bases are found in the product. That is
 * the question that matters, and it answers the hard parts for free: a
 * fragment reverse-complemented to fit is found on the other strand, a feature
 * spanning the origin of a circular product is found by searching the sequence
 * doubled, and a feature the digest cut through is simply not found -- which is
 * right, since half a promoter is not a promoter. Nothing has to be told where
 * each fragment landed, so nothing can be told wrong.
 */

/** Below this a match is chance rather than the feature. */
export const MIN_CARRY = 10;

export interface ParentAnnotation {
  name: string;
  sequence: string;
  circular?: boolean;
  features: SequenceFeature[];
}

export interface CarryResult {
  features: SequenceFeature[];
  /** Features whose bases are not in the product: cut through, or dropped. */
  lost: { parent: string; name: string; reason: 'not in the product' | 'too short to place' }[];
  /** Features found in more than one place, carried at each. */
  duplicated: { name: string; copies: number }[];
}

/** The bases a feature covers in its parent, or '' when it cannot be read. */
function basesOf(parent: ParentAnnotation, f: SequenceFeature): string {
  const seq = parent.sequence.toUpperCase();
  const n = seq.length;
  if (f.start < 1 || f.end > n || f.end < f.start) {
    // A feature written through the origin has end < start on a circle.
    if (parent.circular && f.end < f.start && f.start <= n) return seq.slice(f.start - 1) + seq.slice(0, f.end);
    return '';
  }
  return seq.slice(f.start - 1, f.end);
}

/** Every exact placement of `needle` in the product, on either strand. */
function placements(product: string, circular: boolean, needle: string): { start: number; strand: 1 | -1 }[] {
  const n = product.length;
  // A circular product is searched across its own join, so a feature sitting
  // over the origin is found once rather than not at all.
  const hay = circular && needle.length <= n ? product + product.slice(0, needle.length - 1) : product;
  const out: { start: number; strand: 1 | -1 }[] = [];
  for (const [probe, strand] of [[needle, 1], [revComp(needle), -1]] as const) {
    if (strand === -1 && probe === needle) continue; // palindrome: one site, not two
    for (let i = hay.indexOf(probe); i !== -1; i = hay.indexOf(probe, i + 1)) {
      if (i >= n) break;
      out.push({ start: i, strand });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Map every parent's features onto the product.
 *
 * Coordinates come out 1-indexed and inclusive, as the viewer stores them; a
 * feature found across the origin of a circular product keeps the wrapped form
 * the viewer already understands, with its end before its start.
 */
export function carryFeatures(
  product: string,
  circular: boolean,
  parents: ParentAnnotation[],
): CarryResult {
  const seq = product.toUpperCase();
  const n = seq.length;
  const out: SequenceFeature[] = [];
  const lost: CarryResult['lost'] = [];
  const duplicated: CarryResult['duplicated'] = [];
  const seen = new Set<string>();
  let counter = 0;

  for (const parent of parents) {
    for (const f of parent.features) {
      const bases = basesOf(parent, f);
      if (bases.length < MIN_CARRY) {
        lost.push({ parent: parent.name, name: f.name, reason: 'too short to place' });
        continue;
      }
      const sites = placements(seq, circular, bases);
      if (sites.length === 0) {
        lost.push({ parent: parent.name, name: f.name, reason: 'not in the product' });
        continue;
      }
      if (sites.length > 1) duplicated.push({ name: f.name, copies: sites.length });

      for (const site of sites) {
        const start = site.start + 1;
        const endRaw = site.start + bases.length;
        const end = endRaw > n ? endRaw - n : endRaw;
        // The same part carried by two parents -- a shared backbone element --
        // is one feature in the product, not two stacked on each other.
        const key = `${f.name}|${f.type}|${start}|${end}|${site.strand}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          ...f,
          id: `carried-${++counter}`,
          start,
          end,
          // Flipping the fragment flips the feature with it.
          strand: (f.strand * site.strand) as 1 | -1,
          // A spliced feature's blocks are in parent coordinates and mean
          // nothing here; the span was carried whole, so it is no longer one.
          ...(f.segments ? { segments: undefined } : {}),
        });
      }
    }
  }

  return { features: out.sort((a, b) => a.start - b.start), lost, duplicated };
}
