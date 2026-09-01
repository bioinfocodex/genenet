import type { ImportedFeature, ImportedSequence } from '../sequence-import';

/**
 * GFF3.
 *
 * Annotation rather than sequence: nine tab-separated columns per feature, with
 * the sequence either embedded after a `##FASTA` directive or living in a
 * separate file. That second case is the common one, and it is why this module
 * can return features alone — the caller lays them onto a sequence it already
 * has.
 *
 * Two things are easy to get wrong and both are silent. GFF is 1-based and
 * inclusive at both ends, where everything internal here is 0-based; and a
 * feature on the minus strand still lists start before end, so start is always
 * the lower coordinate rather than the first base transcribed.
 */

export interface GffResult {
  features: ImportedFeature[];
  /** Sequences found after a ##FASTA directive, keyed by seqid. */
  sequences: Record<string, string>;
  /** Lines that could not be read, with the reason. */
  problems: string[];
}

export function isGff(text: string): boolean {
  const t = text.replace(/\r\n?/g, '\n').trimStart();
  if (/^##gff-version\s+3/m.test(t.slice(0, 200))) return true;
  // Not every file carries the directive. Fall back to shape: a line of nine
  // tab-separated columns whose 4th and 5th are numbers.
  for (const line of t.split('\n').slice(0, 40)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cols = line.split('\t');
    return cols.length === 9 && /^\d+$/.test(cols[3]) && /^\d+$/.test(cols[4]);
  }
  return false;
}

/** GFF3 percent-encodes reserved characters in attribute values. */
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // A stray % that is not an escape is not worth refusing the whole file for.
    return s;
  }
}

function attributes(field: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of field.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    if (k) out[k] = decode(pair.slice(eq + 1).trim());
  }
  return out;
}

const NAME_KEYS = ['Name', 'gene', 'label', 'product', 'locus_tag', 'ID'];

export function parseGff(text: string): GffResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const features: ImportedFeature[] = [];
  const sequences: Record<string, string> = {};
  const problems: string[] = [];

  // Features sharing an ID are the parts of one spliced feature; collect them
  // so a multi-exon CDS arrives as one feature with segments rather than as
  // several features stacked on top of each other.
  const byId = new Map<string, { start: number; end: number }[]>();
  const meta = new Map<string, { name: string; type: string; strand: '+' | '-' }>();

  let inFasta = false;
  let fastaName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFasta) {
      if (line.startsWith('>')) {
        fastaName = line.slice(1).trim().split(/\s/)[0];
        sequences[fastaName] = '';
      } else if (fastaName) {
        sequences[fastaName] += line.replace(/[^A-Za-z]/g, '').toUpperCase();
      }
      continue;
    }

    if (/^##FASTA/i.test(line)) { inFasta = true; continue; }
    if (!line.trim() || line.startsWith('#')) continue;

    const cols = line.split('\t');
    if (cols.length < 9) {
      problems.push(`Line ${i + 1}: ${cols.length} columns, expected 9.`);
      continue;
    }

    const start1 = Number(cols[3]);
    const end1 = Number(cols[4]);
    if (!Number.isInteger(start1) || !Number.isInteger(end1) || start1 < 1 || end1 < start1) {
      problems.push(`Line ${i + 1}: ${cols[3]}–${cols[4]} is not a usable range.`);
      continue;
    }

    const attrs = attributes(cols[8]);
    const type = cols[2] || 'misc_feature';
    const name = NAME_KEYS.map(k => attrs[k]).find(v => v && v.trim()) ?? type;
    const strand: '+' | '-' = cols[6] === '-' ? '-' : '+';

    // GFF is 1-based inclusive; everything internal is 0-based inclusive.
    const segment = { start: start1 - 1, end: end1 - 1 };

    const id = attrs.ID ?? attrs.Parent;
    if (id) {
      const list = byId.get(id) ?? [];
      list.push(segment);
      byId.set(id, list);
      if (!meta.has(id)) meta.set(id, { name, type, strand });
      continue;
    }

    features.push({ name, type, start: segment.start, end: segment.end, strand });
  }

  for (const [id, segments] of byId) {
    const m = meta.get(id)!;
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    features.push({
      name: m.name,
      type: m.type,
      start: sorted[0].start,
      end: Math.max(...sorted.map(s => s.end)),
      strand: m.strand,
      ...(sorted.length > 1 ? { segments: sorted } : {}),
    });
  }

  features.sort((a, b) => a.start - b.start || a.end - b.end);
  return { features, sequences, problems };
}

/**
 * A GFF that carries its own sequence, as an importable record.
 *
 * Returns null when there is no `##FASTA` block: features with nowhere to sit
 * are not a sequence, and pretending otherwise would produce a record with an
 * empty sequence and a full feature table.
 */
export function parseGffFile(text: string, fallbackName = 'Imported sequence'): ImportedSequence | null {
  const { features, sequences } = parseGff(text);
  const names = Object.keys(sequences).filter(k => sequences[k].length > 0);
  if (names.length === 0) return null;

  const name = names[0];
  return {
    name: name || fallbackName,
    description: names.length > 1 ? `First of ${names.length} sequences in the file` : '',
    sequence: sequences[name],
    circular: false,
    // Features naming a different seqid do not belong on this one.
    features: features.filter(f => f.end < sequences[name].length),
    format: 'gff',
  };
}
