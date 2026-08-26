'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth-guard';

export async function createGel(formData: FormData) {
  const session = await requireUser();
  const name = (formData.get('name') as string | null)?.trim() || 'Untitled Gel';
  const concentration = parseFloat((formData.get('concentration') as string) || '1.0');
  const voltage = parseInt((formData.get('voltage') as string) || '100');
  const runTime = parseInt((formData.get('runTime') as string) || '30');
  const lanes = (formData.get('lanes') as string | null) || '[]';
  const gel = await prisma.gelSimulation.create({
    data: { name, concentration, voltage, runTime, lanes, createdById: session.id },
  });
  revalidatePath('/gels');
  redirect(`/gels/${gel.id}`);
}

export async function updateGel(formData: FormData) {
  const id = formData.get('id') as string;
  const name = (formData.get('name') as string | null)?.trim() || 'Untitled Gel';
  const concentration = parseFloat((formData.get('concentration') as string) || '1.0');
  const voltage = parseInt((formData.get('voltage') as string) || '100');
  const runTime = parseInt((formData.get('runTime') as string) || '30');
  const lanes = (formData.get('lanes') as string | null) || '[]';
  if (!id) return;
  await prisma.gelSimulation.update({ where: { id }, data: { name, concentration, voltage, runTime, lanes } });
  revalidatePath(`/gels/${id}`);
  revalidatePath('/gels');
}

export async function deleteGel(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.gelSimulation.delete({ where: { id } });
  revalidatePath('/gels');
  redirect('/gels');
}
