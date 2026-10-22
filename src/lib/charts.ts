/**
 * Turning recorded results into something with a shape.
 *
 * Results here are rows of typed fields, which is the right way to store them
 * and the wrong way to look at them. The questions people actually have --
 * is this going up, where is the curve's midpoint, which corner of the plate
 * is low -- are all about shape, and a table of ninety-six numbers has none.
 *
 * Everything here is arithmetic over points. Nothing draws; the components do
 * that, so the choices about what a chart means can be tested.
 */

export interface Point {
  /** The thing measured, for colouring and legends. */
  series: string;
  x: number;
  y: number;
  /** Where it came from, so a point can be clicked back to its result. */
  id?: string;
  /** A1..P24 on a plate chart. */
  well?: string;
}

export type ChartKind = 'series' | 'dose' | 'heatmap' | 'scatter';

// ─── Scales ──────────────────────────────────────────────────────────────────

export interface Scale {
  min: number;
  max: number;
  /** Values to put a tick at, inside [min, max]. */
  ticks: number[];
}

/**
 * A scale that starts and ends on a round number.
 *
 * Fitting the axis exactly to the data puts the first tick at 0.0813 and the
 * last at 1.2047, which nobody reads. The steps are 1, 2 and 5 times a power
 * of ten, which is what every axis anybody has ever read is made of.
 */
export function niceScale(values: number[], want = 5): Scale {
  const real = values.filter(Number.isFinite);
  if (real.length === 0) return { min: 0, max: 1, ticks: [0, 0.5, 1] };

  let lo = Math.min(...real);
  let hi = Math.max(...real);

  if (lo === hi) {
    /*
     * Every value the same is a real case -- a plate of blanks, one timepoint
     * -- and an axis from n to n has no height to draw in. Widened around the
     * value rather than from zero, so the flatness is still visible as
     * flatness.
     */
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad; hi += pad;
  }

  const step = niceStep((hi - lo) / Math.max(1, want));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Counted rather than accumulated, because adding a step repeatedly drifts:
  // ten additions of 0.1 do not make 1.
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) ticks.push(round(min + i * step));

  return { min: round(min), max: round(max), ticks };
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const scaled = raw / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

/** Enough places to tell neighbouring ticks apart, and no more. */
export function round(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e9) / 1e9;
}

/**
 * As many places as the step actually has, and no more.
 *
 * Worked out from the step's own decimals rather than from its magnitude: a
 * step of 0.25 is between 0.1 and 1, so a rule based on the magnitude gives
 * one place and labels the ticks 0, 0.3, 0.5 -- which is not where they are.
 */
export function formatTick(n: number, step: number): string {
  let places = 0;
  while (places < 6 && Number(step.toFixed(places)) !== step) places++;
  return n.toFixed(places);
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export interface Series {
  name: string;
  points: Point[];
}

/** Points by series, each sorted along x, with series in the order first seen. */
export function toSeries(points: Point[]): Series[] {
  const by = new Map<string, Point[]>();
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    (by.get(p.series) ?? by.set(p.series, []).get(p.series)!).push(p);
  }
  return [...by.entries()].map(([name, ps]) => ({
    name,
    points: [...ps].sort((a, b) => a.x - b.x),
  }));
}

/**
 * Replicates at the same x, averaged, with their spread.
 *
 * A dose response is three wells per concentration, and drawing all three as
 * separate points makes a cloud rather than a curve. The spread is kept and
 * drawn, because a mean with no spread is a claim nobody can judge.
 */
export interface Averaged {
  x: number;
  mean: number;
  /** Sample standard deviation; zero for a single point. */
  sd: number;
  n: number;
}

export function averageReplicates(points: Point[]): Averaged[] {
  const by = new Map<number, number[]>();
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    (by.get(p.x) ?? by.set(p.x, []).get(p.x)!).push(p.y);
  }
  return [...by.entries()]
    .map(([x, ys]) => {
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      /*
       * n-1, because these are replicates drawn from a population rather than
       * the population itself. With one replicate the spread is nought, which
       * is honest: one measurement says nothing about variability.
       */
      const sd = ys.length > 1
        ? Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length - 1))
        : 0;
      return { x, mean: round(mean), sd: round(sd), n: ys.length };
    })
    .sort((a, b) => a.x - b.x);
}

// ─── Dose response ───────────────────────────────────────────────────────────

export interface DoseFit {
  /** Concentration at half the response. */
  ec50: number;
  /** Fitted top and bottom of the curve. */
  top: number;
  bottom: number;
  /** Hill slope. */
  hill: number;
  /** How well it fits, 0 to 1. */
  r2: number;
  /** Said plainly where a fit should not be trusted. */
  warning?: string;
}

/**
 * A four-parameter fit to a dose response, by grid search and refinement.
 *
 * Deliberately not a general optimiser. A proper Levenberg-Marquardt would be
 * a better fit by a few per cent and a great deal more code to get wrong, and
 * the number anybody reads off this is the EC50 to two significant figures.
 *
 * x is log concentration. Passing raw concentrations gives a fit to the wrong
 * model, so the caller takes the logarithm and the axis says so.
 */
export function fitDose(points: { x: number; y: number }[]): DoseFit | null {
  const data = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (data.length < 4) return null;

  const xs = data.map(p => p.x);
  const ys = data.map(p => p.y);
  const loX = Math.min(...xs), hiX = Math.max(...xs);
  const loY = Math.min(...ys), hiY = Math.max(...ys);

  let best: DoseFit | null = null;

  const tops = spread(hiY, Math.abs(hiY - loY) * 0.2, 5);
  const bottoms = spread(loY, Math.abs(hiY - loY) * 0.2, 5);
  const hills = [-4, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 4];
  /*
   * The midpoint is searched beyond the concentrations tested, not only
   * within them.
   *
   * Confining it to the data range cannot fail to find a midpoint: a curve
   * that has not turned over gets one pinned at the edge of the range and
   * reported as though it had been measured. Letting the fit run past the
   * ends means an extrapolated midpoint comes out as what it is, and is said
   * to be extrapolated below.
   */
  const ec50s = spread((loX + hiX) / 2, (hiX - loX), 33);

  for (const top of tops) {
    for (const bottom of bottoms) {
      if (top === bottom) continue;
      for (const hill of hills) {
        for (const ec50 of ec50s) {
          const r2 = fitQuality(data, { top, bottom, hill, ec50 });
          if (!best || r2 > best.r2) best = { top, bottom, hill, ec50, r2 };
        }
      }
    }
  }
  if (!best) return null;

  // One refinement pass around the winner, which is worth more than a finer
  // grid everywhere and costs a fraction of it.
  for (const ec50 of spread(best.ec50, (hiX - loX) / 10, 21)) {
    for (const hill of spread(best.hill, 0.5, 11)) {
      const r2 = fitQuality(data, { ...best, ec50, hill });
      if (r2 > best.r2) best = { ...best, ec50, hill, r2 };
    }
  }

  const out: DoseFit = {
    ec50: round(best.ec50), top: round(best.top), bottom: round(best.bottom),
    hill: round(best.hill), r2: round(best.r2),
  };

  /*
   * Whether the curve actually turned over, judged from the data rather than
   * from the fit.
   *
   * This is the warning that matters, and it took a failed test to find out
   * why. A four-parameter sigmoid fitted to the toe of a curve does not
   * produce a midpoint outside the tested range -- it rescales the top
   * downwards instead and fits the toe beautifully, r-squared 0.99, with a
   * midpoint sitting confidently inside the data. The arithmetic is right and
   * the answer is meaningless, because the plateau it is half of was never
   * measured.
   *
   * So the ends are checked for flatness. A plateau that has been reached has
   * consecutive points close together; one still climbing between its last
   * two concentrations has not been reached, whatever the fit says.
   */
  const sorted = [...data].sort((a, b) => a.x - b.x);
  const span = Math.max(...ys) - Math.min(...ys);
  const climbing = (a: { y: number }, b: { y: number }) =>
    span > 0 && Math.abs(b.y - a.y) / span > 0.1;

  const topOpen = sorted.length >= 2 && climbing(sorted[sorted.length - 2], sorted[sorted.length - 1]);
  const bottomOpen = sorted.length >= 2 && climbing(sorted[0], sorted[1]);

  if (out.ec50 < loX || out.ec50 > hiX) {
    out.warning = 'The midpoint falls outside the concentrations tested, so it is extrapolated rather than measured.';
  } else if (topOpen && bottomOpen) {
    out.warning = 'Neither end of the curve has levelled off, so this is a slope rather than a dose response.';
  } else if (topOpen || bottomOpen) {
    out.warning = `The ${topOpen ? 'top' : 'bottom'} of the curve was never reached — the response was still changing at the `
      + `${topOpen ? 'highest' : 'lowest'} concentration tested, so the midpoint rests on a plateau that was not measured.`;
  } else if (out.r2 < 0.8) {
    out.warning = 'The curve fits these points poorly; treat the midpoint as indicative.';
  }
  return out;
}

const spread = (centre: number, radius: number, steps: number): number[] => {
  if (!(radius > 0)) return [centre];
  const out: number[] = [];
  for (let i = 0; i < steps; i++) out.push(centre - radius + (2 * radius * i) / (steps - 1));
  return out;
};

export function doseAt(x: number, f: { top: number; bottom: number; hill: number; ec50: number }): number {
  return f.bottom + (f.top - f.bottom) / (1 + Math.pow(10, (f.ec50 - x) * f.hill));
}

function fitQuality(data: { x: number; y: number }[], f: { top: number; bottom: number; hill: number; ec50: number }): number {
  const ys = data.map(p => p.y);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssRes = 0, ssTot = 0;
  for (const p of data) {
    const fitted = doseAt(p.x, f);
    if (!Number.isFinite(fitted)) return -Infinity;
    ssRes += (p.y - fitted) ** 2;
    ssTot += (p.y - mean) ** 2;
  }
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

// ─── Heatmaps ────────────────────────────────────────────────────────────────

export interface Heat {
  rows: number;
  columns: number;
  /** Row-major, null where no well was read. */
  cells: (number | null)[][];
  min: number;
  max: number;
}

/** Rows and columns for a plate of this many wells. */
export function plateShape(format: number): { rows: number; columns: number } {
  const known: Record<number, [number, number]> = {
    6: [2, 3], 12: [3, 4], 24: [4, 6], 48: [6, 8], 96: [8, 12], 384: [16, 24], 1536: [32, 48],
  };
  const [rows, columns] = known[format] ?? [8, 12];
  return { rows, columns };
}

export function heatmapOf(values: Map<string, number | null>, format: number): Heat {
  const { rows, columns } = plateShape(format);
  const cells: (number | null)[][] = Array.from({ length: rows }, () => Array<number | null>(columns).fill(null));

  let min = Infinity, max = -Infinity;
  for (const [well, value] of values) {
    const m = /^([A-P])(\d{1,2})$/.exec(well);
    if (!m) continue;
    const r = m[1].charCodeAt(0) - 65;
    const c = Number(m[2]) - 1;
    if (r >= rows || c >= columns || r < 0 || c < 0) continue;
    cells[r][c] = value;
    if (value !== null) { min = Math.min(min, value); max = Math.max(max, value); }
  }

  return {
    rows, columns, cells,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
  };
}

/**
 * Where a value sits between the lowest and the highest, 0 to 1.
 *
 * A flat plate returns 0.5 everywhere rather than dividing by nothing: all
 * wells the same should look the same, not look like an error.
 */
export function heatFraction(value: number, heat: { min: number; max: number }): number {
  if (heat.max === heat.min) return 0.5;
  return Math.min(1, Math.max(0, (value - heat.min) / (heat.max - heat.min)));
}
