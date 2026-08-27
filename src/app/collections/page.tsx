import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { deleteCollection, createCollection } from '@/app/actions/collections';
import CollectionManager from '@/components/CollectionManager';

export const dynamic = 'force-dynamic';

export default async function CollectionsPage() {
  const [collections, sequences, proteins] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    }),
    prisma.geneSequence.findMany({ select: { id: true, name: true, type: true, size: true }, orderBy: { name: 'asc' } }),
    prisma.protein.findMany({ select: { id: true, name: true, mw: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Layers size={28} color="var(--accent-orange)" /> Collections
        </h1>
      </div>

      <CollectionManager
        collections={collections}
        sequences={sequences}
        proteins={proteins}
      />
    </div>
  );
}
