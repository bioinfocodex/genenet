/**
 * The feature shape the viewer draws, and the reconciliation the store needs.
 *
 * Two different shapes end up in GeneSequence.features, because two different
 * things write it. An import writes what the parser produced: 0-based
 * coordinates, strand as '+' or '-', no id and no colour. The viewer writes
 * what it holds in state: 1-based, strand as 1 or -1, id and colour present.
 *
 * The reading side used to cast the JSON straight to the viewer's type, which
 * is true for one of those two and silently wrong for the other -- every
 * imported feature drew one base off, with no colour, and its strand test
 * never matched because '+' is not 1. Normalising on read fixes both the
 * records already stored and everything imported from here.
 */

/** Coordinates are 1-indexed and inclusive, matching GenBank as printed. */
export interface SequenceFeature {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
  type: string;
  strand: 1 | -1;
  notes?: string;
  /**
   * Present when the feature is spliced -- a GenBank join(). The blocks are the
   * exons; the gaps between them are the introns. Absent for a feature that
   * occupies one continuous run, which is most of them.
   */
  segments?: { start: number; end: number }[];
}

const PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];

/**
 * The common types are pinned rather than hashed. An eight-colour palette will
 * collide somewhere, and left to a hash it collided on CDS and promoter --
 * the two that appear on almost every map, and the two you least want to
 * confuse with each other.
 */
const BY_TYPE: Record<string, string> = {
  CDS: '#3b82f6',
  gene: '#22c55e',
  exon: '#3b82f6',
  promoter: '#f59e0b',
  terminator: '#ef4444',
  primer_bind: '#ec4899',
  rep_origin: '#a855f7',
  regulatory: '#f97316',
  RBS: '#06b6d4',
  enhancer: '#f97316',
  reporter: '#22c55e',
  selectable_marker: '#ef4444',
  tag: '#06b6d4',
  misc_feature: '#94a3b8',
};

/** Deterministic, so a feature keeps its colour between page loads. */
export function colourForType(type: string): string {
  const pinned = BY_TYPE[type];
  if (pinned) return pinned;
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

type Raw = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A record written by the viewer already carries an id and a numeric strand.
 * Anything else came from an importer and is still in parser coordinates.
 */
function isViewerShape(f: Raw): boolean {
  return typeof f.id === 'string' && typeof f.strand === 'number';
}

/** One stored record in either shape, or null when it is not usable. */
function normaliseOne(f: Raw, index: number): SequenceFeature | null {
  const start = num(f.start);
  const end = num(f.end);
  if (start === null || end === null) return null;

  const viewer = isViewerShape(f);
  const shift = viewer ? 0 : 1; // parser output is 0-based

  const type = typeof f.type === 'string' && f.type ? f.type : 'misc_feature';
  const rawSegments = Array.isArray(f.segments) ? (f.segments as Raw[]) : undefined;

  const segments = rawSegments
    ?.map(s => {
      const a = num(s.start), b = num(s.end);
      return a === null || b === null ? null : { start: a + shift, end: b + shift };
    })
    .filter((s): s is { start: number; end: number } => s !== null)
    .sort((a, b) => a.start - b.start);

  return {
    id: typeof f.id === 'string' && f.id ? f.id : `f-${index}-${start}-${end}`,
    name: typeof f.name === 'string' && f.name ? f.name : type,
    start: start + shift,
    end: end + shift,
    color: typeof f.color === 'string' && f.color ? f.color : colourForType(type),
    type,
    // '+'/'-' from a parser, 1/-1 from the viewer, and anything else is forward.
    strand: f.strand === -1 || f.strand === '-' ? -1 : 1,
    ...(typeof f.notes === 'string' ? { notes: f.notes } : {}),
    // One block is not a splice; only keep segments that say something.
    ...(segments && segments.length > 1 ? { segments } : {}),
  };
}

/** Parse and normalise the stored features column. Never throws. */
export function normaliseFeatures(json: string | null | undefined): SequenceFeature[] {
  if (!json) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((f): f is Raw => !!f && typeof f === 'object' && !Array.isArray(f))
    .map(normaliseOne)
    .filter((f): f is SequenceFeature => f !== null);
}

/** Total bases a feature actually covers -- exons only, when it is spliced. */
export function codingLength(f: SequenceFeature): number {
  if (!f.segments?.length) return f.end - f.start + 1;
  return f.segments.reduce((n, s) => n + (s.end - s.start + 1), 0);
}

/** The gaps between blocks: the introns, in 1-indexed inclusive coordinates. */
export function intronsOf(f: SequenceFeature): { start: number; end: number }[] {
  if (!f.segments || f.segments.length < 2) return [];
  const out: { start: number; end: number }[] = [];
  for (let i = 1; i < f.segments.length; i++) {
    const prev = f.segments[i - 1], next = f.segments[i];
    if (next.start > prev.end + 1) out.push({ start: prev.end + 1, end: next.start - 1 });
  }
  return out;
}
