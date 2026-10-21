import { roleFor } from './map-style';
import type { ChooseOptions } from './map-enzymes';
import type { SequenceFeature } from './features';

/**
 * What a map draws, as a setting that belongs to the sequence.
 *
 * Shape, colour and label ink are decided from the feature itself and are not
 * anybody's choice (see map-style.ts). What is a choice is how much of the
 * molecule to put on the page: a plasmid carrying forty annotations, half of
 * them `misc_feature` from an import, makes a figure nobody can read, and the
 * answer is not to delete the annotations -- they are correct, and the next
 * person will want them -- but to leave them out of this drawing.
 *
 * That choice was being made per view and forgotten on reload, so a map
 * prepared for a figure had to be re-prepared every time, and the print view
 * knew nothing about it at all: the thing on screen and the thing on paper
 * were two different drawings. The style is stored on the sequence so that
 * both read the same one.
 */

export interface MapStyle {
  /**
   * GenBank types left out of the drawing.
   *
   * The exclusions are stored, not the inclusions, and the difference matters.
   * A sequence gains annotation over its life -- from an annotation run, from
   * an assembly carrying its parents' features in. A style that listed the
   * types to show would make every type acquired afterwards invisible, and
   * invisible without saying so, which is the one thing a map must not do.
   */
  hiddenTypes: string[];
  /** Individual features left out, by id, whatever their type. */
  hiddenIds: string[];
  /**
   * Features shorter than this are left out.
   *
   * The clutter on a real plasmid map is mostly short: RBSs, tags, linkers,
   * single protein-binding sites. Nought draws everything.
   */
  minLength: number;

  // ─── The layers besides the features themselves ───

  /** Restriction sites and their labels. */
  sites: boolean;
  /** Most cuts an enzyme may make and still be drawn. 1 is "unique cutters". */
  maxCuts: number;
  /** Shortest recognition sequence worth drawing. */
  minSite: number;
  /**
   * Draw only these enzymes, by name. Empty leaves the choice to the two
   * filters above, which is how most maps are drawn.
   *
   * Named enzymes outrank the filters rather than being narrowed by them: a
   * person who asks for BsaI is asking about BsaI, whatever its site length
   * and however often it cuts.
   */
  enzymes: string[];

  /** Primers located on this sequence. */
  primers: boolean;
  /** Open reading frames with no coding feature over them. */
  orfs: boolean;
  /** Also the frames that already have a CDS over them, faintly. */
  orfsAnnotated: boolean;
}

/*
 * Frozen, arrays and all.
 *
 * A spread of this object copies the arrays by reference, so a caller holding
 * what it believes is its own style can append a hidden type and hide it on
 * every other sequence in the process -- which is what happened. Freezing
 * turns that into an error at the point of the mistake instead of a map
 * somewhere else quietly missing its features, and `defaultStyle()` below is
 * the way to get a copy that is safe to edit.
 */
/** A frozen empty list that still types as one of the fields above. */
const NO_NAMES = Object.freeze([] as string[]) as string[];

export const DEFAULT_STYLE: Readonly<MapStyle> = Object.freeze({
  hiddenTypes: NO_NAMES,
  hiddenIds: NO_NAMES,
  minLength: 0,
  sites: true,
  maxCuts: 1,
  minSite: 6,
  enzymes: NO_NAMES,
  primers: true,
  orfs: false,
  orfsAnnotated: false,
});

/** A style of one's own: the defaults, with arrays nobody else holds. */
export function defaultStyle(): MapStyle {
  return { ...DEFAULT_STYLE, hiddenTypes: [], hiddenIds: [], enzymes: [] };
}

/** Ranges wide enough to be useful and narrow enough to stay legible. */
const LIMITS = {
  minLength: [0, 100_000] as const,
  /** Above about three cuts an enzyme stops telling you anything; 99 is "all". */
  maxCuts: [1, 99] as const,
  /** No enzyme in REBASE has a recognition site outside this. */
  minSite: [1, 20] as const,
};

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/**
 * Read a stored style.
 *
 * Every field is checked on its own and falls back to the default on its own.
 * A style written by an older version is missing keys; one written by a newer
 * one has keys this version does not know; and a corrupt field is possible in
 * either. None of those should cost the whole style -- a map that forgets
 * which types were hidden because the label size was a string is worse than
 * one that keeps the default label size.
 */
export function parseStyle(raw: string | null | undefined): MapStyle {
  if (!raw) return defaultStyle();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return defaultStyle();
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return defaultStyle();
  const o = obj as Record<string, unknown>;

  const strings = (v: unknown): string[] | null =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))] : null;
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const num = (v: unknown, range: readonly [number, number]): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, range) : null;

  return {
    hiddenTypes: strings(o.hiddenTypes) ?? [],
    hiddenIds: strings(o.hiddenIds) ?? [],
    minLength: num(o.minLength, LIMITS.minLength) ?? DEFAULT_STYLE.minLength,
    sites: bool(o.sites) ?? DEFAULT_STYLE.sites,
    maxCuts: num(o.maxCuts, LIMITS.maxCuts) ?? DEFAULT_STYLE.maxCuts,
    minSite: num(o.minSite, LIMITS.minSite) ?? DEFAULT_STYLE.minSite,
    enzymes: strings(o.enzymes) ?? [],
    primers: bool(o.primers) ?? DEFAULT_STYLE.primers,
    orfs: bool(o.orfs) ?? DEFAULT_STYLE.orfs,
    orfsAnnotated: bool(o.orfsAnnotated) ?? DEFAULT_STYLE.orfsAnnotated,
  };
}

/**
 * Write a style, as what it departs from rather than as all of it.
 *
 * Storing only the differences keeps a default a default: if the shipped
 * label size changes later, every sequence whose style never mentioned label
 * size follows the new one, and only the sequences where somebody chose a size
 * keep theirs. Storing all nine fields would freeze today's defaults into
 * every record that was ever opened.
 *
 * Null when nothing departs, so the column stays empty rather than holding a
 * copy of the defaults.
 */
export function serialiseStyle(style: MapStyle): string | null {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_STYLE) as (keyof MapStyle)[]) {
    const mine = style[key];
    const theirs = DEFAULT_STYLE[key];
    const same = Array.isArray(mine) && Array.isArray(theirs)
      ? mine.length === theirs.length && mine.every((x, i) => x === theirs[i])
      : mine === theirs;
    if (!same) diff[key] = Array.isArray(mine) ? [...mine].sort() : mine;
  }
  return Object.keys(diff).length === 0 ? null : JSON.stringify(diff);
}

export const isDefaultStyle = (style: MapStyle) => serialiseStyle(style) === null;

/**
 * How many bases a feature covers.
 *
 * A spliced feature covers its exons and not the introns between them, which
 * is what a length filter should be judging: a three-exon gene over 8 kb of
 * genome is not a short feature, and a 12 bp exon of it is not a feature at
 * all for this purpose.
 *
 * A feature running through the origin of a circular molecule has `end`
 * before `start`, and its length cannot be worked out without knowing how long
 * the molecule is. Where that is not known the length is reported as
 * unbounded: leaving a feature out is a claim about it, and a guess is not
 * grounds for one.
 */
export function featureLength(f: SequenceFeature, seqLength?: number): number {
  if (f.segments?.length) {
    return f.segments.reduce((n, s) => n + Math.max(0, s.end - s.start + 1), 0);
  }
  if (f.end >= f.start) return f.end - f.start + 1;
  if (seqLength && seqLength > 0) return seqLength - f.start + 1 + f.end;
  return Infinity;
}

/** Whether this feature is drawn under this style. */
export function isDrawn(f: SequenceFeature, style: MapStyle, seqLength?: number): boolean {
  if (style.hiddenIds.includes(f.id)) return false;
  if (f.type && style.hiddenTypes.includes(f.type)) return false;
  if (style.minLength > 0 && featureLength(f, seqLength) < style.minLength) return false;
  return true;
}

/** The features to draw, in the order they came. */
export function applyStyle(
  features: SequenceFeature[],
  style: MapStyle,
  seqLength?: number,
): SequenceFeature[] {
  return features.filter(f => isDrawn(f, style, seqLength));
}

export interface TypeRow {
  type: string;
  count: number;
  hidden: boolean;
  /** A swatch for the row: what this type is actually drawn in here. */
  colour: string;
}

/**
 * The types on this sequence, with how many of each.
 *
 * Built from the sequence rather than from the vocabulary of every type
 * GenBank defines, because a list of forty types of which three are present is
 * not a control anybody can use. The count is what makes the choice an
 * informed one -- "misc_feature (17)" says where the clutter is.
 */
export function typesPresent(features: SequenceFeature[], style: MapStyle): TypeRow[] {
  const by = new Map<string, { count: number; colour: string }>();
  for (const f of features) {
    const type = f.type || 'unclassified';
    const row = by.get(type);
    if (row) row.count++;
    else by.set(type, { count: 1, colour: f.color || '#d4d4d4' });
  }
  return [...by.entries()]
    .map(([type, { count, colour }]) => ({
      type, count, colour,
      hidden: style.hiddenTypes.includes(type),
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * What the style is leaving out, so the map can say so.
 *
 * A filter that quietly removes features turns a map into a claim that the
 * molecule has only what is drawn. The count is shown next to the control for
 * that reason, and it is counted the same way the drawing is -- through
 * `isDrawn` -- so the two cannot drift apart.
 */
export function hiddenCount(
  features: SequenceFeature[],
  style: MapStyle,
  seqLength?: number,
): number {
  return features.reduce((n, f) => n + (isDrawn(f, style, seqLength) ? 0 : 1), 0);
}

/**
 * The roles a drawing still contains, for a figure legend.
 *
 * Only the roles actually drawn: a legend listing a colour that is not on the
 * map is as misleading as a map missing a colour that is.
 */
export function legendRoles(features: SequenceFeature[]): { role: string; colour: string; names: string[] }[] {
  const by = new Map<string, { colour: string; names: string[] }>();
  for (const f of features) {
    const role = roleFor(f.type, f.name);
    const row = by.get(role);
    if (row) { if (!row.names.includes(f.name)) row.names.push(f.name); }
    else by.set(role, { colour: f.color, names: [f.name] });
  }
  return [...by.entries()].map(([role, v]) => ({ role, ...v }));
}

/**
 * How the style asks for restriction sites.
 *
 * The translation lives here rather than in the viewer so that the screen and
 * the printed figure ask the same question. They did not: the print view drew
 * unique cutters and nothing else, so a map set up on screen to show a working
 * set of enzymes printed as a different map.
 *
 * `setNames` is the lab's current working set -- the enzymes in the freezer,
 * the ones in a kit -- which is a property of the bench, not of this sequence,
 * and so is passed in rather than stored.
 */
export function enzymeOptions(style: MapStyle, setNames?: string[] | null): ChooseOptions {
  /*
   * Naming enzymes overrides the filters rather than intersecting them. The
   * filters answer a question nobody asked out loud: of five thousand cuts,
   * which are worth drawing. Once somebody types "AluI" they have asked out
   * loud, and a four-cutter that cuts forty times failing every default is the
   * reason they had to ask.
   */
  if (style.enzymes.length > 0) {
    return { restrictTo: [...style.enzymes], minSiteLength: 0, maxCuts: Infinity, maxLabels: 400 };
  }
  return {
    minSiteLength: style.minSite,
    maxCuts: style.maxCuts,
    ...(setNames && setNames.length ? { restrictTo: setNames } : {}),
  };
}
