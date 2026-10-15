import { revComp } from './alignment';
import { findBindings, type PrimerBinding } from './primer-binding';
import { nnTm } from './tm';

/**
 * What a pair of primers would actually amplify.
 *
 * The old simulation searched the template for each primer in full, took the
 * first hit, and returned one product. Each of those is a way of being wrong
 * about a real reaction:
 *
 *   A full-length search finds nothing for a primer with a 5' tail -- which is
 *   every primer this application designs, for every cloning method it offers.
 *   A primer binds by its 3' end, and that is what has to match.
 *
 *   The first hit is not the only hit. A primer annealing twice is the reason
 *   a gel shows two bands, and reporting one of them hides the finding.
 *
 *   One product per pair assumes the pair is well behaved. The question worth
 *   answering is the opposite one: what else comes out of this tube.
 *
 * So every site of both primers is found, by 3' end, with mismatches allowed
 * where asked; every forward site is paired with every reverse site that lies
 * downstream of it; and all of the products are returned, the intended one
 * among them rather than instead of them.
 */

export interface PcrOptions {
  circular?: boolean;
  /** Shortest 3' match counted as annealing. */
  minAnneal?: number;
  /** Mismatches tolerated outside the 3' end. Off by default. */
  maxMismatches?: number;
  /** Longest product worth reporting; a polymerase gives up well before this. */
  maxProduct?: number;
}

export interface PcrProduct {
  /** The amplicon, tails included, 5'->3' on the top strand. */
  sequence: string;
  size: number;
  /** 1-based inclusive span of the template the product covers. */
  start: number;
  end: number;
  /** True when the product runs through the origin of a circular template. */
  wrapsOrigin: boolean;
  forward: PrimerSite;
  reverse: PrimerSite;
  /** True when both primers match their sites in full, tails and all. */
  exact: boolean;
  /**
   * Mismatched bases inside the two annealing regions.
   *
   * Not the same question as `exact`, which a 5' tail makes false on every
   * primer this application designs. A tail is intended and anneals perfectly
   * from the first cycle on; a mismatch inside the annealing region is what
   * makes a site amplify grudgingly.
   */
  mismatches: number;
}

export interface PrimerSite {
  /** Which of the two primers this site belongs to. */
  primer: 'forward' | 'reverse';
  name: string;
  binding: PrimerBinding;
  /** Melting temperature of the annealing part alone. */
  tm: number;
}

export interface PcrResult {
  products: PcrProduct[];
  /** Sites found for each primer, however many products they made. */
  sites: PrimerSite[];
  warnings: string[];
  /** Why there is no product, when there is none. */
  problem?: string;
}

const clean = (s: string) => s.toUpperCase().replace(/U/g, 'T').replace(/[^ACGT]/g, '');

function siteFor(primer: string, name: 'forward' | 'reverse', b: PrimerBinding): PrimerSite {
  const anneal = b.strand === 'forward'
    ? primer.slice(primer.length - b.annealLength)
    : primer.slice(primer.length - b.annealLength);
  return {
    primer: name,
    name: name === 'forward' ? 'Forward' : 'Reverse',
    binding: b,
    tm: Math.round(nnTm(anneal) * 10) / 10,
  };
}

/**
 * Every product the two primers can give on this template.
 *
 * Either primer may act in either role: a primer that anneals to both strands
 * amplifies on its own, which is a real and surprising way to get a band, so
 * both are tried in both directions.
 */
export function simulatePcr(
  template: string,
  forwardPrimer: string,
  reversePrimer: string,
  opts: PcrOptions = {},
): PcrResult {
  const { circular = false, minAnneal = 14, maxMismatches = 0, maxProduct = 20_000 } = opts;
  const t = clean(template);
  const fwd = clean(forwardPrimer);
  const rev = clean(reversePrimer);
  const warnings: string[] = [];

  if (!t) return { products: [], sites: [], warnings, problem: 'No template.' };
  if (!fwd || !rev) return { products: [], sites: [], warnings, problem: 'Both primers are needed.' };

  const bindOpts = { circular, minAnneal, maxMismatches };
  const sites: PrimerSite[] = [
    ...findBindings(fwd, t, bindOpts).map(b => siteFor(fwd, 'forward', b)),
    ...findBindings(rev, t, bindOpts).map(b => siteFor(rev, 'reverse', b)),
  ];

  const primerOf = (s: PrimerSite) => (s.primer === 'forward' ? fwd : rev);
  // A primer annealing along the top strand primes rightwards; one annealing
  // to it primes leftwards. A product needs one of each, facing inward.
  const rightward = sites.filter(s => s.binding.strand === 'forward');
  const leftward = sites.filter(s => s.binding.strand === 'reverse');

  if (rightward.length === 0 || leftward.length === 0) {
    const problem = rightward.length === 0 && leftward.length === 0
      ? 'Neither primer anneals to this template.'
      : rightward.length === 0
        ? 'Nothing anneals in the forward direction, so there is nothing to extend rightwards.'
        : 'Nothing anneals in the reverse direction, so there is no primer facing back.';
    return { products: [], sites, warnings, problem };
  }

  const n = t.length;
  const products: PcrProduct[] = [];
  const seen = new Set<string>();

  for (const f of rightward) {
    for (const r of leftward) {
      // The product runs from the forward primer's 5'-most annealing base to
      // the reverse primer's. On a circle it may run through the origin.
      const from = f.binding.start;
      const to = r.binding.end;
      let span = to - from + 1;
      if (span <= 0) {
        if (!circular) continue;
        span += n;
      }
      if (span > maxProduct || span > (circular ? n : n)) continue;

      const wraps = from + span > n;
      /*
       * The primers are in the product, not the template they annealed to.
       *
       * Each primer is extended from its own 3' end, so every base it covers
       * is the base it carried: its 5' tail, and any position where it did not
       * match. Copying the template across the whole span instead silently
       * drops exactly the changes a primer was designed to introduce, which is
       * the mechanism behind every PCR-based mutagenesis there is.
       */
      const middleLen = span - f.binding.annealLength - r.binding.annealLength;
      if (middleLen < 0) continue; // the two sites overlap: no product worth reporting
      const mid = (f.binding.end + 1) % n;
      let middle = '';
      for (let k = 0; k < middleLen; k++) middle += t[(mid + k) % n];
      const sequence = primerOf(f) + middle + revComp(primerOf(r));

      const key = `${from}:${to}:${f.primer}:${r.primer}`;
      if (seen.has(key)) continue;
      seen.add(key);

      products.push({
        sequence,
        size: sequence.length,
        start: from + 1,
        end: to + 1,
        wrapsOrigin: wraps,
        forward: f,
        reverse: r,
        exact: f.binding.exact && r.binding.exact,
        mismatches: (f.binding.mismatches?.length ?? 0) + (r.binding.mismatches?.length ?? 0),
      });
    }
  }

  // Cleanly annealing products first, then by size.
  products.sort((a, b) => a.mismatches - b.mismatches || a.size - b.size);

  if (products.length === 0) {
    return {
      products, sites, warnings,
      problem: circular
        ? 'Both primers anneal, but no pair of sites faces inward to give a product.'
        : 'Both primers anneal, but the reverse site lies before the forward one, so they point away from each other.',
    };
  }

  // What is worth saying out loud about the reaction, in the order it matters.
  if (products.length > 1) {
    warnings.push(
      `${products.length} products: ${products.map(p => `${p.size.toLocaleString()} bp`).join(', ')}. `
      + 'A gel will show more than one band.',
    );
  }
  for (const [name, primer, list] of [['Forward', fwd, rightward], ['Reverse', rev, leftward]] as const) {
    const own = list.filter(s => (s.primer === 'forward' ? fwd : rev) === primer);
    if (own.length > 1) warnings.push(`The ${name.toLowerCase()} primer anneals at ${own.length} places.`);
  }
  const imperfect = products.filter(p => p.mismatches > 0);
  if (imperfect.length && products.some(p => p.mismatches === 0)) {
    warnings.push(`${imperfect.length} of the products rest on a primer binding with mismatches, so they will amplify less readily than the clean one.`);
  }
  const delta = Math.abs(products[0].forward.tm - products[0].reverse.tm);
  if (delta > 5) {
    warnings.push(`The two primers anneal ${delta.toFixed(0)} °C apart; the cooler one sets the annealing temperature.`);
  }

  return { products, sites, warnings };
}
