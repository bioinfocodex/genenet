import { revComp } from './alignment';

/**
 * Gateway recombinational cloning.
 *
 * Not ligation: site-specific recombination. Two molecules each carrying a
 * matched pair of att sites exchange the segment between them, and the defining
 * property is that no nucleotide is gained or lost. That is what makes it worth
 * modelling exactly rather than approximately.
 *
 * The att sites themselves are not tabulated here, and that is deliberate. A
 * recombined site is a hybrid -- attL is the left arm of attP joined to the
 * right arm of attB across their shared core -- so the product's sites are
 * built out of the user's own sequences. Carrying a table of full-length attP,
 * attL and attR would add nothing the inputs do not already contain, and the
 * published sequences disagree between sources on a few positions, which is not
 * a disagreement worth baking into somebody's construct.
 *
 * What is needed is the core: the conserved stretch that marks where crossover
 * happens and which sites may react. att1 and att2 cores differ at a single
 * base, and that one position is the whole of Gateway's directionality --
 * attB1 recombines with attP1 and never with attP2.
 */

export type AttFamily = 1 | 2;

/**
 * The conserved core of each att family.
 *
 * Verified by checking that attB1, attP1, attL1 and attR1 all contain the att1
 * core, that the att2 sites all contain the att2 core on one strand or the
 * other, and that the two cores differ at exactly one position.
 */
export const ATT_CORES: Record<AttFamily, string> = {
  1: 'TTTGTACAAAAAAG',
  2: 'TTTGTACAAGAAAG',
};

export interface AttMatch {
  family: AttFamily;
  /** Where the core starts on the top strand. */
  start: number;
  strand: 1 | -1;
  /**
   * Top-strand position where the strands are cut and rejoined: the end of the
   * core read in its own direction.
   */
  crossover: number;
}

/** Every att core in a sequence, on either strand. */
export function findAttSites(sequence: string, circular = false): AttMatch[] {
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const subject = circular ? seq + seq.slice(0, 20) : seq;
  const out: AttMatch[] = [];

  for (const family of [1, 2] as AttFamily[]) {
    const core = ATT_CORES[family];
    for (const [strand, pattern] of [[1, core], [-1, revComp(core)]] as [1 | -1, string][]) {
      let i = subject.indexOf(pattern);
      while (i !== -1) {
        if (i < seq.length) {
          out.push({
            family,
            start: i,
            strand,
            // Crossover sits at the far end of the core as the site reads it.
            crossover: (strand === 1 ? i + core.length : i) % seq.length,
          });
        }
        i = subject.indexOf(pattern, i + 1);
      }
    }
  }
  return out.sort((a, b) => a.crossover - b.crossover);
}

export interface GatewayMolecule {
  name: string;
  sequence: string;
  circular?: boolean;
}

export interface GatewayProduct {
  name: string;
  sequence: string;
  circular: boolean;
  /** What the recombined sites became, e.g. attL1 and attL2. */
  sites: string;
}

export interface GatewayResult {
  reaction: 'BP' | 'LR';
  /** The clone you wanted. */
  product: GatewayProduct | null;
  /** The other half of the exchange, which selection is meant to remove. */
  byproduct: GatewayProduct | null;
  problems: string[];
}

/** The segment of a molecule running from one crossover to the other. */
function between(seq: string, from: number, to: number, circular: boolean): string {
  if (from <= to) return seq.slice(from, to);
  // Wraps the origin, which only a circular molecule may do.
  return circular ? seq.slice(from) + seq.slice(0, to) : '';
}

/**
 * Replace what lies between the crossovers with something else.
 *
 * Written as a splice rather than as "the outside, then the inside", because
 * order is only irrelevant on a circle. A linear product keeps its two ends
 * where they were and takes the new segment between them; joining the ends to
 * each other and appending the insert afterwards gives a molecule of the right
 * length with both junctions in the wrong place.
 */
function spliceBetween(
  seq: string, from: number, to: number, insert: string, circular: boolean,
): string {
  if (from <= to) return seq.slice(0, from) + insert + seq.slice(to);
  // The replaced span crosses the origin, so what survives is one contiguous
  // run from `to` to `from`.
  return seq.slice(to, from) + insert;
}

/**
 * Run a BP or an LR reaction.
 *
 * `first` carries attB (BP) or attL (LR); `second` carries attP (BP) or attR
 * (LR). Which is which is taken from the caller rather than guessed from the
 * sequence: the arms that distinguish attP from attR are long and vendor
 * specific, while the roles are something the person setting up the reaction
 * already knows.
 */
export function gatewayReaction(
  first: GatewayMolecule,
  second: GatewayMolecule,
  reaction: 'BP' | 'LR',
): GatewayResult {
  const problems: string[] = [];
  const a = first.sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const b = second.sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const aCirc = first.circular ?? false;
  const bCirc = second.circular ?? true;

  const inName = reaction === 'BP' ? 'attB' : 'attL';
  const vecName = reaction === 'BP' ? 'attP' : 'attR';
  const outName = reaction === 'BP' ? 'attL' : 'attB';
  const byName = reaction === 'BP' ? 'attR' : 'attP';

  const pick = (seq: string, circ: boolean, label: string, siteLabel: string) => {
    const found = findAttSites(seq, circ);
    const one = found.filter(s => s.family === 1);
    const two = found.filter(s => s.family === 2);
    if (one.length === 0) problems.push(`${label} has no ${siteLabel}1 site.`);
    if (two.length === 0) problems.push(`${label} has no ${siteLabel}2 site.`);
    if (one.length > 1) problems.push(`${label} has ${one.length} ${siteLabel}1 sites; recombination would not be directional.`);
    if (two.length > 1) problems.push(`${label} has ${two.length} ${siteLabel}2 sites; recombination would not be directional.`);
    return { one: one[0], two: two[0] };
  };

  const A = pick(a, aCirc, first.name, inName);
  const B = pick(b, bCirc, second.name, vecName);

  if (problems.length > 0 || !A.one || !A.two || !B.one || !B.two) {
    return { reaction, product: null, byproduct: null, problems };
  }

  // The exchange: each molecule keeps its own outside and takes the other's
  // inside. Every base is accounted for, which is the point of the reaction.
  const aInside = between(a, A.one.crossover, A.two.crossover, aCirc);
  const bInside = between(b, B.one.crossover, B.two.crossover, bCirc);

  if (!aInside || !bInside) {
    problems.push('The att sites do not enclose a segment that could be exchanged. Check their order and orientation.');
    return { reaction, product: null, byproduct: null, problems };
  }

  // The exchange: each molecule keeps its own flanks and takes the other's
  // middle. Every base is accounted for, which is the point of the reaction.
  const product: GatewayProduct = {
    name: `${first.name} × ${second.name}`,
    sequence: spliceBetween(b, B.one.crossover, B.two.crossover, aInside, bCirc),
    circular: true,
    sites: `${outName}1 / ${outName}2`,
  };

  const byproduct: GatewayProduct = {
    name: `${second.name} cassette on ${first.name} ends`,
    sequence: spliceBetween(a, A.one.crossover, A.two.crossover, bInside, aCirc),
    circular: aCirc,
    sites: `${byName}1 / ${byName}2`,
  };

  // Recombination gains and loses nothing. If the bases do not balance, an att
  // site sat somewhere the model did not expect, and the products are not to
  // be trusted.
  if (product.sequence.length + byproduct.sequence.length !== a.length + b.length) {
    problems.push(
      'The products do not account for every base of the inputs, which a recombination must. ' +
      'This usually means an att site sits in an unexpected orientation.',
    );
  }

  return { reaction, product, byproduct, problems };
}
