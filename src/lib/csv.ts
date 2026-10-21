/**
 * Reading the spreadsheet somebody actually has.
 *
 * Not a general CSV library: a reader for the files that arrive in a lab,
 * which are exports from Excel, Google Sheets and whatever the freezer
 * supplier's software writes. The awkward parts are all real.
 *
 * A UTF-8 CSV saved by Excel begins with a byte order mark, so the first
 * column of the header is called "﻿Name" and matches nothing.
 *
 * Excel writes semicolons rather than commas wherever the operating system's
 * list separator is a semicolon, which is most of continental Europe. The file
 * is still called .csv. Read with a comma it is one column wide, and the
 * failure looks like the file being empty rather than like a separator.
 *
 * A field containing a comma, a quote or a line break is quoted, and a quote
 * inside a quoted field is doubled. A row can therefore span several lines,
 * which means splitting on newlines before parsing is wrong.
 */

export interface CsvTable {
  /** The header row, trimmed, with the byte order mark gone. */
  header: string[];
  /**
   * One entry per row, in file order, each carrying the line it came from.
   *
   * The line is kept rather than inferred from the position, because blank
   * lines are dropped: without it, every row after a blank one is reported
   * against the wrong line of the spreadsheet, which is the one thing a
   * line-by-line preview must not get wrong.
   */
  rows: { line: number; cells: string[] }[];
  /** The separator that was used. */
  delimiter: string;
  /**
   * Rows whose column count does not match the header.
   *
   * Reported rather than padded or truncated. A row with an extra comma in it
   * is usually an unquoted field, and silently shifting every column after it
   * puts a freezer name in the concentration.
   */
  ragged: { line: number; got: number }[];
}

const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Which separator the file uses.
 *
 * Decided on the header line alone, by which candidate splits it into the most
 * fields. Counting over the whole file would be swayed by commas inside prose
 * in a notes column; the header is the one line that is reliably all
 * separators and short words.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r\n|\n|\r/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    // Counted with the parser rather than by splitting, so a quoted header
    // like "Name, full" does not make the comma look like a separator.
    const count = parseLine(firstLine, d).length;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** One line, when it is known not to contain a quoted line break. */
function parseLine(line: string, delimiter: string): string[] {
  return parseCsv(line, { delimiter }).rows[0] ?? (line ? [line] : []);
}

export interface CsvOptions {
  delimiter?: string;
}

/**
 * Parse a whole file into rows, without a header.
 *
 * A single pass over the characters rather than a split, because a quoted
 * field may contain the delimiter and may contain a newline.
 */
export function parseCsv(text: string, opts: CsvOptions = {}): { rows: string[][]; delimiter: string } {
  const s = stripBom(text);
  const delimiter = opts.delimiter ?? sniffDelimiter(s);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let any = false;           // whether the current row has any content at all

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // a doubled quote is one quote
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && field === '') { quoted = true; any = true; continue; }

    if (c === delimiter) { row.push(field); field = ''; any = true; continue; }

    if (c === '\r' || c === '\n') {
      // CRLF is one break, not two.
      if (c === '\r' && s[i + 1] === '\n') i++;
      if (any || field !== '') { row.push(field); rows.push(row); }
      row = []; field = ''; any = false;
      continue;
    }

    field += c;
    any = true;
  }
  if (any || field !== '') { row.push(field); rows.push(row); }

  return { rows, delimiter };
}

/** Parse with the first row taken as column names. */
export function parseTable(text: string, opts: CsvOptions = {}): CsvTable {
  const { rows, delimiter } = parseCsv(text, opts);
  if (rows.length === 0) return { header: [], rows: [], delimiter, ragged: [] };

  const header = rows[0].map(h => h.trim());
  const body = rows.slice(1);
  const ragged: { line: number; got: number }[] = [];

  const out: { line: number; cells: string[] }[] = [];
  body.forEach((r, i) => {
    const line = i + 2;                       // the header is line 1
    // A row of nothing but empty fields is a blank line, not a row.
    if (r.every(v => v.trim() === '')) return;
    if (r.length !== header.length) ragged.push({ line, got: r.length });
    out.push({ line, cells: r });
  });

  return { header, rows: out, delimiter, ragged };
}

// ─── Matching columns to fields ──────────────────────────────────────────────

export interface ColumnSpec {
  /** The field this fills. */
  field: string;
  /** What to call it on screen. */
  label: string;
  /** Header spellings that mean this field, lower case, punctuation removed. */
  aliases: string[];
  required?: boolean;
}

/** Lower case, and everything that is not a letter or digit removed. */
export const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which column fills which field.
 *
 * Matched on a normalised spelling, so "Sample ID", "sample_id" and "SampleID"
 * are the same column. Unmatched headers are returned rather than ignored: a
 * spreadsheet with a column nobody reads is usually a column somebody expected
 * to be read, and saying so is the difference between an import that is wrong
 * and one that is explained.
 */
export function matchColumns(header: string[], specs: ColumnSpec[]): {
  mapping: Record<string, number>;
  unmatched: string[];
  missing: ColumnSpec[];
} {
  const mapping: Record<string, number> = {};
  const used = new Set<number>();

  for (const spec of specs) {
    const wanted = new Set([normaliseHeader(spec.field), ...spec.aliases.map(normaliseHeader)]);
    const at = header.findIndex((h, i) => !used.has(i) && wanted.has(normaliseHeader(h)));
    if (at !== -1) { mapping[spec.field] = at; used.add(at); }
  }

  return {
    mapping,
    unmatched: header.filter((h, i) => !used.has(i) && h.trim() !== ''),
    missing: specs.filter(s => s.required && !(s.field in mapping)),
  };
}

// ─── What an import would do ─────────────────────────────────────────────────

export type RowVerdict = 'create' | 'update' | 'reject';

export interface PlannedRow<T> {
  /** The line in the file, counting the header as line 1. */
  line: number;
  verdict: RowVerdict;
  /** The parsed record, where the row could be read at all. */
  value?: T;
  /** Why it is rejected, or what an update would change. */
  notes: string[];
  /** The key this row matched an existing record by. */
  key?: string;
}

export interface Plan<T> {
  rows: PlannedRow<T>[];
  counts: Record<RowVerdict, number>;
  /** Headers in the file that nothing reads. */
  unmatched: string[];
  /** Required columns the file does not have. */
  missing: ColumnSpec[];
  ragged: { line: number; got: number }[];
  delimiter: string;
}

/**
 * Work out what an import would do, without doing any of it.
 *
 * The whole point is that this runs first and is shown. An import that reports
 * "47 rows imported" after the fact is one nobody can check; a list saying
 * which line creates what, which line updates what and which line is refused
 * and why can be read before anything is written.
 *
 * Duplicate keys inside one file are caught here too. A spreadsheet with the
 * same tube on two lines is common -- somebody pasted a block twice -- and
 * without this the second line silently overwrites the first.
 */
export function planRows<T>(
  table: CsvTable,
  specs: ColumnSpec[],
  read: (get: (field: string) => string, line: number) => { value: T; key?: string } | { error: string },
  existingKeys: Set<string>,
): Plan<T> {
  const { mapping, unmatched, missing } = matchColumns(table.header, specs);
  const counts: Record<RowVerdict, number> = { create: 0, update: 0, reject: 0 };
  const rows: PlannedRow<T>[] = [];
  const seen = new Map<string, number>();

  table.rows.forEach(({ line, cells }) => {
    const get = (field: string) => {
      const at = mapping[field];
      return at === undefined ? '' : (cells[at] ?? '').trim();
    };

    if (missing.length) {
      rows.push({ line, verdict: 'reject', notes: [`The file has no ${missing.map(m => m.label).join(' or ')} column.`] });
      counts.reject++;
      return;
    }

    const result = read(get, line);
    if ('error' in result) {
      rows.push({ line, verdict: 'reject', notes: [result.error] });
      counts.reject++;
      return;
    }

    const { value, key } = result;
    const notes: string[] = [];

    if (key) {
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        rows.push({ line, verdict: 'reject', key, notes: [`${key} is already on line ${earlier}.`] });
        counts.reject++;
        return;
      }
      seen.set(key, line);
    }

    const verdict: RowVerdict = key && existingKeys.has(key) ? 'update' : 'create';
    if (verdict === 'update') notes.push(`${key} exists and would be updated.`);
    rows.push({ line, verdict, value, key, notes });
    counts[verdict]++;
  });

  return { rows, counts, unmatched, missing, ragged: table.ragged, delimiter: table.delimiter };
}

// ─── Writing one back out ────────────────────────────────────────────────────

/** Quote a field only where it needs it, which keeps a hand-read file readable. */
export function csvField(value: string, delimiter = ','): string {
  if (value === '') return '';
  return /["\r\n]/.test(value) || value.includes(delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function toCsv(header: string[], rows: string[][], delimiter = ','): string {
  const lines = [header, ...rows].map(r => r.map(v => csvField(v ?? '', delimiter)).join(delimiter));
  /*
   * CRLF, because that is what every spreadsheet writes and what Excel on
   * Windows needs to see rows rather than one long cell.
   */
  return lines.join('\r\n') + '\r\n';
}
