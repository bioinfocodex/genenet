import { findBindings, type PrimerBinding } from './primer-binding';
import { nnTm } from './tm';

/**
 * The lab's oligo collection.
 *
 * Primers were stored against one sequence each, which is not how a lab holds
 * them. An oligo is ordered once, sits in a box, and gets used on every
 * template it happens to anneal to: the M13 primers on half the plasmids in
 * the library, a gene-specific pair on the backbone it was cloned into and
 * every derivative after. "Which of my oligos bind this?" and "what does this
 * oligo bind?" are the two questions, and neither has an answer while each
 * primer belongs to a single record.
 *
 * So an oligo here belongs to the lab, and where it binds is computed, never
 * stored. Stored positions go stale the moment someone edits a plasmid;
 * computed ones cannot.
 */

export const OLIGO_PREFIX = 'OL';

/** Shorter than this and a "binding" is chance; longer and it is not an oligo. */
export const MIN_OLIGO = 8;
export const MAX_OLIGO = 250;

/**
 * Shortest 3' match counted as binding when searching the whole library.
 *
 * Higher than the per-sequence default, on purpose: across hundreds of
 * sequences a 12-base partial match turns up by chance often enough to bury
 * the real sites in noise, and 15 is still well under any annealing region
 * someone would design.
 */
export const LIBRARY_MIN_ANNEAL = 15;

const IUPAC = /[^ACGTRYKMSWBDHVN]/g;

/** Uppercase, U to T, everything that is not a base removed. */
export function cleanOligo(raw: string): string {
  return raw.toUpperCase().replace(/U/g, 'T').replace(IUPAC, '');
}

/** What is wrong with an oligo sequence, or null. */
export function validateOligo(seq: string): string | null {
  if (seq.length < MIN_OLIGO) return `An oligo needs at least ${MIN_OLIGO} bases.`;
  if (seq.length > MAX_OLIGO) return `${seq.length} bases is a fragment, not an oligo. Add it as a sequence instead.`;
  return null;
}

export interface OligoStats {
  length: number;
  /** Percent, one decimal. */
  gc: number;
  /** °C, nearest neighbour, whole oligo. NaN when it carries ambiguity codes. */
  tm: number;
}

export function oligoStats(seq: string): OligoStats {
  const s = cleanOligo(seq);
  const gc = s.length ? ((s.match(/[GC]/g) ?? []).length / s.length) * 100 : 0;
  return { length: s.length, gc: Math.round(gc * 10) / 10, tm: Math.round(nnTm(s) * 10) / 10 };
}

/**
 * An oligo already in the collection with this exact sequence.
 *
 * Two tubes of one oligo under two names is how a lab ends up ordering it a
 * third time. The reverse complement is a different oligo -- it primes the
 * other way -- so it is not a duplicate.
 */
export function findDuplicate<T extends { sequence: string }>(seq: string, existing: T[]): T | undefined {
  const s = cleanOligo(seq);
  return existing.find(o => cleanOligo(o.sequence) === s);
}

export interface OligoRow {
  name: string;
  sequence: string;
  notes?: string;
}

export interface ParsedList {
  rows: OligoRow[];
  /** 1-based line numbers with what was wrong, so the paste can be fixed. */
  problems: { line: number; message: string }[];
}

/**
 * Read a pasted list: one oligo per line, name then sequence, separated by a
 * tab (what a spreadsheet copies), a comma, or whitespace. A third column is
 * kept as notes. A header row is recognised by its second column not being
 * a sequence, and skipped.
 */
export function parseOligoList(text: string): ParsedList {
  const rows: OligoRow[] = [];
  const problems: ParsedList['problems'] = [];

  let first = true;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const isFirst = first;
    first = false;

    const parts = line.includes('\t')
      ? line.split('\t')
      : line.includes(',')
        ? line.split(',')
        : line.split(/\s+/);
    const [name = '', seqRaw = '', ...rest] = parts.map(p => p.trim().replace(/^"|"$/g, ''));

    // "Name / Sequence" headers, and the 5'- -3' decoration people paste.
    const seqField = seqRaw.replace(/^5['′]-?/, '').replace(/-?3['′]$/, '');
    const looksLikeDna = /^[ACGTURYKMSWBDHVN\s-]+$/i.test(seqField);
    if (isFirst && !looksLikeDna) return;

    if (!name || !seqField) {
      problems.push({ line: i + 1, message: 'Expected a name and a sequence.' });
      return;
    }
    if (!looksLikeDna) {
      problems.push({ line: i + 1, message: `"${seqField.slice(0, 20)}" is not a DNA sequence.` });
      return;
    }
    const sequence = cleanOligo(seqField);
    const problem = validateOligo(sequence);
    if (problem) {
      problems.push({ line: i + 1, message: problem });
      return;
    }
    rows.push({ name, sequence, notes: rest.join(' ').trim() || undefined });
  });

  return { rows, problems };
}

// ─── Where oligos bind ────────────────────────────────────────────────────────

export interface LibraryTemplate {
  id: string;
  name: string;
  sequence: string;
  circular: boolean;
}

export interface LibraryBinding {
  sequenceId: string;
  sequenceName: string;
  sites: PrimerBinding[];
  /** Longest anneal among the sites, for ranking. */
  best: number;
  /** True when the whole oligo, tail included, matches somewhere. */
  exact: boolean;
}

/**
 * Every sequence in the library an oligo anneals to.
 *
 * Exact full-length matches come first -- that is the template it was
 * designed against -- then by how much of the 3' end anneals. More than one
 * site on one template is kept and shown, because it is the reason a PCR gives
 * two bands.
 */
export function bindingsInLibrary(
  oligo: string,
  library: LibraryTemplate[],
  minAnneal = LIBRARY_MIN_ANNEAL,
): LibraryBinding[] {
  const out: LibraryBinding[] = [];
  for (const t of library) {
    const sites = findBindings(oligo, t.sequence, { circular: t.circular, minAnneal });
    if (!sites.length) continue;
    out.push({
      sequenceId: t.id,
      sequenceName: t.name,
      sites,
      best: Math.max(...sites.map(s => s.annealLength)),
      exact: sites.some(s => s.exact),
    });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.best - a.best || a.sequenceName.localeCompare(b.sequenceName));
}

export interface CollectionOligo {
  id: string;
  code: string;
  name: string;
  sequence: string;
}

export interface CollectionSite extends PrimerBinding {
  oligoId: string;
  code: string;
  name: string;
}

/** Every oligo in the collection that anneals to one template, and where. */
export function collectionOnTemplate(
  oligos: CollectionOligo[],
  template: string,
  circular: boolean,
  minAnneal = LIBRARY_MIN_ANNEAL,
): CollectionSite[] {
  const out: CollectionSite[] = [];
  for (const o of oligos) {
    for (const site of findBindings(o.sequence, template, { circular, minAnneal })) {
      out.push({ ...site, oligoId: o.id, code: o.code, name: o.name });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
