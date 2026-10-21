import {
  parseTable, planRows, toCsv, type ColumnSpec, type Plan,
} from './csv';
import { parseQuantity, parseConcentration, format, formatConcentration } from './quantities';

/**
 * A box of tubes, from the spreadsheet it already lives in.
 *
 * Every lab has this file. It is how the freezer was recorded before there was
 * anywhere better, and no inventory is worth anything if the way in is typing
 * eighty-one rows again.
 *
 * Nothing here writes. It reads a file and says what importing it would do,
 * line by line; the caller shows that and asks. An import that reports
 * "47 rows imported" afterwards is one nobody can check.
 */

export const SAMPLE_TYPES = ['PLASMID', 'LINEAR_DNA', 'GLYCEROL_STOCK', 'OTHER'] as const;
export type SampleType = typeof SAMPLE_TYPES[number];

/*
 * The spellings a real file uses. "Tube", "Vial" and "ID" all mean the code;
 * "Conc" and "Concentration" the same column. Matched case- and
 * punctuation-insensitively, so "Sample ID" and "sample_id" need not both be
 * listed.
 */
export const SAMPLE_COLUMNS: ColumnSpec[] = [
  { field: 'sampleId', label: 'Sample ID', aliases: ['id', 'code', 'tube', 'vial', 'barcode', 'sample'] },
  { field: 'name', label: 'Name', aliases: ['description', 'label', 'contents', 'construct'], required: true },
  { field: 'type', label: 'Type', aliases: ['kind', 'category', 'sampletype'] },
  { field: 'notes', label: 'Notes', aliases: ['comment', 'comments', 'remarks'] },
  { field: 'freezer', label: 'Freezer', aliases: ['storage', 'location', 'unit'] },
  { field: 'rack', label: 'Rack', aliases: ['shelf', 'drawer', 'tower'] },
  { field: 'box', label: 'Box', aliases: ['boxname', 'rackbox'] },
  { field: 'position', label: 'Position', aliases: ['well', 'slot', 'cell', 'coordinate'] },
  { field: 'amount', label: 'Amount', aliases: ['volume', 'quantity', 'vol', 'qty'] },
  { field: 'concentration', label: 'Concentration', aliases: ['conc', 'conc.'] },
  { field: 'lot', label: 'Lot', aliases: ['batch', 'lotnumber'] },
  { field: 'expires', label: 'Expires', aliases: ['expiry', 'expirydate', 'useby', 'expiration'] },
];

export interface ImportedSample {
  sampleId?: string;
  name: string;
  type: SampleType;
  notes?: string;
  freezer?: string;
  rack?: string;
  box?: string;
  position?: string;
  amount?: number;
  amountUnit?: string;
  concValue?: number;
  concPer?: string;
  concVolume?: string;
  lot?: string;
  expiresAt?: string;
}

/** The words a spreadsheet uses for a type, against the four this stores. */
const TYPE_WORDS: Record<string, SampleType> = {
  plasmid: 'PLASMID', dna: 'LINEAR_DNA', lineardna: 'LINEAR_DNA', linear: 'LINEAR_DNA',
  pcr: 'LINEAR_DNA', fragment: 'LINEAR_DNA', insert: 'LINEAR_DNA',
  glycerol: 'GLYCEROL_STOCK', glycerolstock: 'GLYCEROL_STOCK', stock: 'GLYCEROL_STOCK',
  stab: 'GLYCEROL_STOCK', cells: 'GLYCEROL_STOCK',
  other: 'OTHER', misc: 'OTHER',
};

function readType(raw: string): SampleType | null {
  if (!raw) return 'OTHER';
  if (SAMPLE_TYPES.includes(raw.toUpperCase() as SampleType)) return raw.toUpperCase() as SampleType;

  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (TYPE_WORDS[key]) return TYPE_WORDS[key];

  /*
   * Then word by word, because a spreadsheet says "PCR product" and "Glycerol
   * stock" rather than one word. Taken in the order written, so the first
   * word that means something decides -- "linear DNA" is linear DNA by its
   * first word, and would be by its second too.
   */
  for (const word of raw.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    if (TYPE_WORDS[word]) return TYPE_WORDS[word];
  }
  return null;
}

/**
 * A date, from the forms a spreadsheet exports.
 *
 * ISO is taken as written. Anything with slashes is ambiguous -- 03/04/2026 is
 * two different days either side of the Atlantic -- so it is refused rather
 * than guessed at. An expiry a year out is not a thing to guess.
 */
function readDate(raw: string): { value: string } | { error: string } | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) {
    const d = new Date(`${raw.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return { error: `"${raw}" is not a date.` };
    return { value: d.toISOString() };
  }
  if (/\d+[/.]\d+[/.]\d+/.test(raw)) {
    return { error: `"${raw}" could be two different dates depending on where it was written. Use YYYY-MM-DD.` };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `"${raw}" is not a date.` };
  return { value: d.toISOString() };
}

/** A1 to P24, which covers every box and plate this handles. */
const POSITION = /^[A-Pa-p](?:[1-9]|1\d|2[0-4])$/;

export function planSampleImport(text: string, existingIds: Set<string>): Plan<ImportedSample> {
  const table = parseTable(text);
  return planRows<ImportedSample>(table, SAMPLE_COLUMNS, (get) => {
    const name = get('name');
    if (!name) return { error: 'No name.' };

    const type = readType(get('type'));
    if (!type) return { error: `"${get('type')}" is not a sample type this knows.` };

    const value: ImportedSample = { name, type };

    const code = get('sampleId');
    if (code) {
      /*
       * A code is what the row is matched on, so a code that cannot be
       * scanned later is worth refusing now rather than printing a label
       * nobody can read off.
       */
      if (!/^[\x20-\x7e]+$/.test(code)) return { error: `"${code}" has characters a barcode cannot carry.` };
      value.sampleId = code;
    }

    for (const f of ['notes', 'freezer', 'rack', 'box', 'lot'] as const) {
      const v = get(f);
      if (v) value[f] = v;
    }

    const position = get('position');
    if (position) {
      if (!POSITION.test(position)) {
        return { error: `"${position}" is not a position in a box; they look like A1 or H12.` };
      }
      value.position = position.toUpperCase();
    }

    const amount = get('amount');
    if (amount) {
      const q = parseQuantity(amount);
      if (!q) return { error: `"${amount}" is not an amount. Try 50 µL, 10 µg, or 3 tubes.` };
      if (q.value <= 0) return { error: `An amount has to be more than nothing, and this says ${amount}.` };
      value.amount = q.value;
      value.amountUnit = q.unit;
    }

    const conc = get('concentration');
    if (conc) {
      const c = parseConcentration(conc);
      if (!c) return { error: `"${conc}" is not a concentration. Try 200 ng/µL or 100 µM.` };
      if (c.value <= 0) return { error: 'A concentration has to be more than nothing.' };
      value.concValue = c.value;
      value.concPer = c.per;
      value.concVolume = c.volume;
    }

    const expires = readDate(get('expires'));
    if (expires && 'error' in expires) return { error: expires.error };
    if (expires) value.expiresAt = expires.value;

    return { value, key: value.sampleId };
  }, existingIds);
}

/** A one-line summary of a row, for the preview table. */
export function describeSample(s: ImportedSample): string {
  const bits = [s.name];
  if (s.amount !== undefined && s.amountUnit) bits.push(format({ value: s.amount, unit: s.amountUnit }));
  if (s.concValue && s.concPer && s.concVolume) {
    bits.push(formatConcentration({ value: s.concValue, per: s.concPer, volume: s.concVolume }));
  }
  const where = [s.freezer, s.box, s.position].filter(Boolean).join(' · ');
  if (where) bits.push(where);
  return bits.join(' — ');
}

/**
 * A file with the right columns in it, for somebody who has none.
 *
 * The quickest way to explain a format is to hand over one that works, filled
 * in with a row that shows what each column wants.
 */
export function sampleTemplate(): string {
  return toCsv(
    SAMPLE_COLUMNS.map(c => c.label),
    [
      ['PLA-001', 'pEGFP-N1 midiprep', 'Plasmid', 'from the 2026-03 prep', 'Minus 20 bench', 'R1', 'B2', 'A1', '50 uL', '200 ng/uL', 'L-4471', '2027-03-01'],
      ['', 'Competent cells DH5a', 'Glycerol stock', '', 'Minus 80', 'R3', 'Cells', 'B4', '81 tubes', '', '', ''],
    ],
  );
}
