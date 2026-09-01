/**
 * The typed-field engine.
 *
 * Two features need the same thing: a lab-defined set of typed fields, values
 * validated against it, and those values stored somewhere queryable. Custom
 * entity types need it, and so do structured assay results. Writing it twice
 * would mean two validators that agree on the day they are written and drift
 * from then on, so it is written once and both use it.
 *
 * Values are stored in typed columns rather than a JSON blob. That is the whole
 * point: a custom "OD600" field is only worth having if "every well above 0.8"
 * is a query. JSON would have been less code and would have quietly made every
 * custom field a second-class one.
 */

export const FIELD_TYPES = [
  'text', 'longtext', 'number', 'integer', 'boolean', 'date',
  'select', 'multiselect', 'link', 'sequence', 'sample',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  integer: 'Whole number',
  boolean: 'Yes / no',
  date: 'Date',
  select: 'One of a list',
  multiselect: 'Several of a list',
  link: 'Link to another record',
  sequence: 'Link to a sequence',
  sample: 'Link to a sample',
};

/** Types whose value is a reference to another record rather than a literal. */
export const REFERENCE_TYPES: FieldType[] = ['link', 'sequence', 'sample'];

/**
 * Separator for multiselect values inside the single text column.
 *
 * A unit separator rather than a comma: options are lab-authored strings, and
 * "Amp, Kan" is a perfectly reasonable thing for someone to type as a single
 * option. Splitting on a comma would silently turn that one option into two.
 */
export const MULTI_SEP = '\u001F';

export interface FieldDefinition {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  isUnique?: boolean;
  /** Permitted values for select and multiselect. */
  options?: string[] | null;
  /** Entity type this points at, for link fields. */
  linkTypeId?: string | null;
  unit?: string | null;
  helpText?: string | null;
  order?: number;
}

/** The shape a value takes in the FieldValue columns. */
export interface StoredValue {
  text: string | null;
  number: number | null;
  boolean: boolean | null;
  date: Date | null;
  refId: string | null;
  refEntityId: string | null;
}

export const EMPTY: StoredValue = {
  text: null, number: null, boolean: null, date: null, refId: null, refEntityId: null,
};

/**
 * A field key, derived from a label.
 *
 * Keys are stable and labels are not: renaming "OD" to "OD600" must not orphan
 * a year of readings. So the key is generated once, at creation, and never
 * regenerated from the label afterwards.
 */
export function keyFromLabel(label: string): string {
  const base = label
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  // A label of only punctuation would produce an empty key, which would then
  // collide with the next one.
  const cleaned = base || 'field';
  // Keys must start with a letter; a label like "600 nm" would otherwise give
  // "600_nm", which is not a usable identifier.
  return /^[a-z]/.test(cleaned) ? cleaned : `f_${cleaned}`;
}

/** Make `key` unique among `taken`, by suffixing. */
export function uniqueKey(key: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(key)) return key;
  for (let n = 2; ; n++) {
    const candidate = `${key}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface FieldProblem {
  key: string;
  label: string;
  message: string;
}

/** Reject a field definition that cannot work, before it reaches the database. */
export function validateDefinition(def: FieldDefinition): string[] {
  const problems: string[] = [];
  if (!def.label.trim()) problems.push('A field needs a label.');
  if (!FIELD_TYPES.includes(def.type)) problems.push(`"${def.type}" is not a field type.`);
  if (!/^[a-z][a-z0-9_]*$/.test(def.key)) {
    problems.push(`"${def.key}" is not a usable key — letters, digits and underscores, starting with a letter.`);
  }
  if (def.type === 'select' || def.type === 'multiselect') {
    const opts = def.options ?? [];
    if (opts.length === 0) problems.push(`"${def.label}" is a list field with no options to choose from.`);
    if (new Set(opts).size !== opts.length) problems.push(`"${def.label}" has duplicate options.`);
    // An option carrying the separator would come back out as two options.
    if (opts.some(o => o.includes(MULTI_SEP))) {
      problems.push(`"${def.label}" has an option containing a control character.`);
    }
  }
  if (def.type === 'link' && !def.linkTypeId) {
    problems.push(`"${def.label}" links to another record but does not say which type.`);
  }
  // A multiselect cannot be unique in any meaningful sense, and a boolean
  // unique across more than two records is a contradiction.
  if (def.isUnique && (def.type === 'multiselect' || def.type === 'boolean')) {
    problems.push(`"${def.label}" cannot be unique — a ${def.type} field has too few distinct values.`);
  }
  return problems;
}

/**
 * Turn what a form submitted into what the columns hold.
 *
 * Returns the stored shape, or a message saying why the input is not
 * acceptable. Blank input for an optional field is a value — the empty one —
 * not an error; blank for a required field is an error.
 */
export function coerce(def: FieldDefinition, raw: unknown): { value: StoredValue } | { error: string } {
  const blank = raw === null || raw === undefined || raw === '' ||
    (Array.isArray(raw) && raw.length === 0);

  if (blank) {
    if (def.required) return { error: `${def.label} is required.` };
    return { value: { ...EMPTY } };
  }

  switch (def.type) {
    case 'text':
    case 'longtext':
      return { value: { ...EMPTY, text: String(raw) } };

    case 'number':
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { error: `${def.label} must be a number.` };
      if (def.type === 'integer' && !Number.isInteger(n)) {
        return { error: `${def.label} must be a whole number.` };
      }
      return { value: { ...EMPTY, number: n } };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { value: { ...EMPTY, boolean: raw } };
      const s = String(raw).toLowerCase();
      if (['true', 'yes', 'on', '1'].includes(s)) return { value: { ...EMPTY, boolean: true } };
      if (['false', 'no', 'off', '0'].includes(s)) return { value: { ...EMPTY, boolean: false } };
      return { error: `${def.label} must be yes or no.` };
    }

    case 'date': {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (Number.isNaN(d.getTime())) return { error: `${def.label} is not a date.` };
      return { value: { ...EMPTY, date: d } };
    }

    case 'select': {
      const s = String(raw);
      if (!(def.options ?? []).includes(s)) {
        return { error: `${def.label} must be one of: ${(def.options ?? []).join(', ')}.` };
      }
      return { value: { ...EMPTY, text: s } };
    }

    case 'multiselect': {
      const list = Array.isArray(raw)
        ? raw.map(String)
        : String(raw).split(MULTI_SEP).map(s => s.trim()).filter(Boolean);
      const allowed = def.options ?? [];
      const bad = list.filter(v => !allowed.includes(v));
      if (bad.length) return { error: `${def.label}: ${bad.join(', ')} not in the list.` };
      if (new Set(list).size !== list.length) return { error: `${def.label} has the same option twice.` };
      return { value: { ...EMPTY, text: list.join(MULTI_SEP) } };
    }

    case 'link':
      return { value: { ...EMPTY, refEntityId: String(raw), refId: String(raw) } };

    case 'sequence':
    case 'sample':
      return { value: { ...EMPTY, refId: String(raw) } };
  }
}

/** Read a stored value back as something a form or a page can use. */
export function decode(def: FieldDefinition, v: Partial<StoredValue> | null | undefined): unknown {
  if (!v) return null;
  switch (def.type) {
    case 'text':
    case 'longtext':
    case 'select':
      return v.text ?? null;
    case 'multiselect':
      return v.text ? v.text.split(MULTI_SEP) : [];
    case 'number':
    case 'integer':
      return v.number ?? null;
    case 'boolean':
      return v.boolean ?? null;
    case 'date':
      return v.date ?? null;
    case 'link':
      return v.refEntityId ?? null;
    case 'sequence':
    case 'sample':
      return v.refId ?? null;
  }
}

/** How a value should read on a page. */
export function format(def: FieldDefinition, v: Partial<StoredValue> | null | undefined): string {
  const decoded = decode(def, v);
  if (decoded === null || decoded === undefined || decoded === '') return '—';
  if (Array.isArray(decoded) && decoded.length === 0) return '—';
  switch (def.type) {
    case 'boolean':
      return decoded ? 'Yes' : 'No';
    case 'date':
      return (decoded as Date).toLocaleDateString();
    case 'multiselect':
      return (decoded as string[]).join(', ');
    case 'number':
    case 'integer':
      return `${decoded}${def.unit ? ` ${def.unit}` : ''}`;
    case 'link':
    case 'sequence':
    case 'sample':
      // The display name captured at write time beats the raw id.
      return v?.text ?? String(decoded);
    default:
      return `${decoded}${def.unit ? ` ${def.unit}` : ''}`;
  }
}

/**
 * Coerce a whole record's worth of input.
 *
 * All fields are attempted even after the first failure, so a form comes back
 * with every problem at once rather than one per round trip.
 */
export function coerceRecord(
  defs: FieldDefinition[], input: Record<string, unknown>,
): { values: Record<string, StoredValue> } | { errors: FieldProblem[] } {
  const values: Record<string, StoredValue> = {};
  const errors: FieldProblem[] = [];

  for (const def of defs) {
    const r = coerce(def, input[def.key]);
    if ('error' in r) errors.push({ key: def.key, label: def.label, message: r.error });
    else values[def.key] = r.value;
  }
  return errors.length ? { errors } : { values };
}

/** The column a value of this type lives in, for building queries. */
export function columnFor(type: FieldType): keyof StoredValue {
  switch (type) {
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'link': return 'refEntityId';
    case 'sequence':
    case 'sample': return 'refId';
    default: return 'text';
  }
}

/**
 * The next code for a type, given the codes already issued.
 *
 * Counts from the highest number used rather than from how many exist: after a
 * record is deleted, reusing its code would put two different things under one
 * identifier on two different tubes.
 */
export function nextCode(prefix: string, existing: string[]): string {
  let highest = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const code of existing) {
    const m = re.exec(code);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`;
}

/** Prefixes are printed on labels, so they are constrained on purpose. */
export function validatePrefix(prefix: string): string | null {
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(prefix)) {
    return 'A prefix is 2 to 6 characters, capitals and digits, starting with a letter.';
  }
  return null;
}
