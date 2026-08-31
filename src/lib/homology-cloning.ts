import { revComp } from './alignment';
import { assemble, type Fragment, type AssemblyResult, type Assembly } from './assembly';
import { nnTm } from './tm';

/**
 * Gibson, In-Fusion and NEBuilder.
 *
 * One mechanism: fragments carry shared sequence at the ends they should meet
 * at, an enzyme mix chews back and repairs, and the shared sequence appears
 * once in the product. The three differ in how much homology they want, not in
 * what they do, so the assembly search is the engine's and only the
 * requirements and the checking live here.
 *
 * The check worth having is the one a protocol cannot give you. An overlap has
 * to be long enough, which any vendor page will tell you -- and it has to occur
 * exactly once in the finished construct, which nothing tells you until the
 * colonies come back mixed. A repeated overlap lets fragments anneal at the
 * wrong site, and the reaction has no way to prefer the right one.
 */

/** How far the search will look for homology, whatever the method prefers. */
const SEARCH_CEILING = 120;

export type OverlapMethod = 'gibson' | 'infusion' | 'nebuilder';

export interface MethodSpec {
  name: string;
  min: number;
  ideal: [number, number];
  max: number;
  /** What the vendor actually specifies, so the numbers are attributable. */
  note: string;
}

export const OVERLAP_METHODS: Record<OverlapMethod, MethodSpec> = {
  gibson: {
    name: 'Gibson Assembly',
    min: 15, ideal: [20, 40], max: 80,
    note: 'NEB recommends 20–40 bp of overlap; 15 bp is the practical floor.',
  },
  infusion: {
    name: 'In-Fusion',
    min: 15, ideal: [15, 15], max: 20,
    note: 'Takara specifies 15 bp exactly; longer is tolerated but not required.',
  },
  nebuilder: {
    name: 'NEBuilder HiFi',
    min: 16, ideal: [20, 30], max: 60,
    note: 'NEB recommends at least 16 bp, 20–30 bp for most assemblies.',
  },
};

export interface JunctionCheck {
  from: string;
  to: string;
  overlap: string;
  length: number;
  tm: number;
  gc: number;
  /** How many times this overlap occurs in the product, counting both strands. */
  occurrences: number;
  warnings: string[];
}

export interface HomologyAssemblyResult extends AssemblyResult {
  method: OverlapMethod;
  spec: MethodSpec;
  checks: JunctionCheck[];
  /** Spread of junction melting temperatures, °C. Wide spreads assemble unevenly. */
  tmSpread: number;
}

/** Occurrences of `needle` in `hay`, on either strand, allowing for a circle. */
export function countOccurrences(hay: string, needle: string, circular: boolean): number {
  if (!needle) return 0;
  const subject = circular ? hay + hay.slice(0, needle.length - 1) : hay;
  let n = 0;
  for (const pattern of new Set([needle, revComp(needle)])) {
    let i = subject.indexOf(pattern);
    while (i !== -1) { n++; i = subject.indexOf(pattern, i + 1); }
  }
  return n;
}

/**
 * Assemble by homology and report on every junction.
 *
 * The assembly itself is the engine's; what is added is whether each junction
 * is one a bench scientist should trust.
 */
export function assembleByHomology(
  fragments: Fragment[],
  method: OverlapMethod = 'gibson',
  opts: { topology?: 'circular' | 'linear' } = {},
): HomologyAssemblyResult {
  const spec = OVERLAP_METHODS[method];
  const topology = opts.topology ?? 'circular';

  // The search ceiling is deliberately generous rather than the method's
  // preferred maximum. A 25 bp arm offered to In-Fusion is not a failure --
  // the kit tolerates it, and the note on the spec says so. Capping the search
  // at 20 would not find a shorter window either, because the last 20 bases of
  // a 25 bp arm and the first 20 are different windows. So: find the homology
  // that is actually there, then say whether the method wanted that much.
  const result = assemble(fragments, {
    mode: 'overlap',
    topology,
    minOverlap: spec.min,
    maxOverlap: SEARCH_CEILING,
  });

  const best: Assembly | undefined = result.assemblies[0];
  const checks: JunctionCheck[] = [];

  if (best) {
    for (const j of best.junctions) {
      const overlap = j.shared;
      const warnings: string[] = [];
      const tm = nnTm(overlap);
      const gc = overlap ? (overlap.match(/[GC]/g) ?? []).length / overlap.length : 0;
      const occurrences = countOccurrences(best.sequence, overlap, topology === 'circular');

      if (overlap.length < spec.ideal[0]) {
        warnings.push(
          `${overlap.length} bp is below the ${spec.ideal[0]} bp ${spec.name} works best with.`,
        );
      }
      if (overlap.length > spec.max) {
        warnings.push(
          `${overlap.length} bp is beyond what ${spec.name} needs (${spec.ideal[0]}–${spec.ideal[1]} bp). ` +
          `It will still assemble, but every extra base has to be carried on a primer.`,
        );
      } else if (overlap.length > spec.ideal[1]) {
        warnings.push(
          `${overlap.length} bp is longer than the ${spec.ideal[0]}–${spec.ideal[1]} bp ${spec.name} works best with.`,
        );
      }
      // The check that matters: the overlap has to be unique, or fragments can
      // anneal in the wrong place and the reaction cannot tell.
      if (occurrences > 1) {
        warnings.push(
          `This overlap occurs ${occurrences} times in the construct. Fragments can anneal at the wrong copy, ` +
          `and the assembly has no way to prefer the right one.`,
        );
      }
      if (gc < 0.3) warnings.push(`GC is ${Math.round(gc * 100)}%; AT-rich overlaps anneal weakly.`);
      if (gc > 0.7) warnings.push(`GC is ${Math.round(gc * 100)}%; GC-rich overlaps form secondary structure.`);
      if (/(.)\1{5,}/.test(overlap)) warnings.push('A homopolymer run of 6 or more makes the junction slip.');

      checks.push({ from: j.from, to: j.to, overlap, length: overlap.length, tm, gc, occurrences, warnings });
    }
  }

  const tms = checks.map(c => c.tm).filter(Number.isFinite);
  const tmSpread = tms.length > 1 ? Math.max(...tms) - Math.min(...tms) : 0;

  const problems = [...result.problems];
  if (tmSpread > 10) {
    problems.push({
      kind: 'ambiguous-end',
      message:
        `Junction melting temperatures span ${tmSpread.toFixed(0)} °C. Junctions that anneal at very ` +
        `different temperatures assemble unevenly, and the weakest one sets the yield.`,
    });
  }

  return { ...result, problems, method, spec, checks, tmSpread };
}

/**
 * The tail to add to a primer so a fragment picks up the homology it needs.
 *
 * Gibson primers are the fragment's own annealing sequence with the neighbour's
 * end carried on the 5' side. Returning the two parts separately keeps the
 * distinction visible: only the annealing half sets the extension temperature.
 */
export interface OverlapPrimer {
  /** The whole oligo to order, 5'->3'. */
  sequence: string;
  /** The part that anneals to the template. */
  anneals: string;
  /** The 5' tail carrying homology to the neighbouring fragment. */
  tail: string;
  tmAnneal: number;
}

export function overlapPrimerFor(
  fragmentSeq: string,
  neighbourEnd: string,
  opts: { annealLength?: number; direction?: 'forward' | 'reverse' } = {},
): OverlapPrimer {
  const { annealLength = 20, direction = 'forward' } = opts;
  const anneals = direction === 'forward'
    ? fragmentSeq.slice(0, annealLength)
    : revComp(fragmentSeq.slice(-annealLength));
  const tail = neighbourEnd;
  return {
    sequence: tail + anneals,
    anneals,
    tail,
    tmAnneal: nnTm(anneals),
  };
}
