/**
 * The shape an entry starts in.
 *
 * A blank box is the reason notebook entries get written as three lines and a
 * number. It is not that people cannot write; it is that nobody wants to
 * decide what the headings are at the moment they have a gel in one hand. A
 * template answers that once, for everybody, and the entry that comes out can
 * be read by somebody else a year later.
 *
 * Templates are text with placeholders, deliberately. The entry stays plain
 * Markdown that anybody can edit, delete from or ignore -- a form that
 * enforces its fields would be a different feature, and a worse one for a
 * notebook, where the thing worth recording is often the thing nobody planned
 * a field for.
 */

export interface TemplateField {
  /** Placeholder name, as it appears in the body between braces. */
  name: string;
  label: string;
  /** Offered in a dropdown when filling the template in. */
  options?: string[];
  placeholder?: string;
}

export interface EntryTemplate {
  id: string;
  name: string;
  /** What this template is for, shown when choosing one. */
  about: string;
  /** The entry's title, which may itself carry placeholders. */
  title: string;
  body: string;
  fields: TemplateField[];
}

/*
 * The shipped set. Four of the things a molecular biology lab does most, and
 * which are most often written up in a way nobody can repeat.
 *
 * Each ends with a section for what went wrong, because that is the part a
 * reader a year later actually needs and the part a blank box never gets.
 */
export const TEMPLATES: EntryTemplate[] = [
  {
    id: 'cloning',
    name: 'Cloning',
    about: 'A construct made: what went into it, how, and what came out.',
    title: 'Cloning — {construct}',
    fields: [
      { name: 'construct', label: 'Construct', placeholder: 'pEGFP-N1-tagged' },
      { name: 'method', label: 'Method', options: ['Restriction and ligation', 'Gibson', 'Golden Gate', 'In-Fusion', 'Gateway', 'TOPO', 'Site-directed mutagenesis'] },
    ],
    body: `## Aim

Make {construct} by {method}.

## Parts

| Part | Source | Amount |
| --- | --- | --- |
|  |  |  |

## Method

{method}. Conditions:

## Result

Colonies:
Screened by:
Confirmed by:

## What did not work

`,
  },
  {
    id: 'pcr',
    name: 'PCR',
    about: 'A reaction run: template, primers, conditions, and what the gel showed.',
    title: 'PCR — {target}',
    fields: [
      { name: 'target', label: 'Target', placeholder: 'EGFP insert' },
      { name: 'polymerase', label: 'Polymerase', options: ['Q5', 'Phusion', 'Taq', 'KOD', 'PrimeSTAR'] },
    ],
    body: `## Aim

Amplify {target}.

## Reaction

Template:
Primers:
Polymerase: {polymerase}
Expected product:

| Component | Volume |
| --- | --- |
| Template |  |
| Forward primer |  |
| Reverse primer |  |
| Master mix |  |
| Water |  |

## Cycling

Denature:
Anneal:
Extend:
Cycles:

## Gel

Expected:
Seen:

## What did not work

`,
  },
  {
    id: 'transformation',
    name: 'Transformation',
    about: 'DNA into cells: what, which strain, and how many came up.',
    title: 'Transformation — {construct} into {strain}',
    fields: [
      { name: 'construct', label: 'Construct', placeholder: 'pET28a-GFP' },
      { name: 'strain', label: 'Strain', options: ['DH5α', 'TOP10', 'BL21(DE3)', 'Stbl3', 'XL1-Blue', 'NEB 5-alpha'] },
    ],
    body: `## Aim

Transform {construct} into {strain}.

## Method

DNA:
Cells:
Heat shock:
Recovery:
Plated on:

## Result

Colonies:
Negative control:

## What did not work

`,
  },
  {
    id: 'blank',
    name: 'Blank',
    about: 'Headings only, for work that does not fit the others.',
    title: '',
    fields: [],
    body: `## Aim

## Method

## Result

## What did not work

`,
  },
];

export const templateById = (id: string) => TEMPLATES.find(t => t.id === id) ?? null;

/*
 * A placeholder is {name}: one word in braces, letters digits and underscore.
 * Deliberately narrow, so that a table of braces, a code block or a line of
 * JSON somebody pastes into a template body is not mistaken for one.
 */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The placeholders a piece of text actually uses, in order, without repeats. */
export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Fill a template in.
 *
 * A placeholder nobody filled is left as it was written rather than replaced
 * with a blank. An empty gap reads as a finished sentence missing a word; the
 * braces read as something still to do, which is what it is.
 */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = values[name];
    return v && v.trim() ? v.trim() : whole;
  });
}

export interface FilledEntry {
  title: string;
  body: string;
  /** Placeholders still unfilled, so the form can say so without refusing. */
  unfilled: string[];
}

export function applyTemplate(template: EntryTemplate, values: Record<string, string>): FilledEntry {
  const title = fill(template.title, values);
  const body = fill(template.body, values);
  return {
    title,
    body,
    unfilled: placeholdersIn(`${template.title}\n${template.body}`).filter(n => !values[n]?.trim()),
  };
}

/**
 * Whether an entry still looks like an untouched template.
 *
 * Used to warn before signing. A template signed with its headings empty is
 * worse than no entry: it looks like a record and contains nothing, and it is
 * the failure mode a template introduces that a blank box does not have.
 */
export function looksUnfilled(body: string, template: EntryTemplate): boolean {
  const strip = (s: string) => s.replace(/\s+/g, ' ').trim();
  return strip(body) === strip(template.body) || placeholdersIn(body).length > 0;
}
