import { parseLocation, type ImportedFeature, type ImportedSequence } from '../sequence-import';

/**
 * EMBL flat files.
 *
 * The European sibling of GenBank, and what comes out of ENA and Ensembl
 * downloads. Same information, different furniture: two-letter line codes down
 * the left margin instead of keyword-at-column-0, and the sequence block
 * carries its running position on the right rather than the left.
 *
 * The feature table is deliberately the same syntax as GenBank's — the INSDC
 * agreed one location grammar across all three databases — so `parseLocation`
 * is shared rather than reimplemented. Two location parsers that agree on the
 * day they are written is exactly the arrangement that produces an off-by-one
 * in one of them a year later.
 */

/** True when this looks like an EMBL flat file rather than something else. */
export function isEmbl(text: string): boolean {
  const head = text.replace(/\r\n?/g, '\n').trimStart().slice(0, 400);
  // An ID line, and enough of the two-letter margin to rule out prose that
  // happens to start with "ID".
  return /^ID\s{3}\S/m.test(head) && /^(XX|AC|DE|SQ|FH|FT)\s/m.test(head);
}

export function parseEmbl(text: string): ImportedSequence | null {
  const t = text.replace(/\r\n?/g, '\n');
  if (!isEmbl(t)) return null;

  const id = t.match(/^ID\s{3}(.*)$/m)?.[1] ?? '';
  // ID   X56734; SV 1; linear; mRNA; STD; PLN; 1859 BP.
  const parts = id.split(';').map(s => s.trim());
  const name = parts[0]?.replace(/;$/, '') || 'Imported sequence';
  const circular = parts.some(p => /^circular$/i.test(p));

  // DE lines wrap; join them with a space rather than concatenating, or two
  // words either side of the break run together.
  const description = (t.match(/^DE\s{3}(.*)$/gm) ?? [])
    .map(l => l.slice(5).trim())
    .join(' ')
    .trim();

  // ── Sequence ──────────────────────────────────────────────────────────────
  const sqLine = t.search(/^SQ\s{3}/m);
  if (sqLine === -1) return null;
  let block = t.slice(sqLine);
  block = block.slice(block.indexOf('\n') + 1);
  const end = block.search(/^\/\//m);
  if (end !== -1) block = block.slice(0, end);

  // Each line ends with the running position; stripping every digit removes it
  // along with nothing else, since bases are letters.
  const sequence = block.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!sequence) return null;

  // ── Features ──────────────────────────────────────────────────────────────
  const features: ImportedFeature[] = [];
  const ftLines = (t.match(/^FT.*$/gm) ?? [])
    // FH lines are the table's own header and carry no data.
    .filter(l => !/^FT\s*$/.test(l));

  // Strip the two-letter margin, then the table reads like GenBank's: a key at
  // a fixed column starts a feature, deeper indentation continues it.
  const rows = ftLines.map(l => l.slice(2).replace(/^\s{3}/, ''));

  let current: { type: string; loc: string; quals: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const parsed = parseLocation(current.loc);
    if (parsed) {
      const label = nameFrom(current.quals) ?? current.type;
      const starts = parsed.segments.map(s => s.start);
      const ends = parsed.segments.map(s => s.end);
      features.push({
        name: label,
        type: current.type,
        start: Math.min(...starts),
        end: Math.max(...ends),
        strand: parsed.strand,
        ...(parsed.partial ? { partial: true } : {}),
        ...(parsed.segments.length > 1 ? { segments: parsed.segments } : {}),
      });
    }
    current = null;
  };

  for (const row of rows) {
    const head = row.match(/^(\S+)\s+(.*)$/);
    // A new feature key sits at the start of the stripped row; anything
    // indented belongs to the feature above it.
    if (head && !/^\s/.test(row)) {
      flush();
      current = { type: head[1], loc: head[2].trim(), quals: [] };
      continue;
    }
    if (!current) continue;
    const cont = row.trim();
    if (cont.startsWith('/')) current.quals.push(cont);
    else if (current.quals.length) {
      // A wrapped qualifier value.
      current.quals[current.quals.length - 1] += ` ${cont}`;
    } else {
      // A wrapped location, which arrives before any qualifier.
      current.loc += cont;
    }
  }
  flush();

  return { name, description, sequence, circular, features, format: 'embl' };
}

const NAME_QUALIFIERS = ['label', 'gene', 'product', 'note', 'standard_name', 'locus_tag'];

function nameFrom(quals: string[]): string | undefined {
  for (const want of NAME_QUALIFIERS) {
    for (const q of quals) {
      const m = q.match(new RegExp(`^/${want}=\\s*"?([^"]*)"?`));
      if (m?.[1]?.trim()) return m[1].trim().replace(/\s+/g, ' ');
    }
  }
  return undefined;
}
