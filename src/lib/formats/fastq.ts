/**
 * FASTQ.
 *
 * The point of reading FASTQ here is not the sequence — FASTA already carries
 * that. It is the quality string. The contig assembler trims reads by quality
 * before it joins anything, and without real Phred scores it falls back to
 * trimming leading and trailing ambiguity, which is a much blunter instrument.
 *
 * The encoding is the one genuine trap. Phred+33 (Sanger, and everything
 * modern) and Phred+64 (Illumina 1.3–1.7) use overlapping character ranges, and
 * a file read under the wrong one comes out with every score wrong by 31 —
 * which does not look like an error, it looks like a bad run.
 */

export interface FastqRead {
  name: string;
  description: string;
  sequence: string;
  /** Phred scores, one per base. */
  quality: number[];
}

export type Encoding = 'phred33' | 'phred64';

/**
 * Work out the encoding from the characters actually present.
 *
 * The ranges overlap between ASCII 64 and 74, so a file using only that band is
 * genuinely ambiguous. The convention, and what every tool does: any character
 * below 59 can only be Phred+33; any above 74 with nothing below 64 can only be
 * Phred+64; otherwise assume Phred+33, because it is what everything written
 * since about 2011 produces.
 */
export function detectEncoding(qualityLines: string[]): { encoding: Encoding; certain: boolean } {
  let min = Infinity;
  let max = -Infinity;
  for (const line of qualityLines) {
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c < min) min = c;
      if (c > max) max = c;
    }
  }
  if (!Number.isFinite(min)) return { encoding: 'phred33', certain: false };

  if (min < 59) return { encoding: 'phred33', certain: true };
  if (min >= 64 && max > 74) return { encoding: 'phred64', certain: true };
  return { encoding: 'phred33', certain: false };
}

export interface FastqFile {
  reads: FastqRead[];
  encoding: Encoding;
  /** False when the characters present fit both encodings. */
  encodingCertain: boolean;
  /** Records skipped, with the reason, rather than dropped in silence. */
  problems: string[];
}

export function isFastq(text: string): boolean {
  const t = text.replace(/\r\n?/g, '\n').trimStart();
  if (!t.startsWith('@')) return false;
  const lines = t.split('\n');
  // The third line of a record is the '+' separator. Checking it is what
  // separates FASTQ from a FASTA whose header happens to start with '@'.
  return lines.length >= 4 && lines[2].startsWith('+');
}

export function parseFastq(text: string, forced?: Encoding): FastqFile {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const problems: string[] = [];

  // Two passes: the encoding is a property of the whole file, so every quality
  // line has to be seen before any score can be converted.
  const raw: { name: string; description: string; sequence: string; qual: string }[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    if (!lines[i].startsWith('@')) {
      problems.push(`Line ${i + 1}: expected a record starting with @.`);
      i++;
      continue;
    }

    const header = lines[i].slice(1).trim();
    const sp = header.search(/\s/);
    const name = (sp === -1 ? header : header.slice(0, sp)) || `read ${raw.length + 1}`;
    const description = sp === -1 ? '' : header.slice(sp).trim();

    // Sequence may wrap, though it rarely does; read until the '+' line.
    let seq = '';
    let seqLines = 0;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('+')) {
      seq += lines[j].trim();
      seqLines++;
      j++;
    }
    if (j >= lines.length) {
      problems.push(`${name}: no + separator; the record is truncated.`);
      break;
    }

    // The quality block occupies exactly as many lines as the sequence block.
    //
    // Reading until the length matches instead looks equivalent and is not: a
    // record whose quality line is short then swallows the following record's
    // header and sequence trying to make up the difference, and one truncated
    // record silently costs two. Reading until the next '@' is worse still,
    // because '@' is an ordinary quality character — Phred 31 under Phred+33.
    let qual = '';
    j++;
    for (let k = 0; k < seqLines && j < lines.length; k++, j++) {
      qual += lines[j].trim();
    }

    if (qual.length !== seq.length) {
      problems.push(`${name}: ${seq.length} bases but ${qual.length} quality scores; skipped.`);
      i = j;
      continue;
    }

    raw.push({ name, description, sequence: seq.toUpperCase(), qual });
    i = j;
  }

  const detected = detectEncoding(raw.map(r => r.qual));
  const encoding = forced ?? detected.encoding;
  const offset = encoding === 'phred64' ? 64 : 33;

  const reads: FastqRead[] = raw.map(r => ({
    name: r.name,
    description: r.description,
    sequence: r.sequence,
    quality: [...r.qual].map(c => c.charCodeAt(0) - offset),
  }));

  return {
    reads,
    encoding,
    encodingCertain: forced ? true : detected.certain,
    problems,
  };
}
