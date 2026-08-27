import type { ImportedFeature, ImportedSequence } from '@/lib/sequence-import';

/**
 * Reading SnapGene .dna files.
 *
 * SnapGene is what most molecular biology labs actually have their plasmid maps
 * in, and .dna is what lands in your inbox when a collaborator shares one.
 * Being unable to open it is the kind of friction that ends an evaluation
 * before anything else gets looked at.
 *
 * The format is undocumented by its vendor but stable and widely
 * reimplemented -- BioPython and SnapGene's own exporters agree on it. A file
 * is a flat run of segments, each one:
 *
 *     1 byte   segment type
 *     4 bytes  payload length, big-endian
 *     n bytes  payload
 *
 * The first segment is type 9 and carries the ASCII cookie "SnapGene", which is
 * how a file is recognised. The segments used here:
 *
 *     0   the DNA sequence, ASCII, with a leading flags byte whose low bit
 *         means the molecule is circular
 *     5   primers, XML
 *     6   notes, XML
 *     10  features, XML
 *
 * Anything else is skipped rather than guessed at.
 */

const COOKIE = 'SnapGene';

interface Segment { type: number; data: Uint8Array }

function readSegments(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 5 <= bytes.length) {
    const type = bytes[i];
    const len = view.getUint32(i + 1, false); // big-endian
    const start = i + 5;
    if (len < 0 || start + len > bytes.length) break; // truncated: keep what parsed
    out.push({ type, data: bytes.subarray(start, start + len) });
    i = start + len;
  }
  return out;
}

const text = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b);

/** True if these bytes look like a SnapGene file. */
export function isSnapGene(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || bytes[0] !== 9) return false;
  return text(bytes.subarray(5, 5 + COOKIE.length)) === COOKIE;
}

/**
 * Minimal XML attribute reader.
 *
 * The feature payload is small, well-formed XML written by one producer. A
 * dependency-free reader is enough here and avoids pulling a parser into the
 * bundle for one file format.
 */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/(\w[\w:-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseFeatures(xml: string): ImportedFeature[] {
  const features: ImportedFeature[] = [];

  for (const block of xml.split(/<Feature\b/).slice(1)) {
    const openTag = '<Feature' + block.slice(0, block.indexOf('>') + 1);
    const a = attrs(openTag);
    const type = a.type || 'misc_feature';
    const name = a.name || type;

    // Ranges live in <Segment range="start-end"> children, 1-based inclusive.
    const segments: { start: number; end: number }[] = [];
    for (const seg of block.matchAll(/<Segment\b[^>]*>/g)) {
      const sa = attrs(seg[0]);
      const r = (sa.range ?? '').match(/^(\d+)-(\d+)$/);
      if (r) segments.push({ start: Number(r[1]) - 1, end: Number(r[2]) - 1 });
    }

    if (!segments.length) continue;

    // directionality: 1 forward, 2 reverse, 3 both. Anything else reads forward.
    const dir = a.directionality;
    const strand: '+' | '-' = dir === '2' ? '-' : '+';

    features.push({
      name, type,
      start: Math.min(...segments.map(s => s.start)),
      end: Math.max(...segments.map(s => s.end)),
      strand,
      ...(segments.length > 1 ? { segments } : {}),
    });
  }

  return features;
}

function parsePrimers(xml: string): ImportedFeature[] {
  const out: ImportedFeature[] = [];
  for (const block of xml.split(/<Primer\b/).slice(1)) {
    const a = attrs('<Primer' + block.slice(0, block.indexOf('>') + 1));
    const name = a.name || 'primer';
    for (const site of block.matchAll(/<BindingSite\b[^>]*>/g)) {
      const sa = attrs(site[0]);
      const loc = sa.location ?? '';
      const m = loc.match(/^(\d+)-(\d+)$/);
      if (!m) continue;
      out.push({
        name, type: 'primer_bind',
        start: Number(m[1]) - 1,
        end: Number(m[2]) - 1,
        strand: sa.strand === '1' ? '-' : '+',
      });
    }
  }
  return out;
}

function firstText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim() : '';
}

export function parseSnapGene(bytes: Uint8Array, fallbackName = 'Imported sequence'): ImportedSequence | null {
  if (!isSnapGene(bytes)) return null;

  const segments = readSegments(bytes);

  const dna = segments.find(s => s.type === 0);
  if (!dna || dna.data.length < 2) return null;

  // First byte is flags; bit 0 set means circular.
  const circular = (dna.data[0] & 1) === 1;
  const sequence = text(dna.data.subarray(1)).replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!sequence) return null;

  const featureXml = segments.find(s => s.type === 10);
  const primerXml = segments.find(s => s.type === 5);
  const notesXml = segments.find(s => s.type === 6);

  const features = [
    ...(featureXml ? parseFeatures(text(featureXml.data)) : []),
    ...(primerXml ? parsePrimers(text(primerXml.data)) : []),
  ];

  let name = fallbackName;
  let description = '';
  if (notesXml) {
    const notes = text(notesXml.data);
    // SnapGene keeps a human title in <CustomMapLabel> and the free-text
    // description in <Description>.
    name = firstText(notes, 'CustomMapLabel') || fallbackName;
    description = firstText(notes, 'Description');
  }

  return { name, description, sequence, circular, features, format: 'snapgene' };
}
