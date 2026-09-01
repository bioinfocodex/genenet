/**
 * The two decisions a map makes about a feature before it draws anything: what
 * shape it is, and what colour its name has to be written in.
 *
 * Both used to be constants. Every feature was a block arrow, and every label
 * was white -- which is unreadable the moment a feature is amber (#f59e0b) or
 * lime (#a3e635), two colours the palette hands out for promoters and UTRs.
 * Neither is a per-map choice, so both live here rather than in the renderers,
 * and the linear and circular maps agree by construction instead of by
 * remembering to.
 */

/**
 * The glyph vocabulary. A map is quicker to read when a promoter does not look
 * like a coding sequence, and `type` is already on every feature -- it was just
 * only being used to pick a colour.
 */
export type FeatureShape =
  /** Coding, transcribed, directional: a block with a point on the 3' end. */
  | 'arrow'
  /** A bent arrow: a stem at the 5' end, a thin arm, a head. Transcription starts here. */
  | 'promoter'
  /** A stem with a crossbar. Transcription stops here, so it has no direction. */
  | 'terminator'
  /** An outlined lens. Replication is not transcription and should not carry an arrowhead. */
  | 'origin'
  /** Present, bounded, not directional: tags, UTRs, MCSs, anything unclassified. */
  | 'block';

const BY_TYPE: Record<string, FeatureShape> = {
  CDS: 'arrow',
  gene: 'arrow',
  exon: 'arrow',
  mRNA: 'arrow',
  reporter: 'arrow',
  selectable_marker: 'arrow',
  primer_bind: 'arrow',
  tRNA: 'arrow',
  rRNA: 'arrow',
  ncRNA: 'arrow',

  promoter: 'promoter',
  enhancer: 'promoter',

  terminator: 'terminator',
  polyA_signal: 'terminator',

  rep_origin: 'origin',
  oriT: 'origin',

  intron: 'block',
  regulatory: 'block',
  RBS: 'block',
  tag: 'block',
  misc_feature: 'block',
  protein_bind: 'block',
  LTR: 'block',
  "5'UTR": 'block',
  "3'UTR": 'block',
};

/** Unknown types fall back to a plain block: shape is a claim, and a guess is not one. */
export function shapeFor(type: string | undefined): FeatureShape {
  if (!type) return 'block';
  return BY_TYPE[type] ?? BY_TYPE[type.toLowerCase()] ?? 'block';
}

/** Whether the glyph is drawn as a solid band the full height of its track. */
export function isSolid(shape: FeatureShape): boolean {
  return shape === 'arrow' || shape === 'block';
}

// ─── Label colour ────────────────────────────────────────────────────────────

const DARK_INK = '#0f172a';
const LIGHT_INK = '#ffffff';

/** Luminance of DARK_INK, precomputed: it is a constant, not a parse. */
const DARK_L = 0.0094;

function parseColour(c: string): [number, number, number] | null {
  const s = c.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    // #rgb and #rgba expand each digit; #rrggbb and #rrggbbaa are read directly.
    // Alpha is parsed and dropped -- what sits behind a translucent fill is the
    // page, and guessing at it is worse than treating the colour as opaque.
    if (h.length === 3 || h.length === 4) {
      return [0, 1, 2].map(i => parseInt(h[i] + h[i], 16)) as [number, number, number];
    }
    if (h.length === 6 || h.length === 8) {
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    }
    return null;
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts as [number, number, number];
    }
  }

  return null;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/*
 * 3:1 -- WCAG's ratio for large text, which is what a bold label is.
 *
 * Not the better of the two ratios outright. Taken literally that flips a
 * label to dark on any fill lighter than about 18% luminance, which on this
 * palette means blue and red as well, and a map whose names alternate between
 * white and near-black reads as a mistake even where each one is legible.
 * White holds the map together, so white keeps the fills where it is genuinely
 * readable and loses the ones where it is not.
 */
const AA_LARGE = 3;

/**
 * The ink to write a label in so it can be read against `fill`.
 *
 * Blue, red, purple and pink clear the bar in white and keep it. Amber, lime,
 * cyan, orange, green and slate do not -- those are the ones that were coming
 * out as white-on-bright -- and take near-black instead.
 */
export function labelInk(fill: string): string {
  const rgb = parseColour(fill);
  if (!rgb) return LIGHT_INK;
  const L = luminance(rgb);
  const againstWhite = 1.05 / (L + 0.05);
  if (againstWhite >= AA_LARGE) return LIGHT_INK;
  const againstDark = (L + 0.05) / (DARK_L + 0.05);
  return againstDark > againstWhite ? DARK_INK : LIGHT_INK;
}

// ─── Label size ──────────────────────────────────────────────────────────────

/*
 * Character widths as fractions of the font size, for the system sans stack.
 * Measuring text properly means a canvas or a DOM node; every renderer here
 * decides label placement during layout, before anything is in the document.
 * A table is close enough to keep a name inside its own arrow, which is all
 * the decision needs.
 */
const NARROW = new Set("iljItf'.,:;|!()[]{}/\\ ");
const WIDE = new Set('MWmw@%');

/** Approximate rendered width of `text` in px. */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) units += 0.32;
    else if (WIDE.has(ch)) units += 0.86;
    else if (ch >= 'A' && ch <= 'Z') units += 0.65;
    else if (ch >= '0' && ch <= '9') units += 0.56;
    else units += 0.53;
  }
  return units * fontSize * (bold ? 1.05 : 1);
}
