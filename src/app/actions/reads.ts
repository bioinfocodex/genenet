'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';

/** Remove a read from a sequence. The audit trail keeps the record of it. */
export async function deleteRead(id: string): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const read = await prisma.sequencingRead.findUnique({ where: { id }, select: { geneSequenceId: true } });
  if (!read) return { error: 'That read is already gone.' };
  await prisma.sequencingRead.delete({ where: { id } });
  revalidatePath(`/sequences/${read.geneSequenceId}`);
  return { ok: true };
}
