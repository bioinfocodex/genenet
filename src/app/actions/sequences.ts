'use server'
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { calcTm, calcGC, parseFasta, parseGenBank } from '@/lib/simulation';
import { requireUser } from '@/lib/auth-guard';

export async function createSequence(data: FormData) {
  const name = (data.get('name') as string).trim();
  const type = data.get('type') as string;
  const description = (data.get('description') as string | null)?.trim() || null;
  const rawSeq = data.get('sequence') as string;
  const tags = (data.get('tags') as string | null)?.trim() || null;

  // Normalize: uppercase, strip whitespace/numbers
  const sequence = rawSeq.toUpperCase().replace(/[^ACGTRYMKSWHBVDN]/g, '');

  if (sequence.length === 0) throw new Error('Sequence must contain valid nucleotides.');

  await prisma.geneSequence.create({
    data: { name, type, description, sequence, size: sequence.length, tags },
  });

  revalidatePath('/sequences');
  redirect('/sequences');
}

export async function deleteSequence(id: string) {
  await prisma.geneSequence.delete({ where: { id } });
  revalidatePath('/sequences');
}

// FormData version safe for use from client components (no .bind needed)
export async function deleteSequenceAction(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.geneSequence.delete({ where: { id } });
  revalidatePath('/sequences');
}

export async function saveFeatures(formData: FormData) {
  const id = formData.get('id') as string;
  const featuresJson = formData.get('features') as string;
  if (!id || !featuresJson) return;
  await prisma.geneSequence.update({
    where: { id },
    data: { features: featuresJson },
  });
  revalidatePath('/sequences');
}

// ─── Import from FASTA / GenBank ──────────────────────────────────────────────

export async function importSequence(formData: FormData) {
  const format = formData.get('format') as string;  // 'fasta' | 'genbank'
  const raw = (formData.get('raw') as string ?? '').trim();
  if (!raw) throw new Error('No sequence data provided');

  const parsed = format === 'genbank' ? parseGenBank(raw) : parseFasta(raw);
  if (!parsed) throw new Error('Could not parse sequence. Check the format and try again.');

  const featuresJson = parsed.features.length > 0 ? JSON.stringify(parsed.features) : '[]';

  await prisma.geneSequence.create({
    data: {
      name: parsed.name,
      description: parsed.description || null,
      type: parsed.type,
      sequence: parsed.sequence,
      size: parsed.sequence.length,
      tags: null,
      features: featuresJson,
    },
  });

  revalidatePath('/sequences');
  redirect('/sequences');
}

// ─── Primer CRUD ──────────────────────────────────────────────────────────────

export async function addPrimer(formData: FormData) {
  const geneSequenceId = formData.get('geneSequenceId') as string;
  const name = (formData.get('name') as string).trim();
  const rawSeq = (formData.get('sequence') as string).trim();
  const direction = (formData.get('direction') as string) || 'forward';
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  if (!geneSequenceId || !name || !rawSeq) return;

  const sequence = rawSeq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!sequence) return;

  const tm = calcTm(sequence);
  const gcContent = calcGC(sequence);

  await prisma.primer.create({
    data: { name, sequence, direction, tm, gcContent, notes, geneSequenceId },
  });

  revalidatePath(`/sequences/${geneSequenceId}`);
}

export async function deletePrimer(formData: FormData) {
  const id = formData.get('id') as string;
  const geneSequenceId = formData.get('geneSequenceId') as string;
  if (!id) return;
  await prisma.primer.delete({ where: { id } });
  revalidatePath(`/sequences/${geneSequenceId}`);
}

export async function updatePrimer(formData: FormData) {
  const id = formData.get('id') as string;
  const geneSequenceId = formData.get('geneSequenceId') as string;
  const name = (formData.get('name') as string).trim();
  const rawSeq = (formData.get('sequence') as string).trim();
  const direction = (formData.get('direction') as string) || 'forward';
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  if (!id || !name || !rawSeq) return;

  const sequence = rawSeq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!sequence) return;

  const tm = calcTm(sequence);
  const gcContent = calcGC(sequence);

  await prisma.primer.update({
    where: { id },
    data: { name, sequence, direction, tm, gcContent, notes },
  });

  if (geneSequenceId) revalidatePath(`/sequences/${geneSequenceId}`);
}

// ─── Simulation Save ──────────────────────────────────────────────────────────

export async function saveSimulation(formData: FormData) {
  const session = await requireUser();

  const type = formData.get('type') as string;
  const name = (formData.get('name') as string | null) || '';
  const inputData = formData.get('inputData') as string;
  const outputData = formData.get('outputData') as string;
  const geneSequenceId = (formData.get('geneSequenceId') as string | null) || null;

  if (!type || !inputData || !outputData) return;

  await prisma.simulation.create({
    data: {
      type,
      name,
      inputData,
      outputData,
      createdById: session.id,
      geneSequenceId: geneSequenceId || null,
    },
  });

  if (geneSequenceId) revalidatePath(`/sequences/${geneSequenceId}`);
}
