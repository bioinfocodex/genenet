import { isAb1, parseAb1 } from './formats/ab1';

/**
 * Checking a trace file before it is stored against a sequence.
 *
 * A file is kept only if it parses as ABIF and yields basecalls: a store of
 * files that turn out to be unreadable when someone finally opens them is
 * worse than a refusal at upload, when the person still has the email the
 * facility sent.
 */

/** Facility traces run 100-500 KB; anything far past that is not one. */
export const MAX_READ_BYTES = 5 * 1024 * 1024;

export type ReadCheck =
  | { ok: true; sampleName: string | null; runDate: string | null; bases: number }
  | { ok: false; error: string };

export function checkReadFile(name: string, bytes: Uint8Array): ReadCheck {
  if (bytes.length > MAX_READ_BYTES) {
    return { ok: false, error: `${name} is ${(bytes.length / 1048576).toFixed(1)} MB; a trace file is well under 5 MB.` };
  }
  if (!isAb1(bytes)) return { ok: false, error: `${name} is not an ABI trace (.ab1) file.` };
  const t = parseAb1(bytes);
  if (!t) return { ok: false, error: `${name} could not be read as a trace.` };
  return { ok: true, sampleName: t.sampleName || null, runDate: t.runDate || null, bases: t.sequence.length };
}
