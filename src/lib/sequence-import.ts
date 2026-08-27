/**
 * Reading sequence files.
 *
 * Sequences could only be typed or pasted, and the paste had to be FASTA with a
 * header or GenBank. A collaborator sending a .dna file, or a plasmid map with
 * features on the reverse strand, or an accession number, all ended the same
 * way: retype it.
 *
 * No 'server-only' here. These are pure parsers over text and bytes, so the
 * import screen can use them directly and they can be tested without a server.
 */

export interface ImportedFeature {
  name: string;
  type: string;
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, inclusive. */
  end: number;
  strand: '+' | '-';
  /** True when GenBank marked the extent uncertain with < or >. */
  partial?: boolean;
  /** Set when the feature is a join(): the ranges it is assembled from. */
  segments?: { start: number; end: number }[];
}

export interface ImportedSequence {
  name: string;
  description: string;
  sequence: string;
  circular: boolean;
  features: ImportedFeature[];
  /** Which reader produced this. */
  format: 'fasta' | 'genbank' | 'snapgene' | 'plain';
}

const IUPAC = /[^ACGTURYSWKMBDHVNacgturyswkmbdhvn]/g;

/** What kind of file this is, from its content rather than its extension. */
export function detectFormat(text: string): ImportedSequence['format'] | null {
  const t = text.trimStart();
  if (!t) return null;
  if (/^LOCUS\s/m.test(t.slice(0, 400))) return 'genbank';
  if (t.startsWith('>')) return 'fasta';
  // A bare sequence: mostly nucleotide letters and whitespace.
  const head = t.slice(0, 2000);
  const letters = head.replace(/\s/g, '');
  if (letters.length && letters.replace(IUPAC, '').length / letters.length > 0.9) return 'plain';
  return null;
}

// ─── GenBank locations ───────────────────────────────────────────────────────

export interface ParsedLocation {
  segments: { start: number; end: number }[];
  strand: '+' | '-';
  partial: boolean;
}

/**
 * A GenBank location descriptor.
 *
 * The old parser matched `123..456` with an optional leading `complement(`,
 * which quietly dropped every spliced feature and every feature whose extent is
 * uncertain. Real files contain join(), complement(join()), order(), and the
 * < and > markers for a feature that runs past the end of the record -- all of
 * which are ordinary in anything downloaded from NCBI.
 */
export function parseLocation(raw: string): ParsedLocation | null {
  let s = raw.trim();
  if (!s) return null;

  let strand: '+' | '-' = '+';
  // complement() may wrap the whole thing, including a join.
  const comp = s.match(/^complement\(([\s\S]*)\)$/);
  if (comp) { strand = '-'; s = comp[1].trim(); }

  // join() and order() both list ranges; order() only says they are not
  // necessarily contiguous, which does not change where they are.
  const grouped = s.match(/^(?:join|order)\(([\s\S]*)\)$/);
  const pieces = grouped ? splitTopLevel(grouped[1]) : [s];

  const segments: { start: number; end: number }[] = [];
  let partial = false;

  for (const piece of pieces) {
    let p = piece.trim();
    // A nested complement() inside a join marks that segment, and for our
    // purposes the feature as a whole reads on the reverse strand.
    const inner = p.match(/^complement\(([\s\S]*)\)$/);
    if (inner) { strand = '-'; p = inner[1].trim(); }

    if (p.includes('<') || p.includes('>')) partial = true;
    p = p.replace(/[<>]/g, '');

    // 1..500, or a single base, or the 1^2 between-bases form.
    const range = p.match(/^(\d+)\s*(?:\.\.|\^)\s*(\d+)$/);
    const single = p.match(/^(\d+)$/);
    if (range) {
      segments.push({ start: Number(range[1]) - 1, end: Number(range[2]) - 1 });
    } else if (single) {
      const n = Number(single[1]) - 1;
      segments.push({ start: n, end: n });
    } else {
      // A remote accession reference such as J00194.1:1..100 has no meaning
      // inside this record.
      continue;
    }
  }

  if (!segments.length) return null;
  return { segments, strand, partial };
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.filter(x => x.trim());
}

// ─── GenBank ─────────────────────────────────────────────────────────────────

/** Qualifiers worth using as a feature's display name, best first. */
const NAME_QUALIFIERS = ['gene', 'label', 'locus_tag', 'product', 'note', 'standard_name'];

export function parseGenBankFile(text: string): ImportedSequence | null {
  const t = text.replace(/\r\n?/g, '\n');
  if (!/^LOCUS\s/m.test(t)) return null;

  const locus = t.match(/^LOCUS\s+(\S+)(.*)$/m);
  const name = locus?.[1] ?? 'Imported sequence';
  const circular = /\bcircular\b/i.test(locus?.[2] ?? '');

  const def = t.match(/^DEFINITION\s+([\s\S]*?)(?=\n[A-Z]{2,})/m);
  const description = def?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

  // Deliberately not one regex. With the m flag `$` matches end-of-line, so a
  // lazy [\s\S]*? terminated at the first line of the ORIGIN block and returned
  // the first 60 bases of an 80 base record -- a wrong sequence, silently.
  const originLine = t.search(/^ORIGIN[^\n]*$/m);
  if (originLine === -1) return null;
  let block = t.slice(originLine);
  block = block.slice(block.indexOf('\n') + 1);
  const terminator = block.search(/^\/\//m);
  if (terminator !== -1) block = block.slice(0, terminator);
  const sequence = block.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!sequence) return null;

  const features: ImportedFeature[] = [];
  const featBlock = t.match(/^FEATURES\s+Location\/Qualifiers\n([\s\S]*?)(?=^ORIGIN|^CONTIG|^\/\/)/m);
  if (featBlock) {
    // Each feature begins with a key at column 6; its location may wrap onto
    // following lines before the first /qualifier.
    for (const block of featBlock[1].split(/\n(?=\s{5}\S)/)) {
      const lines = block.split('\n');
      const head = lines[0]?.match(/^\s{5}(\S+)\s+([\s\S]*)$/);
      if (!head) continue;
      const type = head[1];

      let loc = head[2].trim();
      for (let i = 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s{21}\//.test(l)) break;      // a qualifier starts here
        if (!l.trim()) continue;
        loc += l.trim();                      // location continued
      }

      const parsed = parseLocation(loc);
      if (!parsed) continue;

      const qualifiers = block.match(/\/(\w+)="?([^"\n]*)"?/g) ?? [];
      let label: string | undefined;
      for (const want of NAME_QUALIFIERS) {
        const m = block.match(new RegExp(`/${want}="([^"]*)"`))
          ?? block.match(new RegExp(`/${want}=([^\\s"][^\\n]*)`));
        if (m?.[1]?.trim()) { label = m[1].trim(); break; }
      }
      void qualifiers;

      const starts = parsed.segments.map(s => s.start);
      const ends = parsed.segments.map(s => s.end);
      features.push({
        name: label ?? type,
        type,
        start: Math.min(...starts),
        end: Math.max(...ends),
        strand: parsed.strand,
        ...(parsed.partial ? { partial: true } : {}),
        ...(parsed.segments.length > 1 ? { segments: parsed.segments } : {}),
      });
    }
  }

  return { name, description, sequence, circular, features, format: 'genbank' };
}

// ─── FASTA and bare sequence ─────────────────────────────────────────────────

export function parseFastaFile(text: string): ImportedSequence | null {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return null;

  let name = 'Imported sequence';
  let description = '';
  let body = t;

  if (t.startsWith('>')) {
    const nl = t.indexOf('\n');
    const header = (nl === -1 ? t : t.slice(0, nl)).slice(1).trim();
    body = nl === -1 ? '' : t.slice(nl + 1);
    const sp = header.search(/\s/);
    name = (sp === -1 ? header : header.slice(0, sp)) || name;
    description = sp === -1 ? '' : header.slice(sp).trim();
    // Only the first record: a multi-FASTA import is a different feature, and
    // silently keeping one of several would be worse than saying so.
    const next = body.indexOf('\n>');
    if (next !== -1) body = body.slice(0, next);
  }

  const sequence = body.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!sequence) return null;

  return {
    name, description, sequence, circular: false, features: [],
    format: t.startsWith('>') ? 'fasta' : 'plain',
  };
}

/** How many records a multi-FASTA holds, so the caller can say what it skipped. */
export function countFastaRecords(text: string): number {
  return (text.match(/^>/gm) ?? []).length;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function parseSequenceText(text: string): ImportedSequence | null {
  switch (detectFormat(text)) {
    case 'genbank': return parseGenBankFile(text);
    case 'fasta':
    case 'plain': return parseFastaFile(text);
    default: return null;
  }
}
