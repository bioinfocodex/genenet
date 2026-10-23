import { parseCsv, sniffDelimiter } from './csv';

/**
 * Reading the files instruments actually write.
 *
 * Every one of these ends up in a spreadsheet, and the spreadsheet ends up
 * being retyped. The retyping is where the numbers go wrong -- a column
 * shifted, a 260/280 read as a 260/230, a plate transposed -- and it is the
 * part nobody checks afterwards because the file it came from has been
 * closed.
 *
 * Three families, because they cover most of what a molecular biology lab
 * exports: a plate reader, a NanoDrop, and a qPCR run. They do not share a
 * format in any respect. One is a grid with a preamble, one is a wide table of
 * ratios, one is a long table keyed on well, and the only thing they agree on
 * is that the delimiter is whatever the local Windows machine felt like.
 */

export type Instrument = 'plate-grid' | 'plate-list' | 'nanodrop' | 'qpcr';

export interface Reading {
  /** A1..P24 where the file is per-well; null for a plain sample list. */
  well: string | null;
  /** The sample's name where the file carries one. */
  sample: string | null;
  /** Measurement name: "A260", "Cq", "OD600". */
  measure: string;
  value: number | null;
  /** Where a file says so: "ng/µL". */
  unit?: string;
  /** Anything else on the row, kept so nothing is silently dropped. */
  extra?: Record<string, string>;
}

export interface ParseResult {
  instrument: Instrument;
  readings: Reading[];
  /** Lines before the data, which usually hold the run's settings. */
  preamble: string[];
  /** What could not be read, said plainly rather than skipped. */
  problems: string[];
}

const WELL = /^([A-P])(\d{1,2})$/i;

/** A1 to P24, normalised: "a1" and "A01" are the same well. */
export function normaliseWell(raw: string): string | null {
  const m = WELL.exec(raw.trim());
  if (!m) return null;
  const col = Number(m[2]);
  if (col < 1 || col > 24) return null;
  return `${m[1].toUpperCase()}${col}`;
}

const num = (raw: string): number | null => {
  const s = raw.trim();
  if (!s) return null;
  /*
   * A comma decimal, which is what a machine in a German or French lab
   * writes, and the commonest way a plate reader's numbers arrive as text.
   * Only treated as a decimal when there is exactly one and no dot, so that
   * "1,234.5" stays a thousands separator.
   */
  const fixed = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  // "<0.01" and "N/A" and "Undetermined" are answers, but not numbers.
  const n = Number(fixed);
  return Number.isFinite(n) ? n : null;
};

// ─── Which instrument wrote this ─────────────────────────────────────────────

/**
 * Guess the format from the file's own text.
 *
 * Deliberately looks for the things these files say about themselves rather
 * than for column counts: a NanoDrop writes "260/280" and nothing else does,
 * a qPCR table has a Cq or Ct column, a plate grid has a row of column numbers
 * with A, B, C down the side.
 */
export function detect(text: string): Instrument | null {
  const head = text.slice(0, 20_000);
  const lower = head.toLowerCase();

  if (/\b260\s*\/\s*280\b/.test(head)) return 'nanodrop';
  if (/(^|[\t,;])c[qt]\b/i.test(head) && /\bwell\b/i.test(lower)) return 'qpcr';

  const delimiter = sniffDelimiter(head);
  const { rows } = parseCsv(head, { delimiter });

  // A grid: some row is 1,2,3,… and the rows under it start A, B, C.
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    if (looksLikeColumnHeader(rows[i]) && startsAGrid(rows, i)) return 'plate-grid';
  }

  // A list: a column called Well, and a column of values.
  const header = rows.find(r => r.some(c => /^well$/i.test(c.trim())));
  if (header) return 'plate-list';

  return null;
}

/**
 * A row of column numbers: 1, 2, 3, … starting at one and ascending by one.
 *
 * Three is the floor rather than six, because a 6-well plate is three columns
 * wide and a rule written for 96-well plates would refuse it. Requiring them
 * to ascend consecutively is what keeps an ordinary table of numbers from
 * being read as a plate header.
 */
function looksLikeColumnHeader(row: string[] | undefined): boolean {
  if (!row) return false;
  const numbers = row.map(c => c.trim()).filter(Boolean).filter(c => /^\d{1,2}$/.test(c)).map(Number);
  if (numbers.length < 3 || numbers[0] !== 1) return false;
  return numbers.every((n, i) => n === i + 1);
}

function startsAGrid(rows: string[][], headerAt: number): boolean {
  const next = rows[headerAt + 1];
  return !!next && /^[A-P]$/i.test((next[0] ?? '').trim());
}

// ─── The parsers ─────────────────────────────────────────────────────────────

export function parseInstrumentFile(text: string, forced?: Instrument): ParseResult {
  const instrument = forced ?? detect(text);
  if (!instrument) {
    return {
      instrument: 'plate-list',
      readings: [],
      preamble: [],
      problems: ['This does not look like a plate reader, NanoDrop or qPCR export. Choose the format by hand if you know it.'],
    };
  }
  switch (instrument) {
    case 'plate-grid': return parsePlateGrid(text);
    case 'plate-list': return parsePlateList(text);
    case 'nanodrop': return parseNanoDrop(text);
    case 'qpcr': return parseQpcr(text);
  }
}

/**
 * A plate drawn as a grid, with whatever the machine printed above it.
 *
 * The preamble is kept rather than skipped: it is where the wavelength, the
 * gain and the read time live, and those are the first things somebody asks
 * about a number they do not believe.
 *
 * A file may hold several grids -- one per wavelength or per read -- so every
 * grid in the file is read, and each takes its name from the nearest line
 * above it that looks like a label.
 */
export function parsePlateGrid(text: string): ParseResult {
  const delimiter = sniffDelimiter(text);
  const { rows } = parseCsv(text, { delimiter });
  const readings: Reading[] = [];
  const problems: string[] = [];
  const preamble: string[] = [];

  let firstGridAt = -1;

  for (let i = 0; i < rows.length; i++) {
    if (!looksLikeColumnHeader(rows[i]) || !startsAGrid(rows, i)) continue;
    if (firstGridAt === -1) firstGridAt = i;

    const header = rows[i].map(c => c.trim());
    const columns: { at: number; col: number }[] = [];
    header.forEach((c, at) => {
      if (/^\d{1,2}$/.test(c)) columns.push({ at, col: Number(c) });
    });

    const measure = labelAbove(rows, i) ?? `read ${readings.length ? readings.length : 1}`;

    for (let r = i + 1; r < rows.length; r++) {
      const rowLabel = (rows[r][0] ?? '').trim();
      if (!/^[A-P]$/i.test(rowLabel)) break;             // the grid has ended
      for (const { at, col } of columns) {
        const raw = (rows[r][at] ?? '').trim();
        if (!raw) continue;
        const value = num(raw);
        if (value === null) {
          // Kept as a reading with no number rather than dropped: "OVRFLW"
          // on one well of a plate is a result, and a silently missing well
          // reads as a plate that was never that size.
          readings.push({ well: `${rowLabel.toUpperCase()}${col}`, sample: null, measure, value: null, extra: { raw } });
          continue;
        }
        readings.push({ well: `${rowLabel.toUpperCase()}${col}`, sample: null, measure, value });
      }
    }
  }

  if (firstGridAt > 0) {
    for (let i = 0; i < firstGridAt; i++) {
      const line = rows[i].filter(Boolean).join(' ').trim();
      if (line) preamble.push(line);
    }
  }

  if (readings.length === 0) problems.push('Found a grid shape but no numbers in it.');
  return { instrument: 'plate-grid', readings, preamble, problems };
}

/** The nearest line above a grid that reads like a name for it. */
function labelAbove(rows: string[][], at: number): string | null {
  for (let i = at - 1; i >= 0 && i >= at - 4; i--) {
    const cells = (rows[i] ?? []).map(c => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;
    if (cells.length > 3) return null;                   // a table, not a label
    const text = cells.join(' ');
    if (/^\d+$/.test(text)) return null;
    return text;
  }
  return null;
}

/** A plate written one well per row: Well, Sample, Value. */
export function parsePlateList(text: string): ParseResult {
  const delimiter = sniffDelimiter(text);
  const { rows } = parseCsv(text, { delimiter });
  const problems: string[] = [];

  const headerAt = rows.findIndex(r => r.some(c => /^well$/i.test(c.trim())));
  if (headerAt === -1) return { instrument: 'plate-list', readings: [], preamble: [], problems: ['No column called Well.'] };

  const header = rows[headerAt].map(c => c.trim());
  const wellAt = header.findIndex(c => /^well$/i.test(c));
  const sampleAt = header.findIndex(c => /^(sample|sample ?id|name|content)$/i.test(c));
  const valueColumns = header
    .map((c, at) => ({ c, at }))
    .filter(({ c, at }) => at !== wellAt && at !== sampleAt && c !== '');

  const readings: Reading[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const well = normaliseWell(rows[r][wellAt] ?? '');
    if (!well) continue;
    const sample = sampleAt === -1 ? null : (rows[r][sampleAt] ?? '').trim() || null;
    for (const { c, at } of valueColumns) {
      const raw = (rows[r][at] ?? '').trim();
      if (!raw) continue;
      readings.push({ well, sample, measure: c, value: num(raw), ...(num(raw) === null ? { extra: { raw } } : {}) });
    }
  }

  if (readings.length === 0) problems.push('A Well column, but no readings under it.');
  const preamble = rows.slice(0, headerAt).map(r => r.filter(Boolean).join(' ').trim()).filter(Boolean);
  return { instrument: 'plate-list', readings, preamble, problems };
}

/**
 * A NanoDrop export: one row per sample, many ratios per row.
 *
 * Tab-separated in practice whatever the extension says, and the column names
 * carry the units in brackets -- "Nucleic Acid(ng/uL)" -- which is worth
 * keeping, because a concentration with no unit is the thing this whole
 * exercise is trying to stop happening.
 */
export function parseNanoDrop(text: string): ParseResult {
  const delimiter = sniffDelimiter(text);
  const { rows } = parseCsv(text, { delimiter });
  const problems: string[] = [];

  const headerAt = rows.findIndex(r => r.some(c => /260\s*\/\s*280/.test(c)));
  if (headerAt === -1) return { instrument: 'nanodrop', readings: [], preamble: [], problems: ['No 260/280 column, so this is not a NanoDrop export after all.'] };

  const header = rows[headerAt].map(c => c.trim());
  const sampleAt = header.findIndex(c => /^(sample ?id|sample ?name|sample)$/i.test(c));
  const readings: Reading[] = [];

  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(c => !c.trim())) continue;
    const sample = sampleAt === -1 ? null : (row[sampleAt] ?? '').trim() || null;

    header.forEach((name, at) => {
      if (at === sampleAt || !name) return;
      const raw = (row[at] ?? '').trim();
      if (!raw) return;
      const value = num(raw);
      if (value === null) return;                      // dates and user names
      const unit = /\(([^)]+)\)/.exec(name)?.[1];
      readings.push({
        well: null,
        sample,
        measure: name.replace(/\s*\([^)]*\)\s*/, '').trim(),
        value,
        ...(unit ? { unit } : {}),
      });
    });
  }

  if (readings.length === 0) problems.push('A NanoDrop header, but no rows of numbers under it.');
  return { instrument: 'nanodrop', readings, preamble: rows.slice(0, headerAt).map(r => r.join(' ').trim()).filter(Boolean), problems };
}

/**
 * A qPCR run's Cq table.
 *
 * "Undetermined" and an empty Cq are kept as readings with no value, because
 * they are the result -- a well that never crossed the threshold is a negative,
 * and dropping it turns a clean negative control into a well nobody ran.
 */
export function parseQpcr(text: string): ParseResult {
  const delimiter = sniffDelimiter(text);
  const { rows } = parseCsv(text, { delimiter });
  const problems: string[] = [];

  const headerAt = rows.findIndex(r => r.some(c => /^c[qt]( mean)?$/i.test(c.trim())));
  if (headerAt === -1) return { instrument: 'qpcr', readings: [], preamble: [], problems: ['No Cq or Ct column.'] };

  const header = rows[headerAt].map(c => c.trim());
  const at = (re: RegExp) => header.findIndex(c => re.test(c));
  const wellAt = at(/^well$/i);
  const sampleAt = at(/^(sample|sample name|content)$/i);
  /*
   * In order of usefulness, not in column order. A Bio-Rad table has Fluor
   * before Target, and taking the first match names every reading after the
   * dye -- "Cq (SYBR)" on every row -- which is exactly the information the
   * target column was there to carry.
   */
  const targetAt = [/^target( name)?$/i, /^detector$/i, /^fluor$/i]
    .map(re => at(re)).find(i => i !== -1) ?? -1;
  const cqAt = at(/^c[qt]( mean)?$/i);

  const readings: Reading[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(c => !c.trim())) continue;
    const raw = (row[cqAt] ?? '').trim();
    const well = wellAt === -1 ? null : normaliseWell(row[wellAt] ?? '');
    const sample = sampleAt === -1 ? null : (row[sampleAt] ?? '').trim() || null;
    const target = targetAt === -1 ? null : (row[targetAt] ?? '').trim() || null;
    if (!well && !sample) continue;

    const value = num(raw);
    readings.push({
      well,
      sample,
      measure: target ? `Cq (${target})` : 'Cq',
      value,
      ...(value === null && raw ? { extra: { raw } } : {}),
    });
  }

  if (readings.length === 0) problems.push('A Cq column, but no wells under it.');
  return { instrument: 'qpcr', readings, preamble: rows.slice(0, headerAt).map(r => r.join(' ').trim()).filter(Boolean), problems };
}

// ─── What was measured ───────────────────────────────────────────────────────

export interface MeasureSummary {
  measure: string;
  count: number;
  /** Readings with no number: overflows, undetermined wells. */
  blank: number;
  min: number | null;
  max: number | null;
  unit?: string;
}

/**
 * What is in the file, by measurement.
 *
 * Shown before anything is imported, because the question somebody has in
 * front of an instrument export is "did it read what I think it read", and a
 * range answers that faster than a table of 96 numbers.
 */
export function summarise(readings: Reading[]): MeasureSummary[] {
  const by = new Map<string, MeasureSummary>();
  for (const r of readings) {
    const s = by.get(r.measure) ?? { measure: r.measure, count: 0, blank: 0, min: null, max: null, unit: r.unit };
    s.count++;
    if (r.value === null) s.blank++;
    else {
      s.min = s.min === null ? r.value : Math.min(s.min, r.value);
      s.max = s.max === null ? r.value : Math.max(s.max, r.value);
    }
    by.set(r.measure, s);
  }
  return [...by.values()];
}

/** The readings for one measurement, laid out as a plate. */
export function asPlate(readings: Reading[], measure: string): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const r of readings) {
    if (r.measure !== measure || !r.well) continue;
    out.set(r.well, r.value);
  }
  return out;
}
