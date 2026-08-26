import { prisma } from '@/lib/prisma';
import NewProteinClient from './client';

export const dynamic = 'force-dynamic';

export default async function NewProteinPage() {
  const genes = await prisma.geneSequence.findMany({
    where: { type: 'gene' },
    select: { id: true, name: true, size: true },
    orderBy: { name: 'asc' },
  });
  return <NewProteinClient genes={genes} />;
}
