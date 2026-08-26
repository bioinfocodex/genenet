'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { translateDNA, calcProteinProperties } from '@/lib/simulation';
import { requireUser } from '@/lib/auth-guard';

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
