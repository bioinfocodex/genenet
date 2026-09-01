import type { ImportedFeature } from '../sequence-import';

/**
 * Writing SnapGene .dna files.
 *
 * Reading them already works, which removed the friction of receiving a map
 * from a collaborator. Writing them removes the other half: a GeneNet user can
 * hand a file back to someone who has not switched, and it opens.
 *
 * The layout is the one the reader documents — a flat run of type/length/payload
 * segments. Written here:
 *
 *     9   the cookie segment, which is what makes the file recognisable
 *     0   the sequence, with a leading flags byte whose low bit means circular
 *     10  the feature table, XML
 *     6   notes, XML
 *
 * The segment order matters: SnapGene expects the cookie first and reads the
 * sequence before the features that index into it.
 */

const COOKIE = 'SnapGene';

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** One type/length/payload segment. */
function segment(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  // Big-endian length, matching the reader.
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

/**
 * XML text escaping.
 *
 * A feature called "5' UTR &c" is ordinary, and writing it raw produces a file
 * SnapGene refuses to open with no indication why. Both quote forms are escaped
 * because these values are written as attributes.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The cookie segment.
 *
 * "SnapGene" followed by three big-endian 16-bit values: the file type (1 for
 * DNA) and the exporter and importer versions it claims compatibility with.
 */
function cookieSegment(): Uint8Array {
  const payload = new Uint8Array(COOKIE.length + 6);
  payload.set(bytesOf(COOKIE), 0);
  const view = new DataView(payload.buffer);
  view.setUint16(COOKIE.length, 1, false);      // DNA file
  view.setUint16(COOKIE.length + 2, 14, false); // exported by
  view.setUint16(COOKIE.length + 4, 14, false); // importable by
  return segment(9, payload);
}

function sequenceSegment(sequence: string, circular: boolean): Uint8Array {
  const seq = sequence.toUpperCase().replace(/[^A-Z]/g, '').toLowerCase();
  const payload = new Uint8Array(1 + seq.length);
  // Low bit: circular. Bit 1: double-stranded, which everything here is.
  payload[0] = (circular ? 0x01 : 0x00) | 0x02;
  payload.set(bytesOf(seq), 1);
  return segment(0, payload);
}

/** SnapGene's palette for the feature types it knows. */
const TYPE_COLOURS: Record<string, string> = {
  CDS: '#993366',
  gene: '#ff9ccd',
  promoter: '#ffff00',
  terminator: '#f58a5e',
  rep_origin: '#ffef86',
  primer_bind: '#a6acb3',
  misc_feature: '#99ccff',
  protein_bind: '#31849b',
  RBS: '#c6c9d1',
  polyA_signal: '#85dae9',
  exon: '#b1ff67',
  intron: '#d6b295',
  source: '#ffffff',
};

function featureXml(features: ImportedFeature[], length: number): string {
  const parts: string[] = ['<Features nextValidID="' + (features.length + 1) + '">'];

  features.forEach((f, i) => {
    // SnapGene is 1-based and inclusive, like GenBank. Everything internal here
    // is 0-based inclusive, so both ends shift by one — shifting only the start
    // is the classic way to lose the last base of every feature.
    const segments = f.segments?.length
      ? f.segments
      : [{ start: f.start, end: f.end }];

    const clamped = segments
      .map(s => ({ start: Math.max(0, s.start), end: Math.min(length - 1, s.end) }))
      .filter(s => s.end >= s.start);
    if (clamped.length === 0) return;

    const colour = TYPE_COLOURS[f.type] ?? TYPE_COLOURS.misc_feature;
    const directionality = f.strand === '-' ? 2 : 1;

    parts.push(
      `<Feature recentID="${i + 1}" name="${esc(f.name)}" type="${esc(f.type)}" ` +
      `directionality="${directionality}">`,
    );
    for (const s of clamped) {
      parts.push(
        `<Segment range="${s.start + 1}-${s.end + 1}" color="${colour}" type="standard"/>`,
      );
    }
    parts.push(`<Q name="label"><V text="${esc(f.name)}"/></Q>`);
    parts.push('</Feature>');
  });

  parts.push('</Features>');
  return parts.join('');
}

function notesXml(name: string, description: string): string {
  const now = new Date().toISOString().slice(0, 10);
  return (
    '<Notes>' +
    `<Type>Synthetic</Type>` +
    `<Created>${now}</Created>` +
    `<LastModified>${now}</LastModified>` +
    `<Description>${esc(description)}</Description>` +
    `<CustomMapLabel>${esc(name)}</CustomMapLabel>` +
    // Written so a reader can tell where the file came from. SnapGene ignores
    // fields it does not know rather than refusing the file.
    '<CreatedBy>GeneNet</CreatedBy>' +
    '</Notes>'
  );
}

export interface WriteOptions {
  name: string;
  description?: string;
  sequence: string;
  circular?: boolean;
  features?: ImportedFeature[];
}

/** Build a .dna file. */
export function writeSnapGene(opts: WriteOptions): Uint8Array {
  const sequence = opts.sequence.replace(/[^A-Za-z]/g, '');
  if (!sequence) throw new Error('There is no sequence to write.');

  const chunks = [
    cookieSegment(),
    sequenceSegment(sequence, opts.circular ?? false),
    segment(10, bytesOf(featureXml(opts.features ?? [], sequence.length))),
    segment(6, bytesOf(notesXml(opts.name, opts.description ?? ''))),
  ];

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** A filename that will not surprise anyone on the other end. */
export function snapGeneFilename(name: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${base || 'sequence'}.dna`;
}
