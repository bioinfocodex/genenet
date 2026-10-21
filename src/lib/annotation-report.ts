import type { SequenceFeature } from './features';
import type { Annotation } from './annotation';
import { mergeAnnotations } from './reference-content';

/**
 * What auto-annotation found, said out loud.
 *
 * Running the detector used to add features silently. That hides the two
 * things a person needs to know before trusting the map: which parts matched
 * only approximately -- a 86% "KanR" is a variant, or a coincidence, and is
 * worth a look -- and which stretches nothing recognised at all, which is
 * where an unexpected insert or a missing annotation would be.
 */

export interface AnnotationReport {
  /** Detected parts not already on the map, to be added. */
  added: SequenceFeature[];
  /** Detections the map already had (same kind over most of the span). */
  alreadyThere: number;
  /** Added parts that matched below 100% identity. */
  partial: { name: string; identity: number; start: number; end: number }[];
  /** Stretches no feature covers, 1-based inclusive, longest first. */
  unannotated: { start: number; end: number; length: number }[];
}

/** Stretches of at least `minGap` bases covered by no feature. */
export function uncovered(length: number, circular: boolean, features: { start: number; end: number }[], minGap: number) {
  const covered = new Uint8Array(length);
  for (const f of features) {
    const s = Math.max(1, Math.min(f.start, f.end));
    const e = Math.min(length, Math.max(f.start, f.end));
    covered.fill(1, s - 1, e);
  }
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < length; i++) {
    if (covered[i]) continue;
    const last = runs.at(-1);
    if (last && last.end === i) last.end = i + 1;
    else runs.push({ start: i + 1, end: i + 1 });
  }
  // On a circle, a gap at the end and one at the start are the same gap.
  if (circular && runs.length > 1 && runs[0].start === 1 && runs.at(-1)!.end === length) {
    const tail = runs.pop()!;
    runs[0] = { start: tail.start, end: runs[0].end };
  }
  return runs
    .map(r => ({ ...r, length: r.end >= r.start ? r.end - r.start + 1 : length - r.start + 1 + r.end }))
    .filter(r => r.length >= minGap)
    .sort((a, b) => b.length - a.length);
}

export function annotationReport(
  length: number,
  circular: boolean,
  existing: SequenceFeature[],
  detected: Annotation[],
  minGap = 300,
): AnnotationReport {
  const merged = mergeAnnotations(existing, detected);
  const existingIds = new Set(existing.map(f => f.id));
  const added = merged.filter(f => !existingIds.has(f.id));
  const partial = added
    .map(f => ({ f, d: detected.find(d => d.name === f.name && d.start === f.start && d.end === f.end) }))
    .filter(x => x.d && x.d.identity < 1)
    .map(x => ({ name: x.f.name, identity: x.d!.identity, start: x.f.start, end: x.f.end }));
  return {
    added,
    alreadyThere: detected.length - added.length,
    partial,
    unannotated: uncovered(length, circular, merged, minGap),
  };
}
