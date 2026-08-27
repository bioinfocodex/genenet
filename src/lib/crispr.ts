/**
 * CRISPR guide design.
 *
 * Two numbers matter when choosing a guide: whether it will cut where you want,
 * and whether it will cut anywhere else. They are different questions and this
 * answers them separately rather than collapsing them into one figure of merit.
 *
 * On-target scoring here is a transparent set of published rules with each
 * contribution shown, not Doench Rule Set 2. Rule Set 2 is a gradient-boosted
 * model whose value comes from thousands of fitted parameters; shipping a
 * hand-rolled approximation of it and calling it the same thing would be worse
 * than useless, because the number would look authoritative and not be. What is
 * here is auditable: every penalty says why it applied.
 *
 * Off-target scoring is the MIT/Hsu formulation (Hsu et al., Nat Biotechnol
 * 2013), which is a published position-weight vector and a defined aggregate --
 * small enough to implement exactly rather than approximate.
 *
 * The search space is whatever sequences the workspace holds. That is honest
 * for plasmid and construct work; it is not a genome-wide off-target search,
 * and the result says so rather than implying a specificity it did not check.
 */

export type Nuclease = 'SpCas9' | 'SaCas9' | 'Cas12a';

export interface NucleaseSpec {
  name: Nuclease;
  /** IUPAC PAM, e.g. NGG. */
  pam: string;
  /** Where the PAM sits relative to the protospacer. */
  pamSide: "3'" | "5'";
  /** Protospacer length in bases. */
  guideLength: number;
  /**
   * Blunt or staggered cut, as an offset from the PAM-proximal end of the
   * protospacer. SpCas9 cuts 3 bp from the PAM.
   */
  cutOffset: number;
}

export const NUCLEASES: Record<Nuclease, NucleaseSpec> = {
  SpCas9: { name: 'SpCas9', pam: 'NGG',   pamSide: "3'", guideLength: 20, cutOffset: 3 },
  SaCas9: { name: 'SaCas9', pam: 'NNGRRT', pamSide: "3'", guideLength: 21, cutOffset: 3 },
  Cas12a: { name: 'Cas12a', pam: 'TTTV',  pamSide: "5'", guideLength: 23, cutOffset: 18 },
};

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'GC', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

function matchesIUPAC(seq: string, pattern: string): boolean {
  if (seq.length !== pattern.length) return false;
  for (let i = 0; i < seq.length; i++) {
    const allowed = IUPAC[pattern[i]];
    if (!allowed || !allowed.includes(seq[i])) return false;
  }
  return true;
}

const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
function revComp(s: string): string {
  return s.split('').reverse().map(c => COMP[c] ?? 'N').join('');
}

// ─── On-target ───────────────────────────────────────────────────────────────

export interface ScoreReason {
  rule: string;
  /** Negative numbers reduce the score. */
  delta: number;
  detail: string;
}

export interface OnTarget {
  /** 0 to 100. Higher is a better bet, not a probability. */
  score: number;
  reasons: ScoreReason[];
  gc: number;
}

/**
 * Rules with a published basis, each applied visibly.
 *
 * Sources: Doench et al. 2014 for the composition preferences, and the
 * long-standing Pol III termination constraint -- a run of four Ts ends
 * transcription of the guide RNA, so a guide containing one is not a weak
 * guide, it is frequently no guide at all.
 */
export function scoreOnTarget(protospacer: string): OnTarget {
  const g = protospacer.toUpperCase();
  const reasons: ScoreReason[] = [];
  let score = 100;

  const gcCount = (g.match(/[GC]/g) ?? []).length;
  const gc = g.length ? gcCount / g.length : 0;

  const penalise = (rule: string, delta: number, detail: string) => {
    reasons.push({ rule, delta, detail });
    score += delta;
  };

  if (/T{4,}/.test(g)) {
    penalise('Pol III terminator', -60,
      'Contains TTTT, which terminates transcription of the guide RNA from a U6 promoter.');
  }

  if (gc < 0.3) penalise('GC content', -25, `${Math.round(gc * 100)}% GC is low; expect weak binding.`);
  else if (gc < 0.4) penalise('GC content', -10, `${Math.round(gc * 100)}% GC is below the preferred 40-70%.`);
  else if (gc > 0.8) penalise('GC content', -25, `${Math.round(gc * 100)}% GC is high; expect off-target tolerance.`);
  else if (gc > 0.7) penalise('GC content', -10, `${Math.round(gc * 100)}% GC is above the preferred 40-70%.`);

  // Doench 2014: a G immediately 5' of the PAM helps; a C there hurts.
  const last = g[g.length - 1];
  if (last === 'G') penalise('PAM-proximal base', +5, 'G next to the PAM is favourable.');
  else if (last === 'C') penalise('PAM-proximal base', -10, 'C next to the PAM is unfavourable.');

  if (/(.)\1{4,}/.test(g)) {
    const run = g.match(/(.)\1{4,}/)![0];
    penalise('Homopolymer', -15, `A run of ${run.length} ${run[0]}s makes synthesis and specificity worse.`);
  }

  // A guide that folds back on itself competes with binding its target.
  const selfComp = longestSelfComplement(g);
  if (selfComp >= 7) penalise('Self-complementarity', -15, `${selfComp} bases can pair with the guide's own reverse complement.`);
  else if (selfComp >= 5) penalise('Self-complementarity', -5, `${selfComp} bases of internal self-pairing.`);

  return { score: Math.max(0, Math.min(100, score)), reasons, gc };
}

/** Longest stretch that can pair with the sequence's own reverse complement. */
function longestSelfComplement(s: string): number {
  const rc = revComp(s);
  let best = 0;
  for (let len = Math.min(12, s.length); len >= 4; len--) {
    for (let i = 0; i + len <= s.length; i++) {
      if (rc.includes(s.slice(i, i + len))) return len;
    }
  }
  return best;
}

// ─── Off-target ──────────────────────────────────────────────────────────────

/**
 * Position weights from Hsu et al., Nat Biotechnol 2013, indexed from the
 * PAM-distal end. A mismatch near the PAM costs far more than one at the far
 * end, which is why the tail of this vector is so much larger than its head.
 */
const HSU_WEIGHTS = [
  0, 0, 0.014, 0, 0, 0.395, 0.317, 0, 0.389, 0.079,
  0.445, 0.508, 0.613, 0.851, 0.732, 0.828, 0.615, 0.804, 0.685, 0.583,
];

export interface OffTarget {
  /** Where it was found. */
  sequenceName: string;
  position: number;
  strand: '+' | '-';
  protospacer: string;
  pam: string;
  mismatches: number;
  /** 0-based positions within the protospacer that differ. */
  mismatchPositions: number[];
  /** Hsu 2013 single-hit score, 0 to 1. Higher means more likely to be cut. */
  score: number;
}

/** Hsu 2013 single-hit score for one candidate off-target. */
export function hsuScore(mismatchPositions: number[], guideLength = 20): number {
  if (mismatchPositions.length === 0) return 1;

  // Term 1: the product over mismatched positions of (1 - weight).
  let product = 1;
  for (const p of mismatchPositions) {
    // Weights are defined for a 20mer; scale other lengths onto that.
    const idx = guideLength === 20 ? p : Math.round((p / (guideLength - 1)) * 19);
    product *= 1 - (HSU_WEIGHTS[Math.max(0, Math.min(19, idx))] ?? 0);
  }

  // Term 2: mismatches spread apart are tolerated better than clustered ones.
  const n = mismatchPositions.length;
  let meanDistance = 19;
  if (n > 1) {
    const sorted = [...mismatchPositions].sort((a, b) => a - b);
    meanDistance = (sorted[sorted.length - 1] - sorted[0]) / (n - 1);
  }
  const spread = 1 / (((19 - meanDistance) / 19) * 4 + 1);

  // Term 3: more mismatches, sharply less cutting.
  const count = 1 / (n * n);

  return product * spread * count;
}

/**
 * Aggregate specificity, Hsu 2013: 100 divided by 100 plus the summed
 * single-hit scores of everything else the guide could cut.
 */
export function specificityScore(offTargets: OffTarget[]): number {
  const sum = offTargets.reduce((t, o) => t + o.score, 0);
  return 100 / (100 + sum * 100);
}

// ─── Finding guides ──────────────────────────────────────────────────────────

export interface Guide {
  protospacer: string;
  pam: string;
  /** 0-based start of the protospacer on the given sequence. */
  start: number;
  end: number;
  strand: '+' | '-';
  /** 0-based position the nuclease cuts, on the forward strand. */
  cutSite: number;
  onTarget: OnTarget;
  offTargets: OffTarget[];
  /** 0 to 1; 1 means nothing else in the searched sequences resembles it. */
  specificity: number;
}

export interface FindGuidesOptions {
  nuclease?: Nuclease;
  /** Restrict to guides cutting inside this 0-based half-open window. */
  region?: { start: number; end: number };
  /** Where to look for off-targets. Defaults to the target sequence alone. */
  searchSpace?: { name: string; sequence: string }[];
  /** Report off-targets up to this many mismatches. */
  maxMismatches?: number;
  /** Cap the returned guides, best first. */
  limit?: number;
}

/** Every position where the PAM matches, with its protospacer. */
function scanStrand(
  seq: string, spec: NucleaseSpec, strand: '+' | '-', originalLength: number,
): { protospacer: string; pam: string; start: number }[] {
  const out: { protospacer: string; pam: string; start: number }[] = [];
  const { pam, guideLength: L, pamSide } = spec;

  for (let i = 0; i + pam.length <= seq.length; i++) {
    const candidate = seq.slice(i, i + pam.length);
    if (!matchesIUPAC(candidate, pam)) continue;

    let protoStart: number;
    if (pamSide === "3'") protoStart = i - L;
    else protoStart = i + pam.length;

    if (protoStart < 0 || protoStart + L > seq.length) continue;
    const protospacer = seq.slice(protoStart, protoStart + L);
    if (/[^ACGT]/.test(protospacer)) continue;

    // Coordinates are always reported against the forward strand.
    const start = strand === '+' ? protoStart : originalLength - (protoStart + L);
    out.push({ protospacer, pam: candidate, start });
  }
  return out;
}

export function findGuides(sequence: string, opts: FindGuidesOptions = {}): Guide[] {
  const spec = NUCLEASES[opts.nuclease ?? 'SpCas9'];
  const seq = sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const maxMismatches = opts.maxMismatches ?? 3;
  const searchSpace = opts.searchSpace ?? [{ name: 'this sequence', sequence: seq }];

  const forward = scanStrand(seq, spec, '+', seq.length)
    .map(g => ({ ...g, strand: '+' as const }));
  const reverse = scanStrand(revComp(seq), spec, '-', seq.length)
    .map(g => ({ ...g, strand: '-' as const }));

  const guides: Guide[] = [];

  for (const g of [...forward, ...reverse]) {
    const L = spec.guideLength;
    const end = g.start + L;

    // Cut site, always on forward-strand coordinates.
    const cutSite = spec.pamSide === "3'"
      ? (g.strand === '+' ? end - spec.cutOffset : g.start + spec.cutOffset)
      : (g.strand === '+' ? g.start + spec.cutOffset : end - spec.cutOffset);

    if (opts.region && (cutSite < opts.region.start || cutSite >= opts.region.end)) continue;

    const offTargets = findOffTargets(g.protospacer, spec, searchSpace, maxMismatches)
      // The intended site is not an off-target.
      .filter(o => !(o.mismatches === 0 && o.position === g.start && o.strand === g.strand));

    guides.push({
      protospacer: g.protospacer,
      pam: g.pam,
      start: g.start,
      end,
      strand: g.strand,
      cutSite,
      onTarget: scoreOnTarget(g.protospacer),
      offTargets,
      specificity: specificityScore(offTargets),
    });
  }

  guides.sort((a, b) =>
    (b.specificity * b.onTarget.score) - (a.specificity * a.onTarget.score));

  return opts.limit ? guides.slice(0, opts.limit) : guides;
}

/** Every PAM-adjacent site resembling this protospacer, within a mismatch budget. */
export function findOffTargets(
  protospacer: string,
  spec: NucleaseSpec,
  searchSpace: { name: string; sequence: string }[],
  maxMismatches: number,
): OffTarget[] {
  const out: OffTarget[] = [];
  const L = spec.guideLength;

  for (const entry of searchSpace) {
    const seq = entry.sequence.toUpperCase().replace(/[^ACGTN]/g, '');
    for (const strand of ['+', '-'] as const) {
      const s = strand === '+' ? seq : revComp(seq);
      for (const site of scanStrand(s, spec, strand, seq.length)) {
        const mismatchPositions: number[] = [];
        for (let k = 0; k < L; k++) {
          if (site.protospacer[k] !== protospacer[k]) {
            mismatchPositions.push(k);
            if (mismatchPositions.length > maxMismatches) break;
          }
        }
        if (mismatchPositions.length > maxMismatches) continue;

        out.push({
          sequenceName: entry.name,
          position: site.start,
          strand,
          protospacer: site.protospacer,
          pam: site.pam,
          mismatches: mismatchPositions.length,
          mismatchPositions,
          score: hsuScore(mismatchPositions, L),
        });
      }
    }
  }

  return out.sort((a, b) => b.score - a.score);
}
