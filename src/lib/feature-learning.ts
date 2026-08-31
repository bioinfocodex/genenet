import { FEATURE_LIBRARY, type LibraryFeature } from './features.data';
import { colourForType } from './features';

/**
 * Growing the library from files that already know things.
 *
 * A shipped table of parts can only ever hold what somebody typed into it, and
 * typing hundreds of sequences from memory is how a library ends up confidently
 * wrong. But every GenBank file and every SnapGene file already carries its own
 * annotations, put there by whoever built the construct. Importing one is
 * therefore an opportunity: the features it names, with the bases underneath
 * them, are exactly what the library is short of.
 *
 * So an import proposes rather than assumes. What comes back is a list of
 * candidates a person can accept, because an annotation is only as good as the
 * file it came from and a lab's own vectors are worth more than a stranger's.
 */

export interface FeatureCandidate {
  name: string;
  type: string;
  sequence: string;
  /** Why it is being offered, or why it is not worth offering. */
  reason: string;
  /** False when the library already knows it, or it is not usable. */
  worthAdding: boolean;
}

/** Below this a match is meaningless: too short to be specific. */
const MIN_LENGTH = 12;
/** Above this the part is a whole gene, and storing it helps nobody. */
const MAX_LENGTH = 3000;

const GENERIC = new Set([
  'misc_feature', 'source', 'gene', 'CDS', 'mRNA', 'exon', 'intron', 'primer_bind',
]);

function normalise(s: string): string {
  return s.toUpperCase().replace(/[^ACGT]/g, '');
}

/**
 * What an imported file offers the library.
 *
 * `features` are the annotations the file carried, with coordinates into
 * `sequence`; each is cut out and judged on its own.
 */
export function candidatesFrom(
  sequence: string,
  features: { name: string; type: string; start: number; end: number }[],
  library: LibraryFeature[] = FEATURE_LIBRARY,
): FeatureCandidate[] {
  const seq = normalise(sequence);
  const known = new Map(library.map(f => [normalise(f.sequence), f.name]));
  const knownNames = new Set(library.map(f => f.name.toLowerCase()));
  const seen = new Set<string>();
  const out: FeatureCandidate[] = [];

  for (const f of features) {
    // Coordinates arrive 1-indexed and inclusive, as GenBank prints them.
    const from = Math.max(0, f.start - 1);
    const to = Math.min(seq.length, f.end);
    const part = seq.slice(from, to);

    const base: Omit<FeatureCandidate, 'reason' | 'worthAdding'> = {
      name: f.name, type: f.type, sequence: part,
    };

    if (part.length < MIN_LENGTH) {
      out.push({ ...base, reason: `Only ${part.length} bases — too short to identify anything.`, worthAdding: false });
      continue;
    }
    if (part.length > MAX_LENGTH) {
      out.push({ ...base, reason: `${part.length.toLocaleString()} bases — a whole gene rather than a part.`, worthAdding: false });
      continue;
    }
    if (seen.has(part)) continue;
    seen.add(part);

    const already = known.get(part);
    if (already) {
      out.push({ ...base, reason: `Already in the library as ${already}.`, worthAdding: false });
      continue;
    }
    // A name the library holds with different bases is worth knowing about: it
    // is either a variant worth having or a name collision worth resolving.
    if (knownNames.has(f.name.toLowerCase())) {
      out.push({
        ...base,
        reason: `The library has a ${f.name} with a different sequence. Adding this keeps both, which is right if it is a variant.`,
        worthAdding: true,
      });
      continue;
    }
    if (GENERIC.has(f.type) && /^(unnamed|feature|misc|untitled)/i.test(f.name)) {
      out.push({ ...base, reason: 'No usable name — a feature called "misc" identifies nothing later.', worthAdding: false });
      continue;
    }

    out.push({ ...base, reason: `New: ${part.length} bp ${f.type}.`, worthAdding: true });
  }

  return out;
}

/** Turn an accepted candidate into a library entry. */
export function toLibraryFeature(c: FeatureCandidate): LibraryFeature {
  return {
    name: c.name,
    type: c.type,
    color: colourForType(c.type),
    sequence: normalise(c.sequence),
    learned: true,
  };
}
