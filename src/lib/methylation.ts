import { ENZYMES, findCutSites, type Enzyme } from './restrictionEnzymes';

/**
 * Whether a site will actually cut.
 *
 * The enzyme table is accurate about where things cut and silent about whether
 * they will, and that silence costs afternoons. Plasmid DNA from an ordinary
 * laboratory strain carries Dam and Dcm methylation, and an enzyme whose
 * recognition sequence happens to contain a methylated base does not cut it. The
 * site is on the map, the digest is set up, and the gel shows uncut plasmid.
 *
 * Two facts are needed and they are different in kind. Whether a particular site
 * overlaps a Dam or Dcm sequence is a property of the construct, computable
 * exactly. Whether the enzyme minds is a property of the enzyme, published by
 * suppliers and not derivable -- so the enzymes below are the well-established
 * cases rather than a complete list, and an overlap is reported either way. A
 * site flagged for an enzyme not in the table is one to check against the
 * supplier's chart, which is more use than silence.
 */

export type MethylationSystem = 'dam' | 'dcm' | 'cpg';

export interface MethylationSpec {
  name: string;
  /** The sequence recognised by the methyltransferase. */
  site: string;
  /** 0-indexed position within that sequence carrying the methyl group. */
  at: number;
  where: string;
}

export const SYSTEMS: Record<MethylationSystem, MethylationSpec> = {
  dam: {
    name: 'Dam',
    site: 'GATC',
    at: 1,
    where: 'Present in ordinary E. coli. Use a dam− strain to avoid it.',
  },
  dcm: {
    name: 'Dcm',
    site: 'CCWGG',
    at: 1,
    where: 'Present in ordinary E. coli. Use a dcm− strain to avoid it.',
  },
  cpg: {
    name: 'CpG',
    site: 'CG',
    at: 0,
    where: 'Present in DNA from most eukaryotes, and absent from plasmid grown in E. coli.',
  },
};

/**
 * Enzymes known to be blocked, and the notable ones known not to be.
 *
 * Kept short on purpose. Every entry here is a case a supplier states plainly;
 * guessing the rest would turn a useful warning into an unreliable one.
 */
const BLOCKED: Record<MethylationSystem, string[]> = {
  dam: ['MboI', 'ClaI', 'XbaI', 'BclI', 'BspHI', 'MboII', 'HphI', 'TaqI'],
  dcm: ['EcoRII', 'StuI', 'AvaII', 'NciI'],
  cpg: ['HpaII', 'SmaI', 'NotI', 'SacII', 'AatII', 'NarI'],
};

/** Enzymes that cut only when the site *is* methylated. */
const REQUIRES: Record<string, MethylationSystem> = { DpnI: 'dam' };

/** Isoschizomers that read the same site and ignore the methylation. */
const INSENSITIVE_ALTERNATIVE: Record<string, string> = {
  EcoRII: 'BstNI',
  MboI: 'Sau3AI',
  HpaII: 'MspI',
  ClaI: 'BspDI',
};

export interface BlockedSite {
  enzyme: string;
  /** 1-indexed cut position, as the rest of the tool reports them. */
  position: number;
  system: MethylationSystem;
  /** 1-indexed position of the methylated base. */
  methylatedAt: number;
  /** True when a supplier states this enzyme is blocked; false when unknown. */
  known: boolean;
  message: string;
}

function matchesIUPAC(sub: string, pat: string): boolean {
  const CODE: Record<string, string> = {
    A: 'A', C: 'C', G: 'G', T: 'T', W: 'AT', S: 'GC', R: 'AG', Y: 'CT',
    K: 'GT', M: 'AC', N: 'ACGT', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG',
  };
  if (sub.length !== pat.length) return false;
  for (let i = 0; i < pat.length; i++) {
    if (!(CODE[pat[i]] ?? '').includes(sub[i])) return false;
  }
  return true;
}

/** Every base a given system methylates, 0-indexed, on either strand. */
export function methylatedPositions(
  sequence: string, system: MethylationSystem, circular = false,
): number[] {
  const spec = SYSTEMS[system];
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const subject = circular ? seq + seq.slice(0, spec.site.length - 1) : seq;
  const out = new Set<number>();

  for (let i = 0; i + spec.site.length <= subject.length; i++) {
    const window = subject.slice(i, i + spec.site.length);
    if (matchesIUPAC(window, spec.site)) {
      out.add((i + spec.at) % seq.length);
      // The site is methylated on both strands, so the mirror base counts too.
      out.add((i + spec.site.length - 1 - spec.at) % seq.length);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Sites of the given enzymes that a methylated base falls inside.
 *
 * The recognition sequence is what matters, not the cut: an enzyme is blocked
 * because it cannot bind, and where it would have cut is beside the point.
 */
export function blockedSites(
  sequence: string,
  enzymeNames: string[],
  opts: { circular?: boolean; systems?: MethylationSystem[] } = {},
): BlockedSite[] {
  const { circular = false, systems = ['dam', 'dcm'] } = opts;
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const out: BlockedSite[] = [];

  const marks = new Map<MethylationSystem, Set<number>>();
  for (const s of systems) marks.set(s, new Set(methylatedPositions(seq, s, circular)));

  for (const name of enzymeNames) {
    const enzyme: Enzyme | undefined = ENZYMES[name];
    if (!enzyme) continue;
    const len = enzyme.pattern.length;

    // findCutSites reports cut positions; the recognition sequence starts a
    // fixed distance before, which for a Type IIS enzyme is well upstream.
    for (const cut of findCutSites(seq, enzyme)) {
      const siteStart = cut - enzyme.cutBefore;
      if (siteStart < 0 || siteStart + len > seq.length) continue;

      for (const system of systems) {
        const hits = marks.get(system)!;
        for (let k = siteStart; k < siteStart + len; k++) {
          if (!hits.has(k)) continue;
          const known = BLOCKED[system].includes(name);
          const alt = INSENSITIVE_ALTERNATIVE[name];
          out.push({
            enzyme: name,
            position: cut + 1,
            system,
            methylatedAt: k + 1,
            known,
            message: known
              ? `${name} is blocked by ${SYSTEMS[system].name} methylation, and this site carries it at ${k + 1}.` +
                (alt ? ` ${alt} reads the same site and is not blocked.` : '') +
                ` ${SYSTEMS[system].where}`
              : `This ${name} site overlaps a ${SYSTEMS[system].name} site at ${k + 1}. ` +
                `Whether ${name} minds is a property of the enzyme — check the supplier's chart.`,
          });
          break;
        }
      }
    }
  }
  return out;
}

/** Enzymes that need the site methylated, which is the opposite problem. */
export function requiresMethylation(name: string): MethylationSystem | null {
  return REQUIRES[name] ?? null;
}
