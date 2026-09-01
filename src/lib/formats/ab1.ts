/**
 * ABI trace files (.ab1).
 *
 * This is what actually comes back from a sequencing facility. Everything else
 * in the import path takes a sequence someone has already extracted; this takes
 * the file the instrument wrote, with the per-base quality the basecaller
 * assigned. That matters because the contig assembler trims by quality before
 * it joins anything, and the trim is only as good as the scores it is given.
 *
 * The format (ABIF, Applied Biosystems) is published and stable. A file is:
 *
 *     "ABIF"          4 bytes, magic
 *     version         2 bytes, big-endian
 *     a directory entry describing the directory itself, at offset 26
 *
 * Every directory entry is 28 bytes:
 *
 *     name            4 bytes, ASCII tag
 *     number          4 bytes, which instance of that tag
 *     elementType     2 bytes
 *     elementSize     2 bytes
 *     numElements     4 bytes
 *     dataSize        4 bytes
 *     dataOffset      4 bytes  -- or the data itself, when dataSize <= 4
 *     dataHandle      4 bytes
 *
 * Everything is big-endian. The inline-when-small rule for dataOffset is the
 * one place a reader goes wrong quietly: treating a four-byte value as a file
 * offset lands somewhere arbitrary in the file and returns plausible rubbish.
 */

export interface Ab1Entry {
  tag: string;
  number: number;
  elementType: number;
  numElements: number;
  dataSize: number;
  dataOffset: number;
  /** True when the payload is stored inline in the offset field. */
  inline: boolean;
}

export interface Ab1Trace {
  /** Basecalls, as the instrument's primary basecaller assigned them. */
  sequence: string;
  /** Phred-like quality per base. Empty when the file carries none. */
  quality: number[];
  /** Sample name as entered at the sequencer, which is what people search by. */
  sampleName: string;
  /** The machine's own comment, when present. */
  comment: string;
  runDate: string;
  /** Order the four dye channels appear in, e.g. "GATC". */
  baseOrder: string;
  /** Chromatogram traces per channel, in `baseOrder`. Empty unless asked for. */
  traces: number[][];
  /** Position of each basecall within the trace, for drawing peaks. */
  peakLocations: number[];
}

const MAGIC = 'ABIF';

function ascii(bytes: Uint8Array, from: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[from + i]);
  return s;
}

export function isAb1(bytes: Uint8Array): boolean {
  return bytes.length > 30 && ascii(bytes, 0, 4) === MAGIC;
}

/** Read the directory. Exposed because "what is in this file" is a real question. */
export function readDirectory(bytes: Uint8Array): Ab1Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The entry at offset 26 describes the directory itself: how many entries
  // there are and where they start.
  const numEntries = view.getInt32(26 + 16, false);
  const dirOffset = view.getInt32(26 + 20, false);

  const out: Ab1Entry[] = [];
  for (let i = 0; i < numEntries; i++) {
    const at = dirOffset + i * 28;
    if (at + 28 > bytes.length) break;   // truncated: keep what parsed
    const dataSize = view.getInt32(at + 16, false);
    out.push({
      tag: ascii(bytes, at, 4),
      number: view.getInt32(at + 4, false),
      elementType: view.getUint16(at + 8, false),
      numElements: view.getInt32(at + 12, false),
      dataSize,
      // When the payload fits in four bytes it *is* the offset field, not a
      // pointer to somewhere else.
      dataOffset: dataSize <= 4 ? at + 20 : view.getInt32(at + 20, false),
      inline: dataSize <= 4,
    });
  }
  return out;
}

function find(dir: Ab1Entry[], tag: string, number = 1): Ab1Entry | undefined {
  return dir.find(e => e.tag === tag && e.number === number);
}

function bytesOf(bytes: Uint8Array, e: Ab1Entry | undefined): Uint8Array | null {
  if (!e) return null;
  if (e.dataOffset < 0 || e.dataOffset + e.dataSize > bytes.length) return null;
  return bytes.subarray(e.dataOffset, e.dataOffset + e.dataSize);
}

/** ABIF strings come in two flavours; both are length-prefixed or NUL-terminated. */
function stringOf(bytes: Uint8Array, e: Ab1Entry | undefined): string {
  const b = bytesOf(bytes, e);
  if (!b || b.length === 0) return '';
  // 18 = pString: a leading length byte. 19 = cString: NUL-terminated.
  if (e!.elementType === 18) return ascii(b, 1, Math.min(b[0], b.length - 1));
  if (e!.elementType === 19) {
    const nul = b.indexOf(0);
    return ascii(b, 0, nul === -1 ? b.length : nul);
  }
  return ascii(b, 0, b.length).replace(/\0+$/, '');
}

function shortsOf(bytes: Uint8Array, e: Ab1Entry | undefined): number[] {
  const b = bytesOf(bytes, e);
  if (!b) return [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 2 <= b.length; i += 2) out.push(view.getInt16(i, false));
  return out;
}

export interface Ab1Options {
  /** Read the chromatogram channels too. Off by default: they are most of the file. */
  includeTraces?: boolean;
}

export function parseAb1(bytes: Uint8Array, opts: Ab1Options = {}): Ab1Trace | null {
  if (!isAb1(bytes)) return null;

  let dir: Ab1Entry[];
  try {
    dir = readDirectory(bytes);
  } catch {
    return null;
  }
  if (dir.length === 0) return null;

  // PBAS.1 is the primary basecaller's calls; PBAS.2 is the edited sequence a
  // person may have corrected. Prefer the edited one when it exists, because
  // if someone went to the trouble of fixing a call they meant it.
  const basesEntry = find(dir, 'PBAS', 2) ?? find(dir, 'PBAS', 1);
  const rawBases = bytesOf(bytes, basesEntry);
  if (!rawBases) return null;
  const sequence = ascii(rawBases, 0, rawBases.length).replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!sequence) return null;

  // PCON holds one quality byte per base. Matching numbering to PBAS.
  const conEntry = find(dir, 'PCON', basesEntry!.number) ?? find(dir, 'PCON', 1);
  const rawQual = bytesOf(bytes, conEntry);
  const quality = rawQual ? Array.from(rawQual) : [];

  const baseOrder = stringOf(bytes, find(dir, 'FWO_', 1)) || 'GATC';
  const peakLocations = shortsOf(bytes, find(dir, 'PLOC', 2) ?? find(dir, 'PLOC', 1));

  let traces: number[][] = [];
  if (opts.includeTraces) {
    // DATA 9 through 12 are the four processed channels, in FWO_ order.
    traces = [9, 10, 11, 12]
      .map(n => shortsOf(bytes, find(dir, 'DATA', n)))
      .filter(t => t.length > 0);
  }

  return {
    sequence,
    // A quality array that does not line up with the bases is worse than none:
    // the assembler would trim the wrong end.
    quality: quality.length === sequence.length ? quality : [],
    sampleName: stringOf(bytes, find(dir, 'SMPL', 1)),
    comment: stringOf(bytes, find(dir, 'CMNT', 1)),
    runDate: stringOf(bytes, find(dir, 'RUND', 1)),
    baseOrder,
    traces,
    peakLocations,
  };
}
