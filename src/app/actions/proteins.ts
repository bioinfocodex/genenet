'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { translateDNA, calcProteinProperties } from '@/lib/simulation';
import { requireUser } from '@/lib/auth-guard';
import { normaliseFeatures } from '@/lib/features';
import { codingSequence, isCoding } from '@/lib/point-mutation';

export async function createProtein(formData: FormData) {
  await requireUser();
  const name = (formData.get('name') as string).trim();
  const rawSeq = (formData.get('sequence') as string ?? '').trim();
  const description = (formData.get('description') as string | null)?.trim() || null;
  const tags = (formData.get('tags') as string | null)?.trim() || null;
  const geneSequenceId = (formData.get('geneSequenceId') as string | null) || null;
  const fromDna = formData.get('fromDna') === 'true';

  let aaSeq = rawSeq.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');

  if (fromDna) {
    // Translate from DNA
    const dnaClean = rawSeq.toUpperCase().replace(/[^ACGT]/g, '');
    if (!dnaClean) throw new Error('Invalid DNA sequence');
    aaSeq = translateDNA(dnaClean);
  }

  if (!aaSeq) throw new Error('Protein sequence cannot be empty');

  const props = calcProteinProperties(aaSeq);

  await prisma.protein.create({
    data: {
      name,
      sequence: aaSeq,
      description,
      tags,
      mw: props.mw,
      isoelectric: props.isoelectric,
      gravy: props.gravy,
      geneSequenceId: geneSequenceId || null,
    },
  });

  revalidatePath('/proteins');
  redirect('/proteins');
}

export async function deleteProtein(formData: FormData) {
  await requireUser();
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.protein.delete({ where: { id } });
  revalidatePath('/proteins');
}

export async function translateGeneToProtein(formData: FormData) {
  await requireUser();
  const geneSequenceId = formData.get('geneSequenceId') as string;
  if (!geneSequenceId) throw new Error('No gene selected');

  const gene = await prisma.geneSequence.findUnique({ where: { id: geneSequenceId } });
  if (!gene) throw new Error('Gene not found');

  const aaSeq = translateDNA(gene.sequence);
  if (!aaSeq) throw new Error('Translation produced no protein (no ATG or stop codon hit immediately)');

  const props = calcProteinProperties(aaSeq);

  await prisma.protein.create({
    data: {
      name: `${gene.name} (protein)`,
      description: `Translated from ${gene.name}`,
      sequence: aaSeq,
      mw: props.mw,
      isoelectric: props.isoelectric,
      gravy: props.gravy,
      geneSequenceId,
    },
  });

  revalidatePath('/proteins');
  redirect('/proteins');
}

export type TranslateResult = { ok: true; id: string; name: string; length: number } | { error: string };

/**
 * Make a protein record from one CDS feature, read in its own frame.
 *
 * translateGeneToProtein above translates the whole record from base one,
 * which is right only for a bare coding sequence: on a plasmid it reads
 * across the backbone in whatever frame base one happens to give, and on a
 * bottom-strand gene it reads the wrong strand entirely. This takes the
 * feature's own reading order -- exons joined, reverse complement for the
 * minus strand -- so the protein is the one the gene encodes.
 */
export async function translateFeatureToProtein(formData: FormData): Promise<TranslateResult> {
  await requireUser();
  const sequenceId = formData.get('sequenceId') as string;
  const featureId = formData.get('featureId') as string;
  if (!sequenceId || !featureId) return { error: 'No feature given.' };

  const gene = await prisma.geneSequence.findUnique({ where: { id: sequenceId } });
  if (!gene) return { error: 'That sequence no longer exists.' };

  const feature = normaliseFeatures(gene.features).find(f => f.id === featureId);
  if (!feature) return { error: 'That feature is no longer on the sequence.' };
  if (!isCoding(feature.type)) return { error: `${feature.name} is a ${feature.type}, which carries no reading frame.` };

  const dna = codingSequence(gene.sequence, feature);
  if (dna.length < 3) return { error: `${feature.name} is too short to translate.` };

  // Up to the first stop, which is the protein; the stop itself is not part of
  // it. A CDS whose length is not a multiple of three is translated as far as
  // whole codons go, and said to be suspect by the panel that offers this.
  const aa = translateDNA(dna, true).replace(/\*+$/, '');
  if (!aa) return { error: `${feature.name} translates to nothing: it begins at a stop codon.` };

  const props = calcProteinProperties(aa);
  const created = await prisma.protein.create({
    data: {
      name: feature.name,
      sequence: aa,
      description: `Translated from ${feature.name} (${feature.start}–${feature.end}${feature.strand === -1 ? ', minus strand' : ''}) of ${gene.name}.`,
      mw: props.mw,
      isoelectric: props.isoelectric,
      gravy: props.gravy,
      geneSequenceId: gene.id,
    },
    select: { id: true, name: true },
  });

  revalidatePath('/proteins');
  revalidatePath(`/sequences/${gene.id}`);
  return { ok: true, id: created.id, name: created.name, length: aa.length };
}
