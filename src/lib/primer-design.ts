import { revComp } from './alignment';
import { nnTm } from './tm';
import { ENZYMES } from './restrictionEnzymes';

/**
 * Primers for the method you picked.
 *
 * Every cloning method here needs the same thing of a PCR product and asks for
 * it differently: Gibson wants homology to the neighbour, Golden Gate wants a
 * Type IIS site and a chosen overhang, Gateway wants an att tail, directional
 * TOPO wants four bases. The part that anneals to the template is the same
 * calculation in all of them; only the tail changes.
 *
 * The tail and the annealing half are always reported separately, because only
 * the annealing half sets the temperature for the first cycles. Quoting the Tm
 * of the whole oligo is how people end up running PCR far too hot and blaming
 * the enzyme.
 */

export interface DesignedPrimer {
  name: string;
  /** The oligo to order, 5'->3'. */
  sequence: string;
  /** Added sequence that does not match the template on the first cycles. */
  tail: string;
  /** The part that binds the template. */
  anneals: string;
  /** Melting temperature of the annealing part, °C. */
  tm: number;
  gc: number;
  warnings: string[];
}

export interface PrimerPair {
  forward: DesignedPrimer;
  reverse: DesignedPrimer;
  /** Difference in annealing Tm, °C. */
  tmDelta: number;
  warnings: string[];
}

export interface AnnealOptions {
  targetTm?: number;
  min?: number;
  max?: number;
}

/**
 * Choose how much of the template to bind.
 *
 * Grown from the 5' end until the melting temperature is reached rather than
 * fixed at twenty bases: a GC-rich target reaches 60 °C in sixteen and an
 * AT-rich one still has not by thirty, and a pair designed by length rather
 * than by temperature anneals unevenly.
 */
export function pickAnnealing(template: string, opts: AnnealOptions = {}): string {
  const { targetTm = 60, min = 16, max = 36 } = opts;
  const seq = template.toUpperCase().replace(/[^ACGTN]/g, '');
  if (seq.length <= min) return seq;

  const cap = Math.min(max, seq.length);
  let firstAtTarget = -1;
  for (let n = min; n <= cap; n++) {
    if (nnTm(seq.slice(0, n)) >= targetTm) { firstAtTarget = n; break; }
  }
  // Nothing reaches the target: take as much as allowed.
  if (firstAtTarget === -1) return seq.slice(0, cap);

  // Prefer an end that is G or C. Extension starts at the 3' base, and a
  // primer ending on an A or a T breathes there. Shifting the end by a base or
  // two costs a degree of Tm and is what a designer would do by hand, so it is
  // done here rather than reported as a flaw for someone else to fix.
  for (let n = firstAtTarget; n <= Math.min(firstAtTarget + 3, cap); n++) {
    const last = seq[n - 1];
    if (last === 'G' || last === 'C') return seq.slice(0, n);
  }
  return seq.slice(0, firstAtTarget);
}

function gcOf(s: string): number {
  return s ? (s.match(/[GC]/g) ?? []).length / s.length : 0;
}

/** Checks worth running on any primer, whatever the method put on its 5' end. */
function inspect(anneals: string): string[] {
  const w: string[] = [];
  const last = anneals.slice(-1);
  if (last !== 'G' && last !== 'C') {
    w.push("The 3′ end is not G or C. A GC clamp there holds the primer down where extension starts.");
  }
  // Five, not four: runs of four are common in real sequence and rarely cause
  // trouble, and a check that fires on most primers is one people stop reading.
  if (/(.)\1{4,}/.test(anneals)) {
    w.push('A run of five or more identical bases can slip during extension.');
  }
  const gc = gcOf(anneals);
  if (gc < 0.35) w.push(`GC is ${Math.round(gc * 100)}%; the primer will bind weakly.`);
  if (gc > 0.7) w.push(`GC is ${Math.round(gc * 100)}%; the primer may bind where it should not.`);
  // Self-complementarity at the 3' end is what makes a primer prime itself.
  const tail3 = anneals.slice(-5);
  if (anneals.includes(revComp(tail3)) && anneals.indexOf(revComp(tail3)) !== anneals.length - 5) {
    w.push('The 3′ end matches elsewhere in the primer, which invites it to fold back on itself.');
  }
  return w;
}

function makePrimer(name: string, tail: string, anneals: string): DesignedPrimer {
  return {
    name,
    sequence: tail + anneals,
    tail,
    anneals,
    tm: nnTm(anneals),
    gc: gcOf(anneals),
    warnings: inspect(anneals),
  };
}

function pair(forward: DesignedPrimer, reverse: DesignedPrimer): PrimerPair {
  const tmDelta = Math.abs(forward.tm - reverse.tm);
  const warnings: string[] = [];
  if (tmDelta > 5) {
    warnings.push(
      `The two primers anneal ${tmDelta.toFixed(0)} °C apart. The cooler one sets the annealing ` +
      `temperature, and the warmer one then binds loosely.`,
    );
  }
  // A 3' end of one matching the other is the classic primer-dimer.
  const f3 = forward.anneals.slice(-6), r3 = reverse.anneals.slice(-6);
  if (revComp(f3) === r3) {
    warnings.push('The two 3′ ends are complementary, which is exactly how primer dimers form.');
  }
  return { forward, reverse, tmDelta, warnings };
}

/** Plain amplification, no tail. */
export function amplify(template: string, name = 'insert', opts: AnnealOptions = {}): PrimerPair {
  const seq = template.toUpperCase().replace(/[^ACGTN]/g, '');
  return pair(
    makePrimer(`${name}-F`, '', pickAnnealing(seq, opts)),
    makePrimer(`${name}-R`, '', pickAnnealing(revComp(seq), opts)),
  );
}

/**
 * Gibson, In-Fusion, NEBuilder.
 *
 * Each fragment is amplified with the neighbour's end carried on the 5' side,
 * so the homology the reaction needs is created by the PCR rather than assumed
 * to be there already.
 */
export function homologyPrimers(
  fragments: { name: string; sequence: string }[],
  overlap = 25,
  opts: AnnealOptions = {},
): PrimerPair[] {
  const n = fragments.length;
  return fragments.map((f, i) => {
    const seq = f.sequence.toUpperCase();
    const prev = fragments[(i - 1 + n) % n].sequence.toUpperCase();
    const next = fragments[(i + 1) % n].sequence.toUpperCase();
    return pair(
      // Forward carries the tail of the fragment before it.
      makePrimer(`${f.name}-F`, prev.slice(-overlap), pickAnnealing(seq, opts)),
      // Reverse carries the start of the fragment after it, reverse-complemented.
      makePrimer(`${f.name}-R`, revComp(next.slice(0, overlap)), pickAnnealing(revComp(seq), opts)),
    );
  });
}

/**
 * Golden Gate.
 *
 * The primer adds the Type IIS site, one spacer base, and the four bases that
 * become the overhang. The site points inward so that cutting removes it and
 * leaves the designed overhang behind -- which is the arrangement that makes
 * the sites end up on the discarded pieces.
 */
export function goldenGatePrimers(
  fragment: { name: string; sequence: string },
  enzymeName: string,
  leftOverhang: string,
  rightOverhang: string,
  opts: AnnealOptions = {},
): PrimerPair {
  const enzyme = ENZYMES[enzymeName];
  if (!enzyme) throw new Error(`Unknown enzyme: ${enzymeName}`);
  if (!enzyme.typeIIS) {
    throw new Error(`${enzymeName} cuts inside its site, so it cannot leave a chosen overhang.`);
  }
  const site = enzyme.pattern;
  const seq = fragment.sequence.toUpperCase();
  const spacer = 'A';

  const f = makePrimer(
    `${fragment.name}-F`,
    site + spacer + leftOverhang.toUpperCase(),
    pickAnnealing(seq, opts),
  );
  const r = makePrimer(
    `${fragment.name}-R`,
    site + spacer + revComp(rightOverhang.toUpperCase()),
    pickAnnealing(revComp(seq), opts),
  );
  const p = pair(f, r);

  // A site already inside the fragment survives the cut and is cut again.
  const internal = (seq.match(new RegExp(site, 'g')) ?? []).length
                 + (seq.match(new RegExp(revComp(site), 'g')) ?? []).length;
  if (internal > 0) {
    p.warnings.push(
      `The fragment contains ${internal} internal ${enzymeName} site(s). They have to be removed ` +
      `by silent mutation before this will assemble -- MoClo calls this domestication.`,
    );
  }
  return p;
}

/** The attB tails, which is all a Gateway BP reaction asks of a PCR product. */
export const ATTB1_TAIL = 'GGGGACAAGTTTGTACAAAAAAGCAGGCT';
export const ATTB2_TAIL = 'GGGGACCACTTTGTACAAGAAAGCTGGGT';

export function gatewayPrimers(
  insert: { name: string; sequence: string },
  opts: AnnealOptions = {},
): PrimerPair {
  const seq = insert.sequence.toUpperCase();
  return pair(
    makePrimer(`${insert.name}-attB1-F`, ATTB1_TAIL, pickAnnealing(seq, opts)),
    makePrimer(`${insert.name}-attB2-R`, ATTB2_TAIL, pickAnnealing(revComp(seq), opts)),
  );
}

/** Directional TOPO wants four bases; plain TA wants nothing but Taq. */
export function topoPrimers(
  insert: { name: string; sequence: string },
  directional: boolean,
  opts: AnnealOptions = {},
): PrimerPair {
  const seq = insert.sequence.toUpperCase();
  const p = pair(
    makePrimer(`${insert.name}-F`, directional ? 'CACC' : '', pickAnnealing(seq, opts)),
    makePrimer(`${insert.name}-R`, '', pickAnnealing(revComp(seq), opts)),
  );
  if (!directional) {
    p.warnings.push(
      'No tail is needed, but the product must come from Taq: a proofreading polymerase leaves no ' +
      '3′ A and will not TA clone.',
    );
  }
  return p;
}
