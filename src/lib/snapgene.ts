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
 *
 * The details below are the ones a file written by SnapGene actually exercises
 * and a file written by this codebase does not, which is why they were all
 * wrong until the reader was checked against real plasmids rather than against
 * its own output. Each is noted where it is handled.
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

/** 0-based inclusive, with end before start when the range wraps the origin. */
interface Range { start: number; end: number }

/**
 * One `range="start-end"` attribute, as 0-based inclusive bases.
 *
 * Features are 1-based inclusive, like GenBank. Primer binding sites are
 * written one lower at both ends -- the same quirk BioPython compensates for,
 * and the reason every primer imported from a real file used to sit one base
 * to the left of where SnapGene draws it.
 *
 * A range whose end comes before its start runs through the origin. Returning
 * it that way round is the convention the circular map already reads, so it
 * draws as the short arc it is; taking the lowest and highest number instead
 * would turn a twenty-base primer into a feature spanning the whole plasmid.
 */
function parseRange(spec: string, isPrimer: boolean): Range | null {
  const m = (spec ?? '').match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const shift = isPrimer ? 0 : 1;
  return { start: Number(m[1]) - shift, end: Number(m[2]) - shift };
}

const wraps = (r: Range) => r.end < r.start;

function parseFeatures(xml: string): ImportedFeature[] {
  const features: ImportedFeature[] = [];

  for (const block of xml.split(/<Feature\b/).slice(1)) {
    const openTag = '<Feature' + block.slice(0, block.indexOf('>') + 1);
    const a = attrs(openTag);
    const type = a.type || 'misc_feature';
    const name = a.name || type;

    // Ranges live in <Segment range="start-end"> children.
    const segments: Range[] = [];
    let color: string | undefined;
    for (const seg of block.matchAll(/<Segment\b[^>]*>/g)) {
      const sa = attrs(seg[0]);
      // A "gap" segment is the space between two exons, not a piece of the
      // feature. Counting it as one would place an intron's worth of bases
      // inside the CDS.
      if ((sa.type ?? 'standard') === 'gap') continue;
      const r = parseRange(sa.range, false);
      if (!r) continue;
      segments.push(r);
      // The colour the lab chose is how people recognise their own constructs.
      if (!color && /^#[0-9a-fA-F]{6}$/.test(sa.color ?? '')) color = sa.color;
    }

    if (!segments.length) continue;

    // directionality: 1 forward, 2 reverse, 3 both. Anything else reads forward.
    const dir = a.directionality;
    const strand: '+' | '-' = dir === '2' ? '-' : '+';

    // A feature in one piece keeps whatever it said, wrap included. A spliced
    // one is described by its pieces, and its extent is their span.
    const single = segments.length === 1;
    const start = single ? segments[0].start : Math.min(...segments.map(s => s.start));
    const end = single ? segments[0].end : Math.max(...segments.map(s => s.end));

    features.push({
      name, type, start, end, strand,
      ...(single ? {} : { segments }),
      ...(color ? { color } : {}),
    });
  }

  return features;
}

/**
 * The primers packet.
 *
 * SnapGene records every place a primer could anneal and then shows the person
 * only the ones that pass the hybridisation settings stored alongside them. It
 * also writes each site a second time in a "simplified" form. Importing the
 * packet as it stands therefore produces several times the primer sites the
 * file appears to contain -- on one real Addgene plasmid, fifty-six where
 * SnapGene shows twenty-two -- so the same two rules are applied here.
 */
function parsePrimers(xml: string): ImportedFeature[] {
  const out: ImportedFeature[] = [];

  const params = xml.match(/<HybridizationParams\b[^>]*>/);
  const pa = params ? attrs(params[0]) : {};
  const minMatch = Number(pa.minContinuousMatchLen ?? 0) || 0;
  const minTm = Number(pa.minMeltingTemperature ?? 0) || 0;

  for (const block of xml.split(/<Primer\b/).slice(1)) {
    const a = attrs('<Primer' + block.slice(0, block.indexOf('>') + 1));
    const name = a.name || 'primer';
    const seen = new Set<string>();

    for (const site of block.matchAll(/<BindingSite\b[^>]*>/g)) {
      const sa = attrs(site[0]);
      const r = parseRange(sa.location, true);
      if (!r) continue;

      // The attribute is boundStrand, and 1 means the primer anneals to the
      // bottom strand. Reading a "strand" attribute instead -- which no file
      // written by SnapGene contains -- silently made every reverse primer
      // point forwards.
      const strand: '+' | '-' = sa.boundStrand === '1' ? '-' : '+';

      const key = `${r.start}:${r.end}:${strand}`;
      if (sa.simplified === '1' && seen.has(key)) continue;

      if (sa.annealedBases !== undefined && sa.annealedBases.length < minMatch) continue;
      if (sa.meltingTemperature !== undefined && Number(sa.meltingTemperature) < minTm) continue;

      seen.add(key);
      out.push({ name, type: 'primer_bind', start: r.start, end: r.end, strand });
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
  ].filter(f => f.start >= 0 && f.start < sequence.length &&
                f.end >= 0 && f.end < sequence.length);

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

/** Exported for the round-trip tests, which need the wrap convention named. */
export const wrapsOrigin = (f: { start: number; end: number }) => wraps(f);
