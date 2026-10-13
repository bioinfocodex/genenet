import { revComp } from './alignment';
import { nnTm } from './tm';
import { pickAnnealing } from './primer-design';
import { findBindings } from './primer-binding';
import { CODON_TABLE } from './molbuilder-logic';
import { SYNONYMS, HOSTS } from './codon-usage';
import { readingOrder, type CodingFeature } from './point-mutation';

/**
 * Primers for site-directed mutagenesis.
 *
 * Two kits cover nearly all of it, and they want differently shaped primers:
 *
 *  - Q5 Site-Directed Mutagenesis (NEB). Two primers facing away from each
 *    other, 5' ends touching at the site, amplify the whole plasmid
 *    exponentially; the linear product is then phosphorylated and ligated
 *    back into a circle. The change rides on the primers: a substitution in the
 *    middle of the forward primer, an insertion on the 5' ends, a deletion as
 *    the bases the two primers leave out between them. This is what NEB's own
 *    designer produces, and it handles insertions and deletions of almost any
 *    size because nothing has to anneal across them.
 *
 *  - QuikChange (Agilent). Two fully complementary primers carrying the
 *    change in their middle copy the whole plasmid linearly; the methylated
 *    template is then digested with DpnI. Agilent's rules are 25-45 bases and a
 *    Tm of at least 78 °C by their own formula, which is used here as written
 *    because it is the number their protocol is calibrated against.
 *
 * A mutation is a replacement: the bases from `start` to `end` (1-indexed,
 * inclusive) become `replacement`. A deletion replaces with nothing; an
 * insertion replaces nothing, written as end = start - 1, so it goes in front
 * of base `start`.
 */

export interface Mutation {
  start: number;
  end: number;
  replacement: string;
}

export type MutationKind = 'substitution' | 'insertion' | 'deletion';

export interface MutagenicPrimer {
  name: string;
  /** 5'->3', as ordered. */
  sequence: string;
  /** Where the changed bases sit in the oligo, 0-based half-open; empty for a deletion. */
  changed: [number, number];
  /** The 3' stretch that matches the template on the first cycle. */
  anneals: string;
  /** Tm of `anneals`, °C, in the standard PCR buffer. */
  tm: number;
  warnings: string[];
}

export interface MutagenesisDesign {
  method: 'q5' | 'quikchange';
  kind: MutationKind;
  forward: MutagenicPrimer;
  reverse: MutagenicPrimer;
  /** The plasmid after the change, top strand. */
  mutant: string;
  /** Suggested annealing temperature, °C. */
  annealingTemp: number;
  notes: string[];
  warnings: string[];
}

export const MAX_OLIGO = 60;
/** NEB puts insertions of up to this many bases on one primer, longer ones split across both. */
export const SINGLE_PRIMER_INSERT = 6;

const clean = (s: string) => s.toUpperCase().replace(/U/g, 'T').replace(/[^ACGT]/g, '');

export function kindOf(m: Mutation): MutationKind {
  const removed = m.end - m.start + 1;
  if (removed <= 0) return 'insertion';
  return m.replacement.length === 0 ? 'deletion' : 'substitution';
}

/** What is wrong with a mutation on this template, or null. */
export function validateMutation(template: string, m: Mutation): string | null {
  const n = template.length;
  const r = m.replacement;
  if (/[^ACGTacgt]/.test(r)) return 'The new bases must be A, C, G or T.';
  if (m.start < 1 || m.start > n + 1) return `Position must be between 1 and ${n}.`;
  if (m.end > n) return `The change runs past the end (${n}).`;
  if (m.end < m.start - 1) return 'The end comes before the start.';
  const kind = kindOf(m);
  if (kind === 'insertion' && !r) return 'Give the bases to insert.';
  if (kind === 'substitution' && template.slice(m.start - 1, m.end).toUpperCase() === r.toUpperCase()) {
    return 'The new bases are the same as the old ones.';
  }
  return null;
}

/** The sequence after the change. */
export function applyMutation(template: string, m: Mutation): string {
  return template.slice(0, m.start - 1) + clean(m.replacement) + template.slice(Math.max(m.end, m.start - 1));
}

/** A slice that wraps on a circle and stops at the ends of a line. */
function slicer(seq: string, circular: boolean) {
  const n = seq.length;
  return (from: number, to: number): string => {
    if (!circular) return seq.slice(Math.max(0, from), Math.max(0, Math.min(n, to)));
    let out = '';
    for (let i = from; i < to; i++) out += seq[((i % n) + n) % n];
    return out;
  };
}

function finish(name: string, sequence: string, changed: [number, number], anneals: string): MutagenicPrimer {
  const warnings: string[] = [];
  if (sequence.length > MAX_OLIGO) {
    warnings.push(`${sequence.length} nt is past the usual ${MAX_OLIGO} nt standard oligo; order it as a long oligo.`);
  }
  const last = anneals.slice(-1);
  if (last !== 'G' && last !== 'C') warnings.push('The 3′ end is not G or C.');
  if (anneals.length < 10) warnings.push(`Only ${anneals.length} bases anneal past the change; at least 10 are needed.`);
  return { name, sequence, changed, anneals, tm: Math.round(nnTm(anneals) * 10) / 10, warnings };
}

// ─── Q5 SDM: back-to-back primers ─────────────────────────────────────────────

export interface Q5Options {
  targetTm?: number;
}

/**
 * Back-to-back primers for NEB's Q5 kit. The template must be circular: the
 * method amplifies around the whole plasmid.
 */
export function q5Primers(template: string, circular: boolean, m: Mutation, opts: Q5Options = {}): MutagenesisDesign {
  const seq = clean(template);
  const problem = validateMutation(seq, m);
  if (problem) throw new Error(problem);
  if (!circular) throw new Error('Q5 site-directed mutagenesis amplifies a whole plasmid; this sequence is linear.');

  const targetTm = opts.targetTm ?? 60;
  const cs = slicer(seq, true);
  const from = m.start - 1;          // 0-based, first base replaced
  const to = Math.max(m.end, from);  // 0-based, first base kept after
  const repl = clean(m.replacement);
  const kind = kindOf(m);
  const notes: string[] = [];

  // What anneals downstream of the change, read from the change outward.
  const downstream = pickAnnealing(cs(to, to + 45), { targetTm, min: 12, max: 40 });

  let fTail = '';   // changed bases on the forward primer's 5' end
  let rTail = '';   // changed bases on the reverse primer's 5' end, top-strand sense
  let flank = 0;    // template-matching bases 5' of the change on the forward primer

  if (kind === 'substitution' && repl.length <= SINGLE_PRIMER_INSERT) {
    // NEB centres a substitution in the forward primer, with matching sequence
    // either side, so the mismatch is held from both directions.
    flank = Math.min(downstream.length, Math.max(0, MAX_OLIGO - repl.length - downstream.length));
    fTail = repl;
  } else if (repl.length <= SINGLE_PRIMER_INSERT) {
    fTail = repl;
  } else {
    // Split a long insertion or replacement across both 5' ends: the halves
    // meet when the product is ligated, and neither oligo gets too long.
    const half = Math.ceil(repl.length / 2);
    rTail = repl.slice(0, half);
    fTail = repl.slice(half);
    notes.push(`The ${repl.length} new bases are split across both primers' 5′ ends and join when the product is ligated.`);
  }

  const fwdSeq = cs(from - flank, from) + fTail + downstream;
  // The reverse primer reads upstream from where the forward primer's 5' end
  // starts, so the two meet back to back.
  const revStart = from - flank;
  const upstream = pickAnnealing(revComp(cs(revStart - 45, revStart)), { targetTm, min: 12, max: 40 });
  const revSeq = revComp(rTail) + upstream;

  const forward = finish('Mut F', fwdSeq, kind === 'deletion' ? [0, 0] : [flank, flank + fTail.length], downstream);
  const reverse = finish('Mut R', revSeq, [0, rTail.length], upstream);

  if (kind === 'deletion') notes.push(`The ${m.end - m.start + 1} deleted bases are the ones the two primers leave out between them.`);
  notes.push('After PCR: kinase, ligase and DpnI (NEB KLD mix) close the product into a circle and remove the template.');

  const mutant = applyMutation(seq, m);
  const warnings = [...forward.warnings.map(w => `Forward: ${w}`), ...reverse.warnings.map(w => `Reverse: ${w}`)];
  const delta = Math.abs(forward.tm - reverse.tm);
  if (delta > 5) warnings.push(`The primers anneal ${delta.toFixed(0)} °C apart.`);

  // Check the design rather than trust it: build what the PCR and ligation make
  // from these two oligos, and compare it with the intended plasmid.
  const minAnneal = Math.min(forward.anneals.length, reverse.anneals.length);
  const made = simulateBackToBack(seq, forward.sequence, reverse.sequence, minAnneal);
  if (made === null) {
    warnings.push('A primer anneals at more than one place on this plasmid; expect extra products.');
  } else if (!sameCircle(made, mutant)) {
    throw new Error('The designed primers do not reproduce the intended change. This is a bug; please report the mutation.');
  }

  return {
    method: 'q5', kind, forward, reverse, mutant,
    // NEB's guidance for Q5 is the lower primer Tm plus 3 °C, capped at 72.
    annealingTemp: Math.min(72, Math.round(Math.min(forward.tm, reverse.tm) + 3)),
    notes, warnings,
  };
}

/**
 * What exponential PCR with two outward-facing primers and a blunt ligation
 * make from a circle: the forward primer, the plasmid from its 3' end round to
 * the reverse primer's, then the reverse primer's complement. Null when either
 * does not anneal exactly once.
 */
export function simulateBackToBack(template: string, forward: string, reverse: string, minAnneal = 12): string | null {
  const seq = clean(template);
  const n = seq.length;
  const f = findBindings(forward, seq, { circular: true, minAnneal }).filter(b => b.strand === 'forward');
  const r = findBindings(reverse, seq, { circular: true, minAnneal }).filter(b => b.strand === 'reverse');
  if (f.length !== 1 || r.length !== 1) return null;

  // Forward extends rightwards from the end of its annealing region; reverse
  // extends leftwards from the start of its own.
  let span = '';
  for (let i = f[0].end + 1; ; i++) {
    const at = i % n;
    if (at === r[0].start) break;
    span += seq[at];
    if (span.length > n) return null;
  }
  return clean(forward) + span + revComp(clean(reverse));
}

export function sameCircle(a: string, b: string): boolean {
  return a.length === b.length && (a + a).includes(b);
}

// ─── QuikChange: complementary primers ────────────────────────────────────────

/**
 * Agilent's QuikChange Tm. Not a thermodynamic model, and not meant to be
 * compared with the other Tm figures here: it is the formula the kit's 78 °C
 * minimum is stated against, so it is the one to check that minimum with.
 *   substitution:     81.5 + 0.41(%GC) − 675/N − %mismatch
 *   insertion/deletion: 81.5 + 0.41(%GC) − 675/N, N excluding the changed bases
 */
export function quikChangeTm(primer: string, changedBases: number, kind: MutationKind): number {
  const s = clean(primer);
  const n = kind === 'insertion' ? s.length - changedBases : s.length;
  const gc = (s.match(/[GC]/g) ?? []).length / s.length * 100;
  const mismatch = kind === 'substitution' ? changedBases / s.length * 100 : 0;
  return Math.round((81.5 + 0.41 * gc - 675 / n - mismatch) * 10) / 10;
}

export function quikChangePrimers(template: string, circular: boolean, m: Mutation): MutagenesisDesign {
  const seq = clean(template);
  const problem = validateMutation(seq, m);
  if (problem) throw new Error(problem);

  const cs = slicer(seq, circular);
  const from = m.start - 1;
  const to = Math.max(m.end, from);
  const repl = clean(m.replacement);
  const kind = kindOf(m);
  const original = seq.slice(from, to);
  // Only bases that actually differ count as mismatches.
  const changed = kind === 'substitution'
    ? [...repl].filter((b, i) => b !== original[i]).length + Math.abs(repl.length - original.length)
    : repl.length;

  const build = (left: number, right: number) => cs(from - left, from) + repl + cs(to, to + right);

  // Grow both arms alternately until long enough and warm enough, as the
  // protocol asks, keeping the change in the middle.
  let left = 10, right = 10;
  let primer = build(left, right);
  while ((primer.length < 25 || quikChangeTm(primer, changed, kind) < 78) && primer.length < 45) {
    if (left <= right) left++; else right++;
    primer = build(left, right);
  }
  // The protocol asks for both ends on a G or C. Reach for one by extending an
  // arm a base or two while there is room.
  for (const side of ['left', 'right'] as const) {
    for (let extra = 0; extra <= 2; extra++) {
      const l = side === 'left' ? left + extra : left;
      const r = side === 'right' ? right + extra : right;
      const p = build(l, r);
      if (p.length > 45) break;
      const end = side === 'left' ? p[0] : p[p.length - 1];
      if (end === 'G' || end === 'C') { left = l; right = r; break; }
    }
  }
  primer = build(left, right);

  const tmQc = quikChangeTm(primer, changed, kind);
  const warnings: string[] = [];
  if (tmQc < 78) warnings.push(`Reaches only ${tmQc} °C by Agilent's formula at 45 nt; the kit asks for 78 °C or more.`);
  if (primer.length > 45) warnings.push(`${primer.length} nt is longer than the 45 the protocol recommends.`);
  // For a deletion the size is what goes, not what is added (nothing).
  const size = kind === 'deletion' ? to - from : repl.length;
  if (kind !== 'substitution' && size > 30) {
    warnings.push(`QuikChange is unreliable for ${kind}s this long; the Q5 method handles them better.`);
  }
  if (!/^[GC]/.test(primer) || !/[GC]$/.test(primer)) warnings.push('Could not end both primers on G or C within the length limit.');

  const changedRange: [number, number] = [left, left + repl.length];
  const forward: MutagenicPrimer = {
    name: 'QC F', sequence: primer, changed: changedRange, anneals: cs(to, to + right),
    tm: tmQc, warnings: [],
  };
  const rc = revComp(primer);
  const reverse: MutagenicPrimer = {
    name: 'QC R', sequence: rc, changed: [primer.length - changedRange[1], primer.length - changedRange[0]],
    anneals: revComp(cs(from - left, from)), tm: tmQc, warnings: [],
  };

  return {
    method: 'quikchange', kind, forward, reverse,
    mutant: applyMutation(seq, m),
    // Agilent's cycling uses 55 °C annealing for every primer pair.
    annealingTemp: 55,
    notes: [
      `Tm shown is Agilent's QuikChange formula (${tmQc} °C), not the nearest-neighbour Tm used elsewhere.`,
      'The two primers are exact complements. After cycling, DpnI removes the methylated template.',
    ],
    warnings,
  };
}

// ─── Amino-acid changes ───────────────────────────────────────────────────────

export interface CodonSwap {
  mutation: Mutation;
  originalCodon: string;
  newCodon: string;
  originalAA: string;
  /** e.g. K45A */
  notation: string;
}

/**
 * Turn "residue 45 of this CDS to alanine" into a base change. Of the codons
 * for the new residue, the one needing the fewest base changes is used --
 * fewer mismatches anneal better -- and among equals the one E. coli uses
 * most, which is rarely a bad choice and often the host the plasmid is grown
 * in.
 */
export function codonSwap(sequence: string, cds: CodingFeature, residue: number, targetAA: string): CodonSwap {
  const order = readingOrder(cds);
  const codonCount = Math.floor(order.length / 3);
  if (residue < 1 || residue > codonCount) throw new Error(`${cds.name} has ${codonCount} codons.`);
  const aa = targetAA.toUpperCase();
  const family = aa === '*' ? ['TAA', 'TAG', 'TGA'] : SYNONYMS[aa];
  if (!family?.length) throw new Error(`"${targetAA}" is not an amino acid.`);

  const positions = order.slice((residue - 1) * 3, residue * 3);
  const seq = sequence.toUpperCase();
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  const onStrand = (b: string) => (cds.strand === 1 ? b : comp[b] ?? 'N');
  const originalCodon = positions.map(p => onStrand(seq[p - 1])).join('');
  const originalAA = CODON_TABLE[originalCodon] ?? 'X';
  if (originalAA === aa) throw new Error(`Residue ${residue} is already ${aa}.`);

  const usage = HOSTS.ecoli?.freq ?? {};
  const diff = (c: string) => [...c].filter((b, i) => b !== originalCodon[i]).length;
  const newCodon = [...family].sort((a, b) => diff(a) - diff(b) || (usage[b] ?? 0) - (usage[a] ?? 0))[0];

  // Back onto the top strand, as one contiguous replacement.
  const sorted = [...positions].sort((a, b) => a - b);
  if (sorted[2] - sorted[0] !== 2) {
    throw new Error(`Codon ${residue} is split across an exon junction; change its bases one at a time.`);
  }
  const topNew = cds.strand === 1 ? newCodon : revComp(newCodon);
  return {
    mutation: { start: sorted[0], end: sorted[2], replacement: topNew },
    originalCodon,
    newCodon,
    originalAA,
    notation: `${originalAA}${residue}${aa}`,
  };
}
