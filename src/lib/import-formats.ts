/**
 * Which files the sequence importer can read.
 *
 * This list lived in three places that disagreed: the file picker's `accept`
 * attribute, the hint under the drop zone, and the error message naming the
 * supported formats. The picker was the narrowest of the three, so a reader
 * that worked -- SnapGene .dna among them -- was unreachable from the one
 * control a person would use to reach it: the file was greyed out in the
 * dialog, and the error message that would have told them it was supported
 * never ran.
 *
 * One list, used by all three, is the only version of this that stays true.
 * Adding a reader means adding it here.
 */

export interface ImportFormat {
  /** How to say it to somebody. */
  label: string;
  /** Filename extensions, with the dot, as a file input wants them. */
  extensions: string[];
}

export const IMPORT_FORMATS: ImportFormat[] = [
  { label: 'GenBank', extensions: ['.gb', '.gbk', '.genbank'] },
  { label: 'FASTA', extensions: ['.fasta', '.fa', '.fna', '.ffn', '.faa', '.seq'] },
  { label: 'EMBL', extensions: ['.embl', '.ebl'] },
  { label: 'GFF3', extensions: ['.gff', '.gff3'] },
  { label: 'SnapGene', extensions: ['.dna'] },
  { label: 'Sanger trace', extensions: ['.ab1', '.abi'] },
  { label: 'plain text', extensions: ['.txt'] },
];

/** The `accept` attribute for a file input. */
export const IMPORT_ACCEPT: string =
  IMPORT_FORMATS.flatMap(f => f.extensions).join(',');

/** Every extension, lower case and with the dot. */
export const IMPORT_EXTENSIONS: string[] =
  IMPORT_FORMATS.flatMap(f => f.extensions);

/** A hint to put under a drop zone. */
export const IMPORT_HINT: string =
  IMPORT_FORMATS.map(f => f.extensions[0]).join(' · ');

/** The sentence an error message uses. */
export const IMPORT_FORMAT_LIST: string =
  IMPORT_FORMATS.map(f => f.label).join(', ');

/**
 * What a filename claims to be, or null.
 *
 * The importer detects the real format from the file's content, so this is
 * only for telling someone what they just picked. A file whose extension is
 * unknown is not rejected here: the content is what decides, and a GenBank
 * file somebody renamed still imports.
 */
export function formatFromFilename(name: string): string | null {
  const ext = (name.toLowerCase().match(/\.[a-z0-9]+$/) ?? [''])[0];
  if (!ext) return null;
  return IMPORT_FORMATS.find(f => f.extensions.includes(ext))?.label ?? null;
}
