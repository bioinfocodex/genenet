'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { fetchAccession } from '@/lib/accession';
import { annotate } from '@/lib/annotation';
import { fullLibrary } from '@/lib/feature-library';
import { normaliseFeatures } from '@/lib/features';
import { nextCode } from '@/lib/fields';
import { OLIGO_PREFIX, findDuplicate } from '@/lib/oligos';
import {
  REFERENCE_VECTORS, STANDARD_PRIMERS, REFERENCE_TAG, accessionTag, mergeAnnotations,
} from '@/lib/reference-content';

const COLLECTION = 'Reference vectors';

export interface ReferenceStatus {
  /** accession -> id of the library sequence it was imported as. */
  vectors: Record<string, string>;
  /** primer name -> code of the oligo holding its sequence. */
  primers: Record<string, string>;
}

/** Which reference vectors and primers are already in this workspace. */
export async function referenceStatus(): Promise<ReferenceStatus> {
  await requireUser();
  const [sequences, oligos] = await Promise.all([
    prisma.geneSequence.findMany({ where: { tags: { contains: REFERENCE_TAG } }, select: { id: true, tags: true } }),
    prisma.oligo.findMany({ select: { code: true, sequence: true } }),
  ]);
  const vectors: Record<string, string> = {};
  for (const v of REFERENCE_VECTORS) {
    const hit = sequences.find(s => s.tags?.split(/\s+/).includes(accessionTag(v.accession)));
    if (hit) vectors[v.accession] = hit.id;
  }
  const primers: Record<string, string> = {};
  for (const p of STANDARD_PRIMERS) {
    const dup = findDuplicate(p.sequence, oligos);
    if (dup) primers[p.name] = dup.code;
  }
  return { vectors, primers };
}

export interface VectorImport {
  imported: { accession: string; id: string; features: number; detected: number }[];
  failed: { accession: string; error: string }[];
}

/**
 * Fetch reference vectors from NCBI into the library. Each is annotated on the
 * way in, filed in the "Reference vectors" collection, and tagged with its
 * accession so it is never imported twice. One failure is reported and the
 * rest carry on.
 */
export async function importReferenceVectors(accessions: string[]): Promise<VectorImport> {
  await requireUser();
  const status = await referenceStatus();
  const wanted = REFERENCE_VECTORS.filter(v => accessions.includes(v.accession) && !status.vectors[v.accession]);
  const library = await fullLibrary();
  const out: VectorImport = { imported: [], failed: [] };

  let collection = await prisma.collection.findFirst({ where: { name: COLLECTION } });
  if (!collection && wanted.length) {
    collection = await prisma.collection.create({
      data: { name: COLLECTION, description: 'Widely used vectors, imported from GenBank.' },
    });
  }

  for (const [i, v] of wanted.entries()) {
    // NCBI asks for no more than three requests a second without a key.
    if (i > 0) await new Promise(r => setTimeout(r, 400));
    const got = await fetchAccession(v.accession);
    if (!got.ok) {
      out.failed.push({ accession: v.accession, error: got.error });
      continue;
    }
    const record = normaliseFeatures(JSON.stringify(got.sequence.features ?? []))
      .filter(f => f.type.toLowerCase() !== 'source');
    // Every one of these is a plasmid, whatever its LOCUS line says.
    const detected = annotate(got.sequence.sequence, { circular: true, extra: library });
    const features = mergeAnnotations(record, detected);

    const created = await prisma.geneSequence.create({
      data: {
        name: v.name,
        description: `Reference vector (${v.use}). GenBank ${v.accession}: ${(got.sequence.description || got.sequence.name).replace(/\.+$/, '')}.${v.note ? ` ${v.note}.` : ''}`,
        type: 'plasmid',
        sequence: got.sequence.sequence,
        size: got.sequence.sequence.length,
        tags: `${REFERENCE_TAG} ${accessionTag(v.accession)}`,
        features: JSON.stringify(features),
      },
      select: { id: true },
    });
    if (collection) {
      await prisma.collectionItem.create({ data: { collectionId: collection.id, itemType: 'sequence', itemId: created.id } });
    }
    out.imported.push({ accession: v.accession, id: created.id, features: features.length, detected: features.length - record.length });
  }

  revalidatePath('/reference');
  revalidatePath('/sequences');
  return out;
}

/** Put the universal primers in the oligo collection, skipping any already there. */
export async function addStandardPrimers(): Promise<{ added: { code: string; name: string }[] }> {
  const user = await requireUser();
  const existing = await prisma.oligo.findMany({ select: { code: true, sequence: true } });
  const codes = existing.map(o => o.code);
  const added: { code: string; name: string }[] = [];
  const names = Object.fromEntries(REFERENCE_VECTORS.map(v => [v.accession, v.name]));

  for (const p of STANDARD_PRIMERS) {
    if (findDuplicate(p.sequence, existing)) continue;
    const code = nextCode(OLIGO_PREFIX, codes);
    await prisma.oligo.create({
      data: {
        code, name: p.name, sequence: p.sequence, createdById: user.id,
        notes: `Universal primer. Anneals exactly to ${p.verifiedOn.map(a => `${names[a] ?? a} (${a})`).join(', ')}.`,
      },
    });
    codes.push(code);
    existing.push({ code, sequence: p.sequence });
    added.push({ code, name: p.name });
  }
  revalidatePath('/reference');
  revalidatePath('/oligos');
  return { added };
}
