'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { storeFile } from '@/lib/storage';
import { requireUser } from '@/lib/auth-guard';

/** Upload a gel image file and create a DB record. */
export async function uploadGelImage(fd: FormData) {
  await requireUser();
  const file = fd.get('file') as File | null;
  if (!file || file.size === 0) return { error: 'No file provided' };

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const allowed = ['jpg', 'jpeg', 'png', 'tif', 'tiff'];
  if (!allowed.includes(ext)) return { error: 'Unsupported format' };

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedName = `${timestamp}_${safeName}`;

  const bytes = await file.arrayBuffer();
  const { publicPath } = await storeFile(Buffer.from(bytes), storedName, 'gels');


  const fileType = ['tif', 'tiff'].includes(ext) ? 'tif' : ext === 'png' ? 'png' : 'jpg';

  const record = await prisma.gelImage.create({
    data: {
      fileName: file.name,
      filePath: publicPath,
      fileType,
      experimentType: (fd.get('experimentType') as string) || null,
      notes: (fd.get('notes') as string) || null,
      taskId: (fd.get('taskId') as string) || null,
    },
  });

  revalidatePath('/gels/images');
  if (record.taskId) revalidatePath(`/tasks/${record.taskId}`);
  return { id: record.id };
}

/** Attach an existing GelImage to a task. */
export async function attachGelToTask(fd: FormData) {
  await requireUser();
  const gelId = fd.get('gelId') as string;
  const taskId = fd.get('taskId') as string;
  await prisma.gelImage.update({ where: { id: gelId }, data: { taskId } });
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/gels/images');
}

/** Detach a GelImage from its task (keep the record). */
export async function detachGelFromTask(fd: FormData) {
  await requireUser();
  const gelId = fd.get('gelId') as string;
  const img = await prisma.gelImage.update({ where: { id: gelId }, data: { taskId: null } });
  revalidatePath('/gels/images');
  revalidatePath(`/tasks/${img.taskId ?? ''}`);
}

/** Delete a GelImage record (file remains on disk for safety). */
export async function deleteGelImage(fd: FormData) {
  await requireUser();
  const id = fd.get('id') as string;
  const img = await prisma.gelImage.delete({ where: { id } });
  revalidatePath('/gels/images');
  if (img.taskId) revalidatePath(`/tasks/${img.taskId}`);
}

/** Update notes/experimentType on an existing image. */
export async function updateGelImage(fd: FormData) {
  await requireUser();
  const id = fd.get('id') as string;
  await prisma.gelImage.update({
    where: { id },
    data: {
      notes: (fd.get('notes') as string) || null,
      experimentType: (fd.get('experimentType') as string) || null,
    },
  });
  revalidatePath('/gels/images');
}
