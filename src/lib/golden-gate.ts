import { ENZYMES, type Enzyme } from './restrictionEnzymes';
import { revComp } from './alignment';
import { assemble, sticky, type Fragment, type AssemblyProblem, type Assembly } from './assembly';

/**
 * Golden Gate assembly.
 *
 * A Type IIS enzyme cuts outside its own recognition site, so the overhang it
 * leaves is whatever the target sequence happens to be there. That is the whole
 * trick: the four bases are chosen by the designer rather than by the enzyme,
 * so parts can be made to join in one defined order, and the sites themselves
 * end up on the pieces that are thrown away.
 *
 * It also means the reaction is only as good as the overhang set, and that is
 * where it goes wrong. A repeated overhang lets two parts swap. A palindromic
 * one ligates to itself. And two overhangs differing by a single base
 * mis-ligate at a rate that is small per event and ruinous across a twelve-part
 * assembly -- which is why NEB publish fidelity data for overhang sets at all.
 * None of that is visible in a protocol, and all of it is checkable here.
 */

export interface TypeIISSite {
  /** Index of the recognition sequence in the template. */
  index: number;
  orientation: 'forward' | 'reverse';
  /** Cut position on the top strand: the bond broken sits before this index. */
  topCut: number;
  /** Cut position on the bottom strand, in top-strand coordinates. */
  bottomCut: number;
  /** The single-stranded bases left behind, read 5'->3' on the top strand. */
  overhang: string;
}

/**
 * Every place the enzyme will cut, with the overhang it leaves.
 *
 * Worth computing here rather than reusing findCutSites, which returns the
 * top-strand cut for a forward site and the bottom-strand cut for a reverse
 * one. That is harmless when all you want is fragment sizes and wrong when you
 * want the four bases that decide whether the assembly works.
 */
export function findTypeIISSites(sequence: string, enzyme: Enzyme): TypeIISSite[] {
  const seq = sequence.toUpperCase();
  const pat = enzyme.pattern;
  const patLen = pat.length;
  const rcPat = revComp(pat);
  const sites: TypeIISSite[] = [];

  if (enzyme.cutBottom === undefined) return sites;

  for (let i = 0; i + patLen <= seq.length; i++) {
    const sub = seq.slice(i, i + patLen);

    if (matches(sub, pat)) {
      const topCut = i + enzyme.cutBefore;
      const bottomCut = i + enzyme.cutBottom;
      if (topCut >= 0 && bottomCut <= seq.length) {
        sites.push({ index: i, orientation: 'forward', topCut, bottomCut, overhang: seq.slice(topCut, bottomCut) });
      }
    }
    // A non-palindromic site can also sit on the other strand, and then the
    // enzyme reaches back the other way.
    if (rcPat !== pat && matches(sub, rcPat)) {
      const topCut = i - (enzyme.cutBottom - patLen);
      const bottomCut = i - (enzyme.cutBefore - patLen);
      if (topCut >= 0 && bottomCut <= seq.length) {
        sites.push({ index: i, orientation: 'reverse', topCut, bottomCut, overhang: seq.slice(topCut, bottomCut) });
      }
    }
  }
  return sites.sort((a, b) => a.topCut - b.topCut);
}

function matches(sub: string, pat: string): boolean {
  const IUPAC: Record<string, string> = {
    A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'GC', W: 'AT',
    K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
  };
  if (sub.length !== pat.length) return false;
  for (let i = 0; i < pat.length; i++) {
    if (!(IUPAC[pat[i]] ?? '').includes(sub[i])) return false;
  }
  return true;
}

export interface DigestedPiece extends Fragment {
  /** True when this piece still carries a recognition site, so it is waste. */
  carriesSite: boolean;
  /** True for a piece bounded by an original end rather than by two cuts. */
  fromTerminus: boolean;
}

/**
 * Cut a part with a Type IIS enzyme and return the pieces with real ends.
 *
 * A circular template is cut into as many pieces as there are cuts. A linear
 * one keeps two blunt-ended termini, which is why the terminal pieces are
 * marked: they are ends of the input, not ends the enzyme made.
 */
export function digestTypeIIS(
  name: string, sequence: string, enzymeName: string, circular = true,
): DigestedPiece[] {
  const enzyme = ENZYMES[enzymeName];
  if (!enzyme) throw new Error(`Unknown enzyme: ${enzymeName}`);
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const sites = findTypeIISSites(seq, enzyme);
  if (sites.length === 0) return [];

  const pieces: DigestedPiece[] = [];
  const ohType = enzyme.overhangType === '3prime' ? "3'" : "5'";

  if (circular) {
    // Between consecutive cuts, wrapping round the origin.
    for (let k = 0; k < sites.length; k++) {
      const a = sites[k];
      const b = sites[(k + 1) % sites.length];
      // The core runs from the end of a's overhang to the start of b's.
      const start = a.bottomCut;
      const end = b.topCut;
      const core = start <= end ? seq.slice(start, end) : seq.slice(start) + seq.slice(0, end);
      const id = `${name}#${k}`;
      pieces.push({
        id, name: sites.length === 1 ? name : `${name} [${k + 1}]`,
        seq: core,
        left: sticky(ohType, a.overhang),
        right: sticky(ohType, revComp(b.overhang)),
        carriesSite: findTypeIISSites(a.overhang + core + b.overhang, enzyme).length > 0,
        fromTerminus: false,
      });
    }
  } else {
    for (let k = 0; k <= sites.length; k++) {
      const a = k === 0 ? null : sites[k - 1];
      const b = k === sites.length ? null : sites[k];
      const start = a ? a.bottomCut : 0;
      const end = b ? b.topCut : seq.length;
      if (end < start) continue;
      const core = seq.slice(start, end);
      pieces.push({
        id: `${name}#${k}`, name: `${name} [${k + 1}]`,
        seq: core,
        left: a ? sticky(ohType, a.overhang) : { type: 'blunt', overhang: '' },
        right: b ? sticky(ohType, revComp(b.overhang)) : { type: 'blunt', overhang: '' },
        carriesSite: findTypeIISSites(core, enzyme).length > 0,
        fromTerminus: !a || !b,
      });
    }
  }
  return pieces;
}

export interface OverhangIssue {
  kind: 'duplicate' | 'palindrome' | 'one-base-apart' | 'low-complexity';
  overhangs: string[];
  message: string;
}

/** Bases differing between two equal-length strings. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * Judge an overhang set before the reaction is set up.
 *
 * The one-base check is the one that is easy to miss and expensive to learn:
 * T4 ligase will join a pair that mismatches at a single position, rarely
 * enough to ignore in a two-part assembly and often enough to dominate a
 * twelve-part one. Overhang sets are chosen to avoid it, which only helps if
 * something checks.
 */
export function checkOverhangSet(overhangs: string[]): OverhangIssue[] {
  const issues: OverhangIssue[] = [];
  const seen = new Map<string, number>();

  for (const oh of overhangs) {
    seen.set(oh, (seen.get(oh) ?? 0) + 1);
    if (revComp(oh) === oh) {
      issues.push({
        kind: 'palindrome', overhangs: [oh],
        message: `${oh} is its own reverse complement, so it ligates to itself and to any other copy of that end.`,
      });
    }
    if (/^(A+|T+|G+|C+)$/.test(oh)) {
      issues.push({
        kind: 'low-complexity', overhangs: [oh],
        message: `${oh} is a single-base run. Runs pair weakly and slip against each other.`,
      });
    }
  }

  for (const [oh, n] of seen) {
    if (n > 1) {
      issues.push({
        kind: 'duplicate', overhangs: [oh],
        message: `${oh} is used ${n} times. Any part carrying it can take any of those places.`,
      });
    }
  }

  const unique = [...seen.keys()];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i], b = unique[j];
      // Compare against the partner's complement: that is the pairing the
      // ligase is actually judging.
      if (hamming(a, revComp(b)) === 1) {
        issues.push({
          kind: 'one-base-apart', overhangs: [a, b],
          message:
            `${a} and ${b} differ by one base from a perfect pair. Ligase joins mismatched ends of this kind ` +
            `at a low but real rate, and across many parts that becomes the dominant wrong product.`,
        });
      }
    }
  }
  return issues;
}

export interface GoldenGateResult {
  enzyme: string;
  /** The pieces with no remaining site: the ones that go into the product. */
  parts: DigestedPiece[];
  /** Pieces still carrying a site, which the enzyme keeps cutting. */
  discarded: DigestedPiece[];
  assemblies: Assembly[];
  problems: AssemblyProblem[];
  overhangIssues: OverhangIssue[];
  /** Overhangs in the order the assembly uses them. */
  overhangs: string[];
  steps: number;
}

/**
 * Digest each input with the enzyme and assemble what survives.
 *
 * The pieces that go into the product are the ones with no recognition site
 * left, whichever way the sites were arranged in the donor. That is the rule in
 * every Golden Gate layout: the sites end up on the parts that are discarded,
 * because anything still carrying one would be cut again in the same tube.
 */
export function goldenGate(
  inputs: { name: string; sequence: string; circular?: boolean }[],
  enzymeName = 'BsaI',
  opts: { topology?: 'circular' | 'linear' } = {},
): GoldenGateResult {
  const enzyme = ENZYMES[enzymeName];
  if (!enzyme) throw new Error(`Unknown enzyme: ${enzymeName}`);
  if (!enzyme.typeIIS) {
    throw new Error(`${enzymeName} cuts inside its recognition site, so it cannot define arbitrary overhangs.`);
  }

  const all: DigestedPiece[] = [];
  const noSite: string[] = [];
  for (const input of inputs) {
    const pieces = digestTypeIIS(input.name, input.sequence, enzymeName, input.circular ?? true);
    if (pieces.length === 0) noSite.push(input.name);
    all.push(...pieces);
  }

  const parts = all.filter(p => !p.carriesSite && p.seq.length > 0);

  // A donor that releases exactly one part is named for the donor. The index
  // only earns its place when there is something to tell apart.
  const releasedPerDonor = new Map<string, number>();
  for (const p of parts) {
    const donor = p.id.split('#')[0];
    releasedPerDonor.set(donor, (releasedPerDonor.get(donor) ?? 0) + 1);
  }
  for (const p of parts) {
    const donor = p.id.split('#')[0];
    if (releasedPerDonor.get(donor) === 1) p.name = donor;
  }
  const discarded = all.filter(p => p.carriesSite || p.seq.length === 0);

  const problems: AssemblyProblem[] = [];
  for (const name of noSite) {
    problems.push({
      kind: 'orphan-fragment',
      message: `${name} has no ${enzymeName} site, so nothing releases it. Check the site orientation.`,
    });
  }

  const overhangIssues = checkOverhangSet(
    parts.flatMap(p => [p.left.overhang, p.right.overhang].filter(Boolean)),
  );

  if (parts.length === 0) {
    return {
      enzyme: enzymeName, parts, discarded, assemblies: [], overhangIssues, overhangs: [], steps: 0,
      problems: [...problems, { kind: 'no-assembly', message: `Nothing was released by ${enzymeName}.` }],
    };
  }

  const result = assemble(parts, { mode: 'overhang', topology: opts.topology ?? 'circular' });

  // A construct that still contains the site is cut again in the same tube.
  for (const asm of result.assemblies) {
    const remaining = findTypeIISSites(asm.sequence, enzyme);
    if (remaining.length > 0) {
      problems.push({
        kind: 'ambiguous-end',
        message:
          `The assembled construct still contains ${remaining.length} ${enzymeName} site(s). ` +
          `The enzyme is in the same tube as the ligase, so this product is cut as fast as it forms.`,
      });
      break;
    }
  }

  const overhangs = result.assemblies[0]?.junctions.map(j => j.shared) ?? [];

  return {
    enzyme: enzymeName,
    parts, discarded,
    assemblies: result.assemblies,
    problems: [...problems, ...result.problems],
    overhangIssues,
    overhangs,
    steps: result.steps,
  };
}
