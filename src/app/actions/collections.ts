'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth-guard';

export async function createCollection(formData: FormData) {
  await requireUser();
  const name = (formData.get('name') as string).trim();
  const description = (formData.get('description') as string | null)?.trim() || null;
  if (!name) throw new Error('Name required');
  await prisma.collection.create({ data: { name, description } });
  revalidatePath('/collections');
  redirect('/collections');
}

export async function deleteCollection(formData: FormData) {
  await requireUser();
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.collection.delete({ where: { id } });
  revalidatePath('/collections');
}

export async function addToCollection(formData: FormData) {
  await requireUser();
  const collectionId = formData.get('collectionId') as string;
  const itemType = formData.get('itemType') as string;
  const itemId = formData.get('itemId') as string;
  const notes = (formData.get('notes') as string | null)?.trim() || null;
  if (!collectionId || !itemType || !itemId) return;
  await prisma.collectionItem.upsert({
    where: { collectionId_itemType_itemId: { collectionId, itemType, itemId } },
    create: { collectionId, itemType, itemId, notes },
    update: { notes },
  });
  revalidatePath('/collections');
}

export async function removeFromCollection(formData: FormData) {
  await requireUser();
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.collectionItem.delete({ where: { id } });
  revalidatePath('/collections');
}
