import { decode, type FieldDefinition } from './fields';

/**
 * Summarising a column of results.
 *
 * The reason for declaring result schemas at all is that a year of assays can
 * then be compared without anyone re-reading them. That promise is only kept if
 * something does the comparing, so this is the other half of G-42: mean, spread
 * and range per numeric field, optionally split by a categorical one.
 *
 * Sample standard deviation, not population: these are measurements drawn from
 * a process, not an enumeration of everything that exists. The n−1 denominator
 * is the difference, and with the triplicates a lab actually runs it is not a
 * rounding difference — for n = 3 the population formula understates the spread
 * by about 18%.
 */

export interface NumericSummary {
  key: string;
  label: string;
  unit: string | null;
  /** Readings that carried a number. */
  n: number;
  mean: number;
  /** Sample standard deviation. Null when n < 2, where it is undefined. */
  sd: number | null;
  /** Coefficient of variation as a percentage. Null when the mean is 0. */
  cv: number | null;
  min: number;
  max: number;
  median: number;
}

export interface CategorySummary {
  key: string;
  label: string;
  counts: { value: string; count: number }[];
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mean, spread and range for one numeric field across a set of readings. */
export function summariseNumeric(
  def: FieldDefinition,
  numbers: number[],
): NumericSummary | null {
  const xs = numbers.filter(n => Number.isFinite(n));
  if (xs.length === 0) return null;

  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  // n - 1: a sample, not a population. See the note at the top.
  const sd = n > 1
    ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
    : null;
  const sorted = [...xs].sort((a, b) => a - b);

  return {
    key: def.key,
    label: def.label,
    unit: def.unit ?? null,
    n,
    mean,
    sd,
    // CV is a ratio to the mean, so it is meaningless when the mean is zero
    // and misleading when the mean straddles it.
    cv: sd !== null && mean !== 0 ? (sd / mean) * 100 : null,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: median(sorted),
  };
}

/** How often each value of a categorical field appears. */
export function summariseCategory(
  def: FieldDefinition,
  values: unknown[],
): CategorySummary {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const items = Array.isArray(v) ? v.map(String) : [typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)];
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return {
    key: def.key,
    label: def.label,
    counts: [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  };
}

type ValueRow = {
  fieldId: string;
  text: string | null; number: number | null; boolean: boolean | null;
  date: Date | null; refId: string | null; refEntityId: string | null;
};

/** Summarise every field of a schema over a set of results. */
export function summariseResults(
  defs: FieldDefinition[],
  results: { values: ValueRow[] }[],
): { numeric: NumericSummary[]; categorical: CategorySummary[] } {
  const numeric: NumericSummary[] = [];
  const categorical: CategorySummary[] = [];

  for (const def of defs) {
    const raw = results
      .map(r => r.values.find(v => v.fieldId === def.id))
      .filter((v): v is ValueRow => Boolean(v));

    if (def.type === 'number' || def.type === 'integer') {
      const s = summariseNumeric(def, raw.map(v => v.number).filter((n): n is number => n !== null));
      if (s) numeric.push(s);
    } else if (['select', 'multiselect', 'boolean'].includes(def.type)) {
      categorical.push(summariseCategory(def, raw.map(v => decode(def, v))));
    }
  }

  return { numeric, categorical };
}

export interface Group {
  /** The value of the grouping field, or "—" for readings that lack one. */
  value: string;
  count: number;
  numeric: NumericSummary[];
}

/**
 * Split the readings by a categorical field, then summarise each group.
 *
 * This is the shape of the question people actually ask — "is the treated group
 * different from the control" — and it is the reason a select field is worth
 * declaring rather than typing the condition into a notes box.
 */
export function groupBy(
  defs: FieldDefinition[],
  results: { values: ValueRow[] }[],
  groupField: FieldDefinition,
): Group[] {
  const buckets = new Map<string, { values: ValueRow[] }[]>();

  for (const r of results) {
    const v = r.values.find(x => x.fieldId === groupField.id);
    const decoded = decode(groupField, v);
    const key = decoded === null || decoded === undefined || decoded === ''
      ? '—'
      : Array.isArray(decoded) ? decoded.join(', ')
      : typeof decoded === 'boolean' ? (decoded ? 'Yes' : 'No')
      : String(decoded);
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }

  const numericDefs = defs.filter(d => d.type === 'number' || d.type === 'integer');

  return [...buckets.entries()]
    .map(([value, rows]) => ({
      value,
      count: rows.length,
      numeric: numericDefs
        .map(d => summariseNumeric(
          d,
          rows.map(r => r.values.find(v => v.fieldId === d.id)?.number)
            .filter((n): n is number => n !== null && n !== undefined),
        ))
        .filter((s): s is NumericSummary => s !== null),
    }))
    // Ungrouped readings last: they are the leftovers, not a category.
    .sort((a, b) => (a.value === '—' ? 1 : 0) - (b.value === '—' ? 1 : 0) || a.value.localeCompare(b.value));
}

/** A number with a sensible number of digits for its magnitude. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(3);
  return n.toExponential(2);
}
