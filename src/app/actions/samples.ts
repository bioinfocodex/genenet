'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

const TYPE_PREFIX: Record<string, string> = {
  PLASMID:       'PLA',
  LINEAR_DNA:    'DNA',
  GLYCEROL_STOCK:'GLY',
  OTHER:         'SAM',
};

/** Generate the next unique sampleId for a given type prefix, e.g. PLA-007 */
async function nextSampleId(prefix: string): Promise<string> {
  const existing = await prisma.sample.findMany({
    where: { sampleId: { startsWith: `${prefix}-` } },
    select: { sampleId: true },
    orderBy: { createdAt: 'desc' },
  });
  let max = 0;
  for (const s of existing) {
    const num = parseInt(s.sampleId.split('-')[1] ?? '0', 10);
    if (num > max) max = num;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export async function createSample(fd: FormData) {
  const session = await getSession();
  const type = (fd.get('type') as string) || 'OTHER';
  const prefix = TYPE_PREFIX[type] ?? 'SAM';
  const sampleId = await nextSampleId(prefix);

  const sample = await prisma.sample.create({
    data: {
      sampleId,
      name: (fd.get('name') as string).trim(),
      type,
      status: 'ACTIVE',
      description: (fd.get('description') as string) || null,
      notes:       (fd.get('notes') as string) || null,
      freezerId:   (fd.get('freezerId') as string) || null,
      rack:        (fd.get('rack') as string) || null,
      box:         (fd.get('box') as string) || null,
      position:    (fd.get('position') as string) || null,
      taskId:      (fd.get('taskId') as string) || null,
      projectId:   (fd.get('projectId') as string) || null,
      geneSequenceId: (fd.get('geneSequenceId') as string) || null,
      createdById: session?.userId || null,
    },
  });

  revalidatePath('/samples');
  revalidatePath('/freezers');
  if (sample.taskId) revalidatePath(`/tasks/${sample.taskId}`);
  redirect(`/samples/${sample.id}`);
}

export async function updateSample(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.sample.update({
    where: { id },
    data: {
      name:        (fd.get('name') as string).trim(),
      description: (fd.get('description') as string) || null,
      notes:       (fd.get('notes') as string) || null,
      freezerId:   (fd.get('freezerId') as string) || null,
      rack:        (fd.get('rack') as string) || null,
      box:         (fd.get('box') as string) || null,
      position:    (fd.get('position') as string) || null,
      geneSequenceId: (fd.get('geneSequenceId') as string) || null,
    },
  });
  revalidatePath('/samples');
  revalidatePath(`/samples/${id}`);
  revalidatePath('/freezers');
}

export async function updateSampleStatus(fd: FormData) {
  const id = fd.get('id') as string;
  const status = fd.get('status') as string;
  await prisma.sample.update({ where: { id }, data: { status } });
  revalidatePath('/samples');
  revalidatePath(`/samples/${id}`);
}

export async function deleteSample(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.sample.delete({ where: { id } });
  revalidatePath('/samples');
  revalidatePath('/freezers');
  redirect('/samples');
}

export async function createFreezer(fd: FormData) {
  await prisma.freezer.create({
    data: {
      name:        (fd.get('name') as string).trim(),
      temperature: parseInt(fd.get('temperature') as string, 10),
      location:    (fd.get('location') as string) || null,
      notes:       (fd.get('notes') as string) || null,
    },
  });
  revalidatePath('/freezers');
}

export async function deleteFreezer(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.freezer.delete({ where: { id } });
  revalidatePath('/freezers');
}
