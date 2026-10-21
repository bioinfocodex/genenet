/**
 * How much of something there is, and how much is left after somebody takes
 * some.
 *
 * A sample in this application was a name, a type and a place in a freezer.
 * Nothing recorded how much of it there was, so the only way to know whether
 * a tube still had anything in it was to go and look -- which is the question
 * an inventory exists to answer without going and looking.
 *
 * The remaining amount is computed from the uses, never typed. That is not a
 * stylistic preference: a typed remainder is a number somebody has to remember
 * to update, and the first time it is not updated it becomes a claim about a
 * tube that is wrong, with nothing to say so. A list of uses can be wrong too,
 * but it is wrong in a way that can be read, argued with and corrected.
 *
 * Everything here is pure arithmetic over units. The storage is elsewhere.
 */

export type Dimension = 'volume' | 'mass' | 'substance' | 'count';

export interface Unit {
  id: string;
  /** How it is written on a tube. */
  label: string;
  dimension: Dimension;
  /** Multiply by this to reach the dimension's base unit: L, g, mol or item. */
  factor: number;
}

/*
 * The ladders, finest last.
 *
 * Micro is written µ (U+00B5 MICRO SIGN) throughout, and parsed from both that
 * and μ (U+03BC GREEK SMALL LETTER MU), which look identical and arrive from
 * instrument exports and pasted protocols in both forms. A tube labelled with
 * the wrong one of the two is not a different unit.
 */
export const UNITS: Unit[] = [
  { id: 'L', label: 'L', dimension: 'volume', factor: 1 },
  { id: 'mL', label: 'mL', dimension: 'volume', factor: 1e-3 },
  { id: 'uL', label: 'µL', dimension: 'volume', factor: 1e-6 },
  { id: 'nL', label: 'nL', dimension: 'volume', factor: 1e-9 },

  { id: 'kg', label: 'kg', dimension: 'mass', factor: 1e3 },
  { id: 'g', label: 'g', dimension: 'mass', factor: 1 },
  { id: 'mg', label: 'mg', dimension: 'mass', factor: 1e-3 },
  { id: 'ug', label: 'µg', dimension: 'mass', factor: 1e-6 },
  { id: 'ng', label: 'ng', dimension: 'mass', factor: 1e-9 },
  { id: 'pg', label: 'pg', dimension: 'mass', factor: 1e-12 },

  { id: 'mol', label: 'mol', dimension: 'substance', factor: 1 },
  { id: 'mmol', label: 'mmol', dimension: 'substance', factor: 1e-3 },
  { id: 'umol', label: 'µmol', dimension: 'substance', factor: 1e-6 },
  { id: 'nmol', label: 'nmol', dimension: 'substance', factor: 1e-9 },
  { id: 'pmol', label: 'pmol', dimension: 'substance', factor: 1e-12 },
  { id: 'fmol', label: 'fmol', dimension: 'substance', factor: 1e-15 },

  /*
   * Things counted rather than measured: tubes in a box, vials of competent
   * cells, slides. A count has no ladder -- half a tube is a volume, not half
   * a count -- so there is one unit and the quantity is whole.
   */
  { id: 'item', label: '', dimension: 'count', factor: 1 },
];

const BY_ID = new Map(UNITS.map(u => [u.id, u]));

export const unit = (id: string): Unit | null => BY_ID.get(id) ?? null;

export const unitsOf = (d: Dimension) => UNITS.filter(u => u.dimension === d);

export interface Quantity {
  value: number;
  /** A unit id from UNITS. */
  unit: string;
}

/** The quantity in its dimension's base unit: litres, grams, moles or items. */
export function base(q: Quantity): number | null {
  const u = unit(q.unit);
  return u ? q.value * u.factor : null;
}

export function dimensionOf(q: Quantity): Dimension | null {
  return unit(q.unit)?.dimension ?? null;
}

/** The same amount written in another unit of the same dimension. */
export function convert(q: Quantity, to: string): Quantity | null {
  const from = unit(q.unit), target = unit(to);
  if (!from || !target || from.dimension !== target.dimension) return null;
  return { value: (q.value * from.factor) / target.factor, unit: to };
}

// ─── Reading what somebody typed ─────────────────────────────────────────────

/*
 * Both micro signs, and the words people write instead.
 *
 * "ul" and "uL" are what a keyboard gives when µ is inconvenient, and they are
 * what most instrument exports contain, so they are the canonical ids here and
 * the pretty form is only for display.
 */
const ALIASES: Record<string, string> = {
  l: 'L', liter: 'L', litre: 'L', liters: 'L', litres: 'L',
  ml: 'mL', milliliter: 'mL', millilitre: 'mL', milliliters: 'mL', millilitres: 'mL', cc: 'mL',
  ul: 'uL', microliter: 'uL', microlitre: 'uL', microliters: 'uL', microlitres: 'uL', lambda: 'uL',
  nl: 'nL', nanoliter: 'nL', nanolitre: 'nL',

  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  ug: 'ug', microgram: 'ug', micrograms: 'ug', mcg: 'ug',
  ng: 'ng', nanogram: 'ng', nanograms: 'ng',
  pg: 'pg', picogram: 'pg', picograms: 'pg',

  mol: 'mol', mole: 'mol', moles: 'mol',
  mmol: 'mmol', millimole: 'mmol', millimoles: 'mmol',
  umol: 'umol', micromole: 'umol', micromoles: 'umol',
  nmol: 'nmol', nanomole: 'nmol', nanomoles: 'nmol',
  pmol: 'pmol', picomole: 'pmol', picomoles: 'pmol',
  fmol: 'fmol', femtomole: 'fmol', femtomoles: 'fmol',

  item: 'item', items: 'item', tube: 'item', tubes: 'item', vial: 'item',
  vials: 'item', aliquot: 'item', aliquots: 'item', x: 'item',
};

/** µ and μ are the same unit however the keyboard produced them. */
const normaliseMicro = (s: string) => s.replace(/[µμ]/g, 'u');

/**
 * Read "50 µL", "0.5mL", "2e3 ng", "3 tubes" or "7".
 *
 * A bare number is a count, because that is what somebody typing a bare number
 * into a quantity box means: three of them.
 */
export function parseQuantity(text: string): Quantity | null {
  const s = normaliseMicro(String(text)).trim();
  if (!s) return null;
  const m = /^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*([A-Za-z]*)$/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const word = m[2];
  if (!word) return { value, unit: 'item' };
  const id = ALIASES[word.toLowerCase()];
  return id ? { value, unit: id } : null;
}

// ─── Writing it back out ─────────────────────────────────────────────────────

/**
 * The unit a person would have used.
 *
 * 0.000005 L is five microlitres and nobody writes it the first way. The
 * ladder is walked for the unit that puts the number between 1 and 1000,
 * which is how a lab notebook reads: 1.5 mg rather than 1500 µg, 900 ng rather
 * than 0.9 µg.
 */
export function humanise(q: Quantity): Quantity {
  const u = unit(q.unit);
  if (!u || u.dimension === 'count') return q;
  const amount = q.value * u.factor;
  if (amount === 0) return q;

  const ladder = unitsOf(u.dimension).slice().sort((a, b) => b.factor - a.factor);
  const magnitude = Math.abs(amount);
  // The largest unit the amount still reaches one of; the finest otherwise.
  const chosen = ladder.find(x => magnitude / x.factor >= 1) ?? ladder[ladder.length - 1];
  return { value: amount / chosen.factor, unit: chosen.id };
}

/** Four significant figures, trailing zeros dropped: 45 µL, not 45.00 µL. */
export function round(value: number, figures = 4): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const factor = 10 ** (figures - Math.ceil(Math.log10(Math.abs(value))));
  return Math.round(value * factor) / factor;
}

export function format(q: Quantity, opts: { humanise?: boolean } = {}): string {
  const shown = opts.humanise === false ? q : humanise(q);
  const u = unit(shown.unit);
  if (!u) return String(round(shown.value));
  const n = round(shown.value);
  if (u.dimension === 'count') {
    return `${n} ${Math.abs(n) === 1 ? 'item' : 'items'}`;
  }
  return `${n} ${u.label}`;
}

// ─── Concentration ───────────────────────────────────────────────────────────

/**
 * How much is in a given volume: the thing that lets a volume be turned into a
 * mass, and a mass back into a volume.
 *
 * Held as a numerator unit over a denominator volume unit rather than as a
 * single scalar, because a tube is labelled "200 ng/µL" and that is what
 * should be stored and shown. The arithmetic converts; the label does not.
 */
export interface Concentration {
  value: number;
  /** A mass or substance unit id. */
  per: string;
  /** A volume unit id. */
  volume: string;
}

export const CONCENTRATION_PRESETS = [
  { per: 'ng', volume: 'uL' }, { per: 'ug', volume: 'uL' },
  { per: 'ug', volume: 'mL' }, { per: 'mg', volume: 'mL' },
  { per: 'mol', volume: 'L' }, { per: 'mmol', volume: 'L' },
  { per: 'umol', volume: 'L' }, { per: 'nmol', volume: 'L' },
] as const;

/** Grams or moles per litre, whichever the numerator is. */
export function perLitre(c: Concentration): number | null {
  const n = unit(c.per), v = unit(c.volume);
  if (!n || !v) return null;
  if (n.dimension !== 'mass' && n.dimension !== 'substance') return null;
  if (v.dimension !== 'volume') return null;
  return (c.value * n.factor) / v.factor;
}

export function formatConcentration(c: Concentration): string {
  const n = unit(c.per), v = unit(c.volume);
  if (!n || !v) return `${round(c.value)}`;
  /*
   * Molar, when the units say so. "1 mol/L" is written 1 M on every bottle in
   * every lab, and writing it the other way looks like a mistake.
   */
  if (n.dimension === 'substance' && c.volume === 'L') {
    const molar = { mol: 'M', mmol: 'mM', umol: 'µM', nmol: 'nM', pmol: 'pM', fmol: 'fM' };
    const suffix = molar[c.per as keyof typeof molar];
    if (suffix) return `${round(c.value)} ${suffix}`;
  }
  return `${round(c.value)} ${n.label}/${v.label}`;
}

/** The mass (or moles) in a volume of something at a concentration. */
export function amountIn(volume: Quantity, c: Concentration): Quantity | null {
  const litres = base(volume);
  const perL = perLitre(c);
  const n = unit(c.per);
  if (litres === null || perL === null || !n) return null;
  if (dimensionOf(volume) !== 'volume') return null;
  return humanise({ value: litres * perL, unit: n.dimension === 'mass' ? 'g' : 'mol' });
}

/** The volume that holds a given mass (or number of moles) at a concentration. */
export function volumeFor(amount: Quantity, c: Concentration): Quantity | null {
  const perL = perLitre(c);
  const a = base(amount);
  const n = unit(c.per);
  if (a === null || perL === null || perL === 0 || !n) return null;
  if (dimensionOf(amount) !== n.dimension) return null;
  return humanise({ value: a / perL, unit: 'L' });
}

// ─── Molar mass, for turning nanograms into picomoles ────────────────────────

/**
 * The molar mass of a DNA molecule, so a nanogram can be a picomole.
 *
 * Two conventions meet here and they are not interchangeable, so both are
 * named rather than averaged into one number.
 *
 * 650 g/mol per base pair, the figure every protocol quotes, is the sodium
 * salt: the sodium-salt nucleotides average 326.9 each, and two of them make
 * 653.9. The 617.96 used below is the free acid, whose nucleotides average
 * 308.98. Neither is wrong; they are different substances, and the 5% between
 * them is the difference between a ligation set up at 3:1 insert to vector and
 * one at 2.85:1. The free acid is what NEB's calculators use and what the
 * per-base figures for oligos below are consistent with, so it is what this
 * uses throughout.
 *
 *   dsDNA: 617.96 per base pair plus 36.04, which is the standard formula and
 *          lands within about 0.01% of summing the actual bases of both
 *          strands -- checked against Biopython for a 20-mer.
 *   ssDNA: summed per base, A 313.21, T 304.20, C 289.18, G 329.21, less
 *          61.96. That correction removes the 5'-phosphate the per-base
 *          figures carry and puts back a hydroxyl, which gives the molecule a
 *          synthesiser actually ships. An oligo ordered phosphorylated, or one
 *          kinased for a ligation, is 79.98 heavier -- see `phosphorylated`.
 *
 * A circular molecule has no ends, so it loses the end correction: a rounding
 * error on a plasmid, and a measurable amount on anything short.
 */
export const DS_PER_BP = 617.96;
export const DS_ENDS = 36.04;

/** Free-acid nucleoside monophosphate residues, the figures oligo suppliers use. */
const SS_PER_BASE: Record<string, number> = { A: 313.21, T: 304.20, C: 289.18, G: 329.21, U: 306.17 };
/** Takes off the 5'-phosphate (-79.98) and puts back water (+18.02). */
const SS_CORRECTION = -61.96;

export function dsDnaMolarMass(basePairs: number, circular = false): number | null {
  if (!Number.isFinite(basePairs) || basePairs <= 0) return null;
  return basePairs * DS_PER_BP + (circular ? 0 : DS_ENDS);
}

/**
 * The molar mass of a single strand, from its own bases.
 *
 * Summed rather than averaged, because an oligo is short enough for its
 * composition to matter: a 20-mer of all G is 800 g/mol heavier than a 20-mer
 * of all C, which is 13% of a 20-mer's mass.
 */
export function ssDnaMolarMass(sequence: string, opts: { phosphorylated?: boolean } = {}): number | null {
  const s = sequence.toUpperCase().replace(/[^ACGTU]/g, '');
  if (!s) return null;
  let total = SS_CORRECTION;
  for (const ch of s) total += SS_PER_BASE[ch] ?? 0;
  /*
   * A 5'-phosphate is a real 80 daltons, and on a 20-mer that is 1.3% -- the
   * same oligo weighed two ways. It matters here because this application
   * already knows which oligos are phosphorylated: a blunt ligation depends on
   * it, and lib/fragments.ts models putting one on and taking it off.
   */
  return opts.phosphorylated ? total + PHOSPHATE : total;
}

/** HPO3, the 5'-phosphate a kinase adds. */
export const PHOSPHATE = 79.98;

/** Moles from a mass, given a molar mass in g/mol. */
export function molesFrom(mass: Quantity, molarMass: number): Quantity | null {
  const g = base(mass);
  if (g === null || dimensionOf(mass) !== 'mass') return null;
  if (!Number.isFinite(molarMass) || molarMass <= 0) return null;
  return humanise({ value: g / molarMass, unit: 'mol' });
}

/** Mass from moles, given a molar mass in g/mol. */
export function massFrom(moles: Quantity, molarMass: number): Quantity | null {
  const mol = base(moles);
  if (mol === null || dimensionOf(moles) !== 'substance') return null;
  if (!Number.isFinite(molarMass) || molarMass <= 0) return null;
  return humanise({ value: mol * molarMass, unit: 'g' });
}

// ─── Drawing a tube down ─────────────────────────────────────────────────────

export interface Stock {
  /** What was put in. A volume, a mass, or a number of things. */
  initial: Quantity;
  /** What links a volume to a mass, where there is one. */
  concentration?: Concentration | null;
  /** The molar mass of the contents, where it is known. */
  molarMass?: number | null;
}

export interface Draw {
  amount: Quantity;
  /** Free text, for the record rather than the arithmetic. */
  note?: string;
}

export interface Remaining {
  /** What is left, in the unit the stock was recorded in. */
  left: Quantity;
  /** True once nothing is left. */
  empty: boolean;
  /**
   * Set when the uses add up to more than there ever was.
   *
   * Reported rather than clamped. Somebody taking more than the tube held is
   * a real thing that happens -- the tube was mislabelled, or a use was
   * entered twice -- and silently showing nought left would hide the only
   * evidence of it.
   */
  overdrawn?: Quantity;
  /** Uses that could not be subtracted, with the reason. */
  unusable: { draw: Draw; why: string }[];
}

/**
 * Convert a use into the stock's own unit, where anything links the two.
 *
 * A volume taken from a tube recorded as a volume is a subtraction. A mass
 * taken from the same tube is a volume once the concentration is known. A mass
 * taken from a tube with no concentration recorded is not a subtraction at
 * all, and saying so is more use than guessing.
 */
export function inStockUnits(draw: Quantity, stock: Stock): Quantity | { why: string } {
  const want = dimensionOf(stock.initial);
  const got = dimensionOf(draw);
  if (!want || !got) return { why: 'That is not a unit this knows.' };
  if (want === got) return convert(draw, stock.initial.unit)!;

  if (want === 'count' || got === 'count') {
    return { why: `This is recorded as ${want === 'count' ? 'a number of things' : 'a measured amount'}, so ${format(draw)} cannot be taken from it.` };
  }

  const c = stock.concentration ?? null;
  const mm = stock.molarMass ?? null;

  // Through the concentration: volume <-> whatever the numerator is.
  if (c) {
    const numerator = unit(c.per)?.dimension;
    if (want === 'volume' && got === numerator) {
      const v = volumeFor(draw, c);
      if (v) return convert(v, stock.initial.unit)!;
    }
    if (got === 'volume' && want === numerator) {
      const a = amountIn(draw, c);
      if (a) return convert(a, stock.initial.unit)!;
    }
  }

  // Through the molar mass: mass <-> moles.
  if (mm) {
    if (want === 'mass' && got === 'substance') {
      const m = massFrom(draw, mm);
      if (m) return convert(m, stock.initial.unit)!;
    }
    if (want === 'substance' && got === 'mass') {
      const n = molesFrom(draw, mm);
      if (n) return convert(n, stock.initial.unit)!;
    }
    /*
     * Volume to moles needs both: the concentration to reach a mass, and the
     * molar mass to reach moles from it. Each on its own is a dead end, which
     * is why this is tried after both have been looked at.
     */
    if (c && want === 'volume' && got === 'substance' && unit(c.per)?.dimension === 'mass') {
      const asMass = massFrom(draw, mm);
      const v = asMass && volumeFor(asMass, c);
      if (v) return convert(v, stock.initial.unit)!;
    }
  }

  return {
    why: `Nothing recorded links ${format(draw)} to a stock measured in ${unit(stock.initial.unit)!.label || 'items'}`
      + `${c ? '' : '; no concentration is recorded'}${mm ? '' : ', and no molar mass'}.`,
  };
}

/** What is left of a stock after a list of uses. */
export function remaining(stock: Stock, draws: Draw[]): Remaining {
  const start = base(stock.initial);
  const u = unit(stock.initial.unit);
  if (start === null || !u) {
    return { left: stock.initial, empty: false, unusable: draws.map(d => ({ draw: d, why: 'The stock has no readable unit.' })) };
  }

  let used = 0;
  const unusable: { draw: Draw; why: string }[] = [];
  for (const d of draws) {
    const converted = inStockUnits(d.amount, stock);
    if ('why' in converted) { unusable.push({ draw: d, why: converted.why }); continue; }
    used += base(converted)!;
  }

  const leftBase = start - used;
  /*
   * A tolerance, because this is floating point over unit factors spanning
   * fifteen orders of magnitude. 50 µL less five lots of 10 µL leaves
   * 7.1e-21 L rather than nought, and a tube reported as having seven
   * zeptolitres in it is a tube somebody will go and look for.
   */
  const tolerance = Math.abs(start) * 1e-9;
  const empty = leftBase <= tolerance;

  const out: Remaining = {
    left: { value: (empty ? 0 : leftBase) / u.factor, unit: stock.initial.unit },
    empty,
    unusable,
  };
  if (leftBase < -tolerance) {
    out.overdrawn = { value: -leftBase / u.factor, unit: stock.initial.unit };
  }
  return out;
}

/** Whether a single further use would fit in what is left. */
export function canTake(stock: Stock, draws: Draw[], next: Quantity): { ok: true } | { ok: false; why: string } {
  const converted = inStockUnits(next, stock);
  if ('why' in converted) return { ok: false, why: converted.why };
  const left = remaining(stock, draws);
  const have = base(left.left)!;
  const want = base(converted)!;
  if (want <= 0) return { ok: false, why: 'A use has to be more than nothing.' };
  if (want > have + Math.abs(have) * 1e-9) {
    return { ok: false, why: `Only ${format(left.left)} is left, and that would take ${format(converted)}.` };
  }
  return { ok: true };
}
