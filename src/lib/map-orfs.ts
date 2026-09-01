/**
 * Choosing which open reading frames belong on a map.
 *
 * Six-frame translation of a plasmid finds reading frames everywhere. Drawing
 * all of them is the enzyme problem again: every bar correct, the picture
 * useless, and the one thing worth seeing lost among ninety that are not.
 *
 * What a map is being asked here is a narrower question than "where are the
 * ORFs". It is "is there coding sequence I have not annotated" — the
 * unlabelled ORF is the one that changes what someone does next, because an
 * ORF lying under a CDS someone already drew tells them what they already
 * know. So annotated ORFs are the ones hidden by default, which is the
 * opposite of what a naive filter would do.
 *
 * The other real question, "is my insert in frame", is answered by the frame
 * number travelling with each ORF rather than by drawing more of them.
 */

export interface OrfLike {
  /** 1, 2, 3, -1, -2, -3 */
  frame: number;
  /** 0-indexed. */
  start: number;
  /** 0-indexed, exclusive — as findORFs reports it. */
  end: number;
  length: number;
  protein: string;
  strand: '+' | '-';
}

export interface FeatureLike {
  name: string;
  type: string;
  /** 1-indexed inclusive, the viewer's convention. */
  start: number;
  end: number;
  strand: number;
}

export interface MapOrf {
  frame: number;
  strand: '+' | '-';
  /** 0-indexed inclusive, so it can be drawn like anything else. */
  start: number;
  end: number;
  /** Nucleotides, stop codon included. */
  length: number;
  /** Residues, stop excluded. */
  aaLength: number;
  /** The annotated feature this ORF sits under, if any. */
  coveredBy: string | null;
  /**
   * An annotated coding feature on the *other* strand covering this ORF.
   *
   * Real coding sequence usually carries stop codons on its reverse strand, so
   * a long frame lying opposite an annotated gene is most often a shadow of it
   * rather than a second gene. Most often is not always — antisense genes
   * exist — so this is said rather than acted on: the ORF is still drawn, and
   * the reader is told what it is lying over.
   */
  oppositeTo: string | null;
}

export interface ChooseOrfOptions {
  /** Shortest ORF worth drawing, in residues. */
  minAa?: number;
  /** Draw ORFs that already have a CDS or gene over them. */
  includeAnnotated?: boolean;
  /** Ceiling, so a sequence full of short frames cannot fill the ring. */
  maxOrfs?: number;
  /** Feature types that count as "this is already annotated coding sequence". */
  codingTypes?: string[];
}

const DEFAULT_CODING = ['CDS', 'gene', 'exon', 'ORF', 'mRNA'];

/**
 * How much of the ORF an annotated feature has to cover to count.
 *
 * Not any overlap: a promoter abutting a gene overlaps its first few bases and
 * has said nothing about whether the coding sequence is annotated. Most of the
 * ORF has to be inside the feature before the ORF is old news.
 */
const COVERED_FRACTION = 0.8;

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1);
}

/**
 * The annotated coding features covering this ORF, on each strand.
 *
 * `same` is the one that makes the ORF old news. `opposite` is the one that
 * makes it likely to be a shadow of a gene on the other strand — different
 * information, so a different field rather than a fudged single answer.
 */
export function coveringFeatures(
  orf: { start: number; end: number; strand: '+' | '-' },
  features: FeatureLike[],
  codingTypes: string[] = DEFAULT_CODING,
): { same: string | null; opposite: string | null } {
  const types = new Set(codingTypes.map(t => t.toLowerCase()));
  const orfLen = orf.end - orf.start + 1;
  const wantStrand = orf.strand === '+' ? 1 : -1;
  let same: string | null = null;
  let opposite: string | null = null;

  for (const f of features) {
    if (!types.has(f.type.toLowerCase())) continue;
    // Features are 1-indexed inclusive; ORFs here are 0-indexed inclusive.
    const covered = overlap(orf.start, orf.end, f.start - 1, f.end - 1);
    if (covered / orfLen < COVERED_FRACTION) continue;
    if (f.strand === wantStrand) same ??= f.name;
    else opposite ??= f.name;
  }
  return { same, opposite };
}

/** The annotated coding feature covering this ORF on its own strand, or null. */
export function coveringFeature(
  orf: { start: number; end: number; strand: '+' | '-' },
  features: FeatureLike[],
  codingTypes: string[] = DEFAULT_CODING,
): string | null {
  return coveringFeatures(orf, features, codingTypes).same;
}

export function chooseMapOrfs(
  orfs: OrfLike[],
  features: FeatureLike[],
  opts: ChooseOrfOptions = {},
): MapOrf[] {
  const {
    minAa = 100,
    includeAnnotated = false,
    maxOrfs = 24,
    codingTypes = DEFAULT_CODING,
  } = opts;

  const mapped: MapOrf[] = orfs.map(o => {
    // findORFs reports `end` exclusive; everything drawn here is inclusive.
    const end = o.end - 1;
    const cover = coveringFeatures({ start: o.start, end, strand: o.strand }, features, codingTypes);
    return {
      frame: o.frame,
      strand: o.strand,
      start: o.start,
      end,
      length: o.length,
      // The stop codon is translated but is not a residue.
      aaLength: o.protein.replace(/\*+$/, '').length,
      coveredBy: cover.same,
      oppositeTo: cover.opposite,
    };
  });

  const kept = mapped.filter(o =>
    o.aaLength >= minAa && (includeAnnotated || o.coveredBy === null));

  // Longest first: if the ceiling bites, the ones dropped should be the ones
  // least likely to be a gene.
  kept.sort((a, b) => b.aaLength - a.aaLength || a.start - b.start);
  return kept.slice(0, maxOrfs);
}

/** Frame colours, so the same frame reads the same everywhere it is drawn. */
const FRAME_COLOURS: Record<number, string> = {
  1: '#0ea5e9', 2: '#14b8a6', 3: '#84cc16',
  [-1]: '#f97316', [-2]: '#ec4899', [-3]: '#a855f7',
};

export function frameColour(frame: number): string {
  return FRAME_COLOURS[frame] ?? '#94a3b8';
}

export function orfTitle(o: MapOrf): string {
  const lines = [
    `Frame ${o.frame > 0 ? '+' : ''}${o.frame} — ${(o.start + 1).toLocaleString()}–${(o.end + 1).toLocaleString()}`,
    `${o.aaLength.toLocaleString()} residues, ${o.length.toLocaleString()} bp`,
  ];
  if (o.coveredBy) lines.push(`Already annotated as ${o.coveredBy}`);
  else if (o.oppositeTo) {
    lines.push(`Nothing annotated on this strand, but it lies opposite ${o.oppositeTo} — most likely a shadow of it`);
  } else {
    lines.push('No coding feature annotated over this');
  }
  return lines.join('\n');
}

export interface OrfSummary {
  drawn: number;
  /** Long enough, but already annotated on their own strand. */
  annotated: number;
  /**
   * Long enough, unannotated, and not lying opposite an annotated gene — the
   * ones actually worth a second look, and so the only ones the badge counts.
   * Counting shadows there would send someone hunting for a gene that is the
   * reverse strand of one they already have.
   */
  unannotated: number;
  /** Unannotated but opposite an annotated gene. */
  shadows: number;
  /** Found by the six-frame scan at all. */
  total: number;
}

export function summariseOrfs(
  orfs: OrfLike[],
  features: FeatureLike[],
  opts: ChooseOrfOptions = {},
): OrfSummary {
  const { minAa = 100, codingTypes = DEFAULT_CODING } = opts;
  const longEnough = orfs.filter(o => o.protein.replace(/\*+$/, '').length >= minAa);
  const covers = longEnough.map(o =>
    coveringFeatures({ start: o.start, end: o.end - 1, strand: o.strand }, features, codingTypes));

  const annotated = covers.filter(c => c.same !== null).length;
  const shadows = covers.filter(c => c.same === null && c.opposite !== null).length;

  return {
    drawn: chooseMapOrfs(orfs, features, opts).length,
    annotated,
    shadows,
    unannotated: longEnough.length - annotated - shadows,
    total: orfs.length,
  };
}
