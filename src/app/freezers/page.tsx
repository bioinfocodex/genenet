import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import FreezerViewer from '@/components/FreezerViewer';
import FreezersClient from './client';

export const dynamic = 'force-dynamic';

export default async function FreezersPage() {
  const freezers = await prisma.freezer.findMany({
    orderBy: { temperature: 'asc' },
    include: {
      samples: {
        select: { id: true, sampleId: true, name: true, type: true, status: true, rack: true, box: true, position: true },
      },
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '2rem' }}>🧊 Freezer Inventory</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
            Visual storage map · {freezers.length} freezer{freezers.length !== 1 ? 's' : ''} · {freezers.reduce((a, f) => a + f.samples.length, 0)} samples total
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <Link href="/samples" className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>🧪 All Samples</Link>
          <FreezersClient />
        </div>
      </div>

      <FreezerViewer freezers={freezers as any} />
    </div>
  );
}
