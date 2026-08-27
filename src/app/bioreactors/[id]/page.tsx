import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Activity } from 'lucide-react';
import BioreactorRunClient from '@/components/BioreactorRunClient';

export const dynamic = 'force-dynamic';

export default async function BioreactorRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.bioreactorRun.findUnique({
    where: { id },
    include: { readings: { orderBy: { elapsedHrs: 'asc' } } },
  });
  if (!run) notFound();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        <Link href="/bioreactors" style={{ color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Activity size={13} /> Bioreactor Runs
        </Link>
        <ChevronRight size={13} />
        <span>{run.name}</span>
      </div>
      <BioreactorRunClient run={run} />
    </div>
  );
}
