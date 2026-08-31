import 'server-only';
import { prisma } from './prisma';
import { FEATURE_LIBRARY, type LibraryFeature } from './features.data';
import { candidatesFrom, type FeatureCandidate } from './feature-learning';
import { normaliseFeatures } from './features';

/**
 * The parts this installation can recognise: what shipped, plus what it has
 * been taught.
 *
 * Kept as two lists joined at read time rather than one table seeded at
 * install, so an upgrade that improves a shipped part improves it everywhere,
 * and so it stays obvious which parts a lab added itself.
 */

export async function learnedParts(): Promise<LibraryFeature[]> {
  const rows = await prisma.libraryPart.findMany({ orderBy: { name: 'asc' } });
  return rows.map(r => ({
    name: r.name,
    type: r.type,
    color: r.color,
    sequence: r.sequence,
    note: r.note ?? undefined,
    learned: true,
  }));
}

/** Everything available to the annotator. */
export async function fullLibrary(): Promise<LibraryFeature[]> {
  return [...FEATURE_LIBRARY, ...(await learnedParts())];
}

/**
 * What one sequence could teach the library.
 *
 * Judged against the full library, shipped and learned together, so a part
 * accepted from one plasmid is not offered again by the next.
 */
export async function candidatesForSequence(id: string): Promise<FeatureCandidate[]> {
  const seq = await prisma.geneSequence.findUnique({
    where: { id },
    select: { sequence: true, features: true },
  });
  if (!seq) return [];

  const features = normaliseFeatures(seq.features).map(f => ({
    name: f.name, type: f.type, start: f.start, end: f.end,
  }));
  if (features.length === 0) return [];

  return candidatesFrom(seq.sequence, features, await fullLibrary());
}

export async function addParts(
  parts: { name: string; type: string; color: string; sequence: string }[],
  source: { id: string; name: string } | null,
  userId?: string | null,
): Promise<number> {
  if (parts.length === 0) return 0;

  const clean = parts.map(p => ({
    ...p,
    sequence: p.sequence.toUpperCase().replace(/[^ACGT]/g, ''),
  })).filter(p => p.sequence.length >= 10);
  if (clean.length === 0) return 0;

  // Prisma's skipDuplicates is not available on SQLite, so the existing rows
  // are read first. The same bases under the same name are already known;
  // re-adding them from a second plasmid is not new information, and letting
  // the unique constraint throw would lose the whole batch over one repeat.
  const existing = await prisma.libraryPart.findMany({
    where: { name: { in: clean.map(p => p.name) } },
    select: { name: true, sequence: true },
  });
  const known = new Set(existing.map(e => `${e.name}\u0000${e.sequence}`));

  const fresh = clean.filter(p => !known.has(`${p.name}\u0000${p.sequence}`));
  if (fresh.length === 0) return 0;

  const result = await prisma.libraryPart.createMany({
    data: fresh.map(p => ({
      name: p.name,
      type: p.type,
      color: p.color,
      sequence: p.sequence,
      sourceId: source?.id ?? null,
      sourceName: source?.name ?? null,
      createdById: userId ?? null,
    })),
  });
  return result.count;
}

export async function removePart(id: string): Promise<void> {
  await prisma.libraryPart.delete({ where: { id } });
}
