/**
 * Recognising files this cannot open, and saying what to do about them.
 *
 * Vector NTI archives, Clone Manager files and DNAStar SeqBuilder documents are
 * undocumented proprietary binaries. A parser written by guessing at them would
 * work on the three files it was tested against and produce a wrong sequence on
 * the fourth — silently, because a wrong plasmid map still looks like a plasmid
 * map. Recognising the file and saying "export it as GenBank" is a worse
 * feature and a much better outcome.
 *
 * Every one of these tools exports GenBank, and that path is already read.
 */

export interface UnsupportedFormat {
  /** What the file appears to be. */
  format: string;
  /** What the person holding it should do, in the tool they already have. */
  advice: string;
}

const ASCII = (b: Uint8Array, from: number, len: number) =>
  Array.from(b.subarray(from, from + len)).map(c => String.fromCharCode(c)).join('');

/** Bytes present anywhere in the first n bytes. */
function contains(bytes: Uint8Array, needle: string, within = 4096): boolean {
  const hay = ASCII(bytes, 0, Math.min(within, bytes.length));
  return hay.includes(needle);
}

/**
 * Identify a binary this cannot read, or return null.
 *
 * Deliberately conservative: a false positive here tells someone their file is
 * unsupported when it might have parsed, which is worse than the generic
 * "could not read this" they would otherwise get.
 */
export function identifyUnsupported(bytes: Uint8Array, filename = ''): UnsupportedFormat | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

  // OLE2 compound document — the container Vector NTI and several others use.
  const isOle = bytes.length > 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

  if (isOle || ['ma4', 'ma5', 'gb4', 'oa4', 'pa4'].includes(ext)) {
    return {
      format: 'Vector NTI archive',
      advice: 'Vector NTI stores molecules in a proprietary archive. Open it in Vector NTI and use File → Export → GenBank, then import that file here.',
    };
  }

  if (['cm5', 'cx5', 'cl5', 'cd5'].includes(ext) || contains(bytes, 'Clone Manager', 512)) {
    return {
      format: 'Clone Manager file',
      advice: 'Clone Manager uses a closed format. In Clone Manager, use File → Export → GenBank and import the result here.',
    };
  }

  if (['sbd', 'star', 'pro'].includes(ext) || contains(bytes, 'Lasergene', 512) || contains(bytes, 'SeqBuilder', 512)) {
    return {
      format: 'DNAStar Lasergene document',
      advice: 'SeqBuilder documents are a closed format. Use File → Export → GenBank in SeqBuilder and import that.',
    };
  }

  if (ext === 'geneious' || contains(bytes, 'geneiousDocument', 2048)) {
    return {
      format: 'Geneious document',
      advice: 'Geneious documents are an internal format. Right-click the document in Geneious and use Export → GenBank, then import that.',
    };
  }

  // A ZIP container: could be almost anything, but for sequence tools it is
  // usually a Geneious or Benchling export bundle.
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ext !== 'zip') {
    return {
      format: 'a zipped export bundle',
      advice: 'This is a compressed bundle rather than a single sequence. Unzip it and import the GenBank or FASTA file inside.',
    };
  }

  return null;
}
