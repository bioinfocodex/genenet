'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createRun(formData: FormData) {
  const name = (formData.get('name') as string).trim();
  const vesselSize = (formData.get('vesselSize') as string) || '2L';
  const organism = (formData.get('organism') as string | null)?.trim() || null;
  const medium = (formData.get('medium') as string | null)?.trim() || null;
  const notes = (formData.get('notes') as string | null)?.trim() || null;
  if (!name) throw new Error('Name required');
  const run = await prisma.bioreactorRun.create({ data: { name, vesselSize, organism, medium, notes } });
  revalidatePath('/bioreactors');
  redirect(`/bioreactors/${run.id}`);
}

export async function updateRunStatus(formData: FormData) {
  const id = formData.get('id') as string;
  const status = formData.get('status') as string;
  if (!id) return;
  const data: Record<string, unknown> = { status };
  if (status === 'COMPLETED' || status === 'FAILED') data.endedAt = new Date();
  await prisma.bioreactorRun.update({ where: { id }, data });
  revalidatePath(`/bioreactors/${id}`);
  revalidatePath('/bioreactors');
}

export async function deleteRun(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.bioreactorRun.delete({ where: { id } });
  revalidatePath('/bioreactors');
  redirect('/bioreactors');
}

export async function addReading(formData: FormData) {
  const runId = formData.get('runId') as string;
  const elapsedHrs = parseFloat(formData.get('elapsedHrs') as string);
  const ph = formData.get('ph') ? parseFloat(formData.get('ph') as string) : null;
  const temperature = formData.get('temperature') ? parseFloat(formData.get('temperature') as string) : null;
  const dissolvedO2 = formData.get('dissolvedO2') ? parseFloat(formData.get('dissolvedO2') as string) : null;
  const feedRate = formData.get('feedRate') ? parseFloat(formData.get('feedRate') as string) : null;
  const agitation = formData.get('agitation') ? parseInt(formData.get('agitation') as string) : null;
  const od600 = formData.get('od600') ? parseFloat(formData.get('od600') as string) : null;
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  if (!runId || isNaN(elapsedHrs)) return;

  await prisma.bioreactorReading.create({
    data: { runId, elapsedHrs, ph, temperature, dissolvedO2, feedRate, agitation, od600, notes },
  });
  revalidatePath(`/bioreactors/${runId}`);
}

export async function deleteReading(formData: FormData) {
  const id = formData.get('id') as string;
  const runId = formData.get('runId') as string;
  if (!id) return;
  await prisma.bioreactorReading.delete({ where: { id } });
  revalidatePath(`/bioreactors/${runId}`);
}
