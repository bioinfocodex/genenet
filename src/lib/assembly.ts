import { revComp } from './alignment';

/**
 * Joining DNA fragments into a construct.
 *
 * Every cloning method in the wizard is the same problem underneath: given
 * pieces of DNA and a rule for which ends may meet, find the arrangements that
 * satisfy the rule, and say what comes out. Gibson, Golden Gate, Gateway and
 * restriction cloning differ in the rule, not in the search. Writing the search
 * once means the methods differ only where they actually differ.
 *
 * Two things this returns that a protocol cannot:
 *
 *   The product sequence. Not a size, not a diagram -- the bases, so the result
 *   can be mapped, digested and sequenced against like any other construct.
 *
 *   Every arrangement, not the first one found. An assembly that can go together
 *   two ways is the failure that costs a week: the reaction works, the colonies
 *   grow, and half of them are wrong. That is worth reporting loudly, and it is
 *   invisible if the search stops at the first success.
 */

export type EndType = 'blunt' | "5'" | "3'";

export interface End {
  type: EndType;
  /**
   * The single-stranded bases, written 5'->3' along whichever strand carries
   * them. Empty when blunt.
   *
   * Defining it on the carrying strand rather than always on the top makes the
   * compatibility rule uniform: two ends anneal when one overhang is the
   * reverse complement of the other, whether the protrusion is 5' or 3'.
   */
  overhang: string;
}

export interface Fragment {
  id: string;
  name: string;
  /** Top strand of the double-stranded core, 5'->3'. Overhang bases are not included. */
  seq: string;
  left: End;
  right: End;
}

export interface Junction {
  /** Fragment on the 5' side of the join. */
  from: string;
  /** Fragment on the 3' side. */
  to: string;
  /** Position in the product where the junction sits, 1-indexed. */
  at: number;
  /** The bases the two fragments share at this join. */
  shared: string;
  kind: 'overhang' | 'overlap' | 'blunt';
}

export interface Placement {
  fragmentId: string;
  name: string;
  /** True when the fragment was reverse-complemented to make it fit. */
  flipped: boolean;
}

export interface Assembly {
  sequence: string;
  topology: 'circular' | 'linear';
  order: Placement[];
  junctions: Junction[];
}

export interface AssemblyProblem {
  kind: 'ambiguous-end' | 'palindromic-overhang' | 'orphan-fragment'
      | 'no-assembly' | 'multiple-assemblies' | 'search-truncated';
  message: string;
}

export interface AssemblyResult {
  assemblies: Assembly[];
  problems: AssemblyProblem[];
  /**
   * Arrangements the search actually tried.
   *
   * Reported because it is the honest measure of how hard the input was, and
   * because it is what a regression in the symmetry-breaking would show up in.
   * Wall-clock time measures the machine; this measures the algorithm.
   */
  steps: number;
}

export interface AssemblyOptions {
  /**
   * 'overhang' -- ends anneal through complementary sticky ends. Restriction
   * cloning and Golden Gate.
   * 'overlap'  -- ends are joined through shared terminal sequence. Gibson,
   * In-Fusion, NEBuilder.
   */
  mode: 'overhang' | 'overlap';
  topology?: 'circular' | 'linear';
  /** overlap mode: the homology window that counts as a join. */
  minOverlap?: number;
  maxOverlap?: number;
  /** Blunt ends join anything, so this is off unless asked for. */
  allowBlunt?: boolean;
  /** Stop after this many distinct arrangements. Two is enough to prove ambiguity. */
  limit?: number;
  /**
   * Ceiling on how many arrangements the search will try.
   *
   * Distinct results are a poor budget on their own: fragments that all share
   * one overhang generate an exponential number of paths that collapse to a
   * handful of molecules, so the search can run for seconds while finding
   * almost nothing. Eight identical ends took nearly three seconds before this
   * existed, which in a browser is a frozen tab.
   */
  maxSteps?: number;
}

export function blunt(): End {
  return { type: 'blunt', overhang: '' };
}

export function sticky(type: "5'" | "3'", overhang: string): End {
  return { type, overhang: overhang.toUpperCase() };
}

/** A fragment with blunt ends -- the starting point for overlap assembly. */
export function fragmentOf(id: string, name: string, seq: string): Fragment {
  return { id, name, seq: seq.toUpperCase().replace(/\s/g, ''), left: blunt(), right: blunt() };
}

/**
 * Reverse-complement a fragment.
 *
 * The ends swap sides, but each overhang's own sequence is unchanged: it is
 * written along the strand carrying it, and flipping the molecule only changes
 * which strand is called the top one. Rewriting the overhangs here is the
 * mistake that makes half the orientations silently fail to match.
 */
export function flip(f: Fragment): Fragment {
  return { id: f.id, name: f.name, seq: revComp(f.seq), left: f.right, right: f.left };
}

/** True when the 3' end of `a` can anneal to the 5' end of `b`. */
export function endsJoin(a: End, b: End, allowBlunt: boolean): boolean {
  if (a.type === 'blunt' && b.type === 'blunt') return allowBlunt;
  if (a.type !== b.type) return false;
  if (!a.overhang || !b.overhang) return false;
  return revComp(a.overhang) === b.overhang;
}

/**
 * The bases a junction contributes to the product's top strand.
 *
 * With a 5' overhang the top strand protrudes on the downstream fragment; with
 * a 3' overhang it protrudes on the upstream one. Either way the shared bases
 * appear once.
 */
function junctionBases(a: End, b: End): string {
  if (a.type === "5'") return b.overhang;
  if (a.type === "3'") return a.overhang;
  return '';
}

/** Length of homology joining the 3' end of `a` to the 5' end of `b`, or 0. */
export function overlapLength(a: string, b: string, min: number, max: number): number {
  const cap = Math.min(max, a.length, b.length);
  // Longest first: a 30 bp homology also contains a 20 bp one, and the longest
  // is the join the reaction will actually make.
  for (let n = cap; n >= min; n--) {
    if (a.slice(a.length - n) === b.slice(0, n)) return n;
  }
  return 0;
}

/**
 * A circular molecule has no start and no orientation, so the same construct
 * can be written many ways. Comparing sequences directly would report one
 * assembly as several. The canonical form is the lexicographically smallest
 * rotation of the sequence and of its reverse complement.
 */
export function canonicalCircular(seq: string): string {
  if (!seq) return '';
  let best: string | null = null;
  for (const s of [seq, revComp(seq)]) {
    const doubled = s + s;
    for (let i = 0; i < s.length; i++) {
      const rot = doubled.slice(i, i + s.length);
      if (best === null || rot < best) best = rot;
    }
  }
  return best!;
}

/** Linear molecules are the same if one reads as the other's reverse complement. */
export function canonicalLinear(seq: string): string {
  const r = revComp(seq);
  return seq < r ? seq : r;
}

interface Step { frag: Fragment; flipped: boolean }

export function assemble(input: Fragment[], opts: AssemblyOptions): AssemblyResult {
  const {
    mode,
    topology = 'circular',
    minOverlap = 15,
    maxOverlap = 60,
    allowBlunt = false,
    limit = 8,
    maxSteps = 200_000,
  } = opts;

  const problems: AssemblyProblem[] = [];
  const fragments = input.filter(f => f.seq.length > 0);
  if (fragments.length === 0) {
    return { assemblies: [], problems: [{ kind: 'no-assembly', message: 'No fragments were given.' }], steps: 0 };
  }

  // Both orientations of every fragment, unless it is a palindrome, in which
  // case the two are the same molecule and trying both only doubles the work.
  const options: Step[] = [];
  for (const f of fragments) {
    options.push({ frag: f, flipped: false });
    const r = flip(f);
    if (r.seq !== f.seq || r.left.overhang !== f.left.overhang) {
      options.push({ frag: r, flipped: true });
    }
  }

  const joins = (a: Step, b: Step): { ok: boolean; shared: string; kind: Junction['kind'] } => {
    if (mode === 'overhang') {
      if (!endsJoin(a.frag.right, b.frag.left, allowBlunt)) return { ok: false, shared: '', kind: 'blunt' };
      const shared = junctionBases(a.frag.right, b.frag.left);
      return { ok: true, shared, kind: a.frag.right.type === 'blunt' ? 'blunt' : 'overhang' };
    }
    const n = overlapLength(a.frag.seq, b.frag.seq, minOverlap, maxOverlap);
    return n > 0
      ? { ok: true, shared: b.frag.seq.slice(0, n), kind: 'overlap' }
      : { ok: false, shared: '', kind: 'overlap' };
  };

  const found: Assembly[] = [];
  const seen = new Set<string>();
  let steps = 0;
  let truncated = false;
  const path: Step[] = [];
  const used = new Set<string>();

  const record = () => {
    // Build the product from the ordered steps.
    let seq = '';
    const junctions: Junction[] = [];
    for (let i = 0; i < path.length; i++) {
      const cur = path[i];
      const next = path[(i + 1) % path.length];
      const last = i === path.length - 1;

      if (mode === 'overlap') {
        if (last && topology === 'linear') { seq += cur.frag.seq; break; }
        const j = joins(cur, next);
        // Each fragment keeps the homology at its start and gives up the copy
        // at its end, so every arm is written exactly once. On a circle that
        // is already the whole molecule: the last fragment's trailing arm is
        // the first fragment's leading arm, and appending it again would put a
        // duplicate copy in the product.
        seq += cur.frag.seq.slice(0, cur.frag.seq.length - j.shared.length);
        junctions.push({ from: cur.frag.name, to: next.frag.name, at: seq.length + 1, shared: j.shared, kind: 'overlap' });
      } else {
        seq += cur.frag.seq;
        if (last && topology === 'linear') break;
        const j = joins(cur, next);
        junctions.push({ from: cur.frag.name, to: next.frag.name, at: seq.length + 1, shared: j.shared, kind: j.kind });
        seq += j.shared;
      }
    }

    const key = topology === 'circular' ? canonicalCircular(seq) : canonicalLinear(seq);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({
      sequence: seq,
      topology,
      order: path.map(s => ({ fragmentId: s.frag.id, name: s.frag.name, flipped: s.flipped })),
      junctions,
    });
  };

  /**
   * Candidate first steps.
   *
   * A circle has no beginning, so every rotation of an arrangement is the same
   * molecule; pinning one fragment as the start removes n-fold duplication.
   * Neither does it have a reading direction, so requiring that first fragment
   * to be unflipped removes the mirror image too. Both were previously explored
   * in full and then discarded at the end by canonical comparison -- correct,
   * but it meant eight fragments cost forty thousand canonicalisations.
   *
   * Nothing is lost: an arrangement needing the pinned fragment reversed is the
   * reverse complement of one that does not, and that is the same construct.
   */
  const starts = topology === 'circular'
    ? options.filter(o => o.frag.id === fragments[0].id && !o.flipped)
    : options.filter(o => !o.flipped);

  const walk = () => {
    if (found.length >= limit || truncated) return;
    if (++steps > maxSteps) { truncated = true; return; }
    if (path.length === fragments.length) {
      if (topology === 'linear') { record(); return; }
      // Circular: the last must also close onto the first.
      if (joins(path[path.length - 1], path[0]).ok) record();
      return;
    }
    for (const step of (path.length === 0 ? starts : options)) {
      if (used.has(step.frag.id)) continue;
      if (path.length > 0 && !joins(path[path.length - 1], step).ok) continue;
      path.push(step); used.add(step.frag.id);
      walk();
      path.pop(); used.delete(step.frag.id);
      if (found.length >= limit || truncated) return;
    }
  };

  walk();

  // ── Diagnostics ──────────────────────────────────────────────────────────
  if (mode === 'overhang') {
    const ends = fragments.flatMap(f => [f.left, f.right]).filter(e => e.type !== 'blunt' && e.overhang);
    for (const e of ends) {
      if (revComp(e.overhang) === e.overhang) {
        problems.push({
          kind: 'palindromic-overhang',
          message: `The overhang ${e.overhang} is its own reverse complement, so it will ligate to itself and to any copy of the same end.`,
        });
        break;
      }
    }
    const counts = new Map<string, number>();
    for (const f of fragments) {
      for (const e of [f.left, f.right]) {
        if (e.type === 'blunt' || !e.overhang) continue;
        counts.set(e.overhang, (counts.get(e.overhang) ?? 0) + 1);
      }
    }
    for (const [oh, n] of counts) {
      if (n > 1) {
        problems.push({
          kind: 'ambiguous-end',
          message: `The overhang ${oh} appears on ${n} ends. Fragments can swap places wherever it occurs.`,
        });
      }
    }
  }

  for (const f of fragments) {
    const canStart = options.some(o => o.frag.id !== f.id && joins(o, { frag: f, flipped: false }).ok);
    const canEnd = options.some(o => o.frag.id !== f.id && joins({ frag: f, flipped: false }, o).ok);
    const flipped = flip(f);
    const canStartR = options.some(o => o.frag.id !== f.id && joins(o, { frag: flipped, flipped: true }).ok);
    const canEndR = options.some(o => o.frag.id !== f.id && joins({ frag: flipped, flipped: true }, o).ok);
    if (fragments.length > 1 && !canStart && !canEnd && !canStartR && !canEndR) {
      problems.push({
        kind: 'orphan-fragment',
        message: `${f.name} does not join anything else. Check its ends, or its orientation.`,
      });
    }
  }

  if (truncated) {
    problems.push({
      kind: 'search-truncated',
      message: found.length > 0
        ? 'Too many arrangements to enumerate; the ones shown are real but the list may be incomplete. Ends that repeat are usually the cause.'
        : 'Too many arrangements to enumerate before finding a complete one. Check for ends that repeat across fragments.',
    });
  }

  if (found.length === 0) {
    problems.push({
      kind: 'no-assembly',
      message: mode === 'overlap'
        ? `No arrangement joins all ${fragments.length} fragments with ${minOverlap}–${maxOverlap} bp of homology.`
        : `No arrangement joins all ${fragments.length} fragments through compatible ends.`,
    });
  } else if (found.length > 1) {
    problems.push({
      kind: 'multiple-assemblies',
      message: `${found.length} different constructs satisfy these fragments. The reaction cannot tell them apart, and neither will the colonies.`,
    });
  }

  return { assemblies: found, problems, steps };
}
