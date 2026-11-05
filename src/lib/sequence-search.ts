/**
 * Finding a motif in a sequence.
 *
 * Searching for a stretch of bases is one of the three things anybody does in
 * a sequence view, and until now it was the one that did not work: the Find
 * panel opened and its callback had an empty body.
 *
 * The rules that make this more than indexOf, in the order they bite:
 *
 *   Ambiguity codes. A query of GGTCTCN is a BsaI site with its spacer, and
 *     somebody typing it means "any base there". Codes are honoured in the
 *     query. They are also honoured in the subject, because an assembled
 *     consensus genuinely contains N and a run of them should not silently
 *     match every query.
 *   Both strands. A primer that anneals to the bottom strand is in the file
 *     only as its reverse complement, and somebody pasting the primer and
 *     being told it is absent would be told a falsehood.
 *   The origin. On a circular molecule a motif can start near the end and
 *     finish past base 1. It is still there, and a search that misses it is
 *     wrong in exactly the case plasmid work cares about.
 *   Overlaps. AA occurs twice in AAA, not once.
 */

/** 1-based and inclusive, like every other coordinate in this application. */
export interface Match {
  start: number;
  end: number;
  /** 1 when found on the given strand, -1 when found on its complement. */
  strand: 1 | -1;
  /** True when the match runs through the origin of a circular molecule. */
  wrapsOrigin: boolean;
}

export interface SearchOptions {
  /** Look on the complement as well. Default true. */
  bothStrands?: boolean;
  /** Allow a match to run past the end and back to base 1. Default false. */
  circular?: boolean;
  /** Stop after this many, so a one-base query cannot hang the browser. */
  limit?: number;
}

/**
 * Which plain bases each code stands for.
 *
 * Both sides of a comparison are expanded, so the question asked is "could
 * these be the same base" rather than "is this character that character".
 */
const CODES: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

/** The complement of a code, not just of a base: R (A or G) pairs with Y. */
const COMPLEMENT: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', U: 'A',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', D: 'H', H: 'D', V: 'B', N: 'N',
};

/** Whether a subject base and a query code can be the same base. */
export function basesMatch(subject: string, query: string): boolean {
  const s = CODES[subject.toUpperCase()];
  const q = CODES[query.toUpperCase()];
  // Anything not a nucleotide code matches only itself, exactly.
  if (!s || !q) return subject.toUpperCase() === query.toUpperCase();
  for (const base of q) if (s.includes(base)) return true;
  return false;
}

/** Reverse complement, honouring ambiguity codes rather than flattening them. */
export function revComp(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i--) {
    const c = seq[i].toUpperCase();
    out += COMPLEMENT[c] ?? c;
  }
  return out;
}

/** Whatever somebody pasted, reduced to the letters a search can use. */
export function cleanQuery(raw: string): string {
  return raw.replace(/[^A-Za-z]/g, '').toUpperCase();
}

export const MAX_MATCHES = 5000;

/**
 * Every place the query occurs.
 *
 * Returned in the order they appear along the molecule, with top-strand
 * matches before bottom-strand ones at the same position, so stepping
 * through them with "next" walks the sequence rather than jumping about.
 */
export function findMatches(
  sequence: string,
  rawQuery: string,
  opts: SearchOptions = {},
): Match[] {
  const { bothStrands = true, circular = false, limit = MAX_MATCHES } = opts;
  const query = cleanQuery(rawQuery);
  const seq = sequence.toUpperCase();
  if (query.length === 0 || seq.length === 0 || query.length > seq.length) return [];

  const hits: Match[] = [];
  const scan = (pattern: string, strand: 1 | -1) => {
    /*
     * The last start worth trying. On a circular molecule every position is
     * a possible start, because the molecule has no end to run off.
     */
    const last = circular ? seq.length - 1 : seq.length - pattern.length;
    for (let i = 0; i <= last; i++) {
      let ok = true;
      for (let j = 0; j < pattern.length; j++) {
        // The modulo is what lets a match run through the origin.
        const at = (i + j) % seq.length;
        if (!basesMatch(seq[at], pattern[j])) { ok = false; break; }
      }
      if (!ok) continue;
      const endIndex = (i + pattern.length - 1) % seq.length;
      hits.push({
        start: i + 1,
        end: endIndex + 1,
        strand,
        wrapsOrigin: endIndex < i,
      });
      if (hits.length >= limit) return;
    }
  };

  scan(query, 1);
  if (bothStrands && hits.length < limit) {
    const rc = revComp(query);
    /*
     * A palindrome is the same on both strands, and reporting it twice would
     * double every restriction site somebody searched for. One match, on the
     * strand it was asked for.
     */
    if (rc !== query) scan(rc, -1);
  }

  return hits
    .sort((a, b) => a.start - b.start || b.strand - a.strand)
    .slice(0, limit);
}

/**
 * The match to show next, given where the caret or selection is.
 *
 * Wraps, because a search that stops at the end of the molecule makes
 * somebody scroll back to the top to carry on, and the molecule is a loop
 * anyway as often as not.
 */
export function stepThrough(
  matches: Match[],
  current: number | null,
  direction: 1 | -1,
): number | null {
  if (matches.length === 0) return null;
  if (current === null) return direction === 1 ? 0 : matches.length - 1;
  return (current + direction + matches.length) % matches.length;
}

/** One edit to make, in the order it must be made. */
export interface PlannedEdit {
  start: number;
  end: number;
  /** What to write there, already oriented for the strand that matched. */
  text: string;
}

/**
 * Work out the edits a replacement implies, in the order they must happen.
 *
 * Right to left, because replacing left to right moves every later match by
 * the difference in length, and positions gathered before the first edit are
 * wrong from the second edit onwards.
 *
 * A match that wraps the origin is planned out rather than included:
 * splicing across the end of the molecule would reorder it silently, and
 * somebody replacing a motif is not asking to re-origin their plasmid.
 *
 * This returns a plan rather than a new sequence so the caller can apply it
 * through whatever already knows how to move feature coordinates -- the
 * bases are the easy half.
 */
export function planReplacements(
  matches: Match[],
  replacement: string,
): { edits: PlannedEdit[]; skippedWrapping: number } {
  const clean = cleanQuery(replacement);
  const edits: PlannedEdit[] = [];
  let skippedWrapping = 0;

  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    if (m.wrapsOrigin) { skippedWrapping++; continue; }
    /*
     * The bases written are the bases that strand shows. A match found on
     * the complement is reported in top-strand coordinates, so what goes in
     * is the reverse complement of what was typed -- otherwise replacing a
     * bottom-strand hit would write the replacement in backwards.
     */
    edits.push({ start: m.start, end: m.end, text: m.strand === 1 ? clean : revComp(clean) });
  }

  return { edits, skippedWrapping };
}

/**
 * The plan applied to the bases alone.
 *
 * Useful where there are no features to carry -- a primer, a fragment, a
 * test. The editor uses the plan directly, through the helper that also
 * moves the annotation.
 */
export function applyReplacement(
  sequence: string,
  matches: Match[],
  replacement: string,
): { sequence: string; replaced: number; skippedWrapping: number } {
  const { edits, skippedWrapping } = planReplacements(matches, replacement);
  let out = sequence;
  for (const e of edits) out = out.slice(0, e.start - 1) + e.text + out.slice(e.end);
  return { sequence: out, replaced: edits.length, skippedWrapping };
}
