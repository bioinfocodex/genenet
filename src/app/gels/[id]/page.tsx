import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import GelEditor from '@/components/GelEditor';

export const dynamic = 'force-dynamic';

export default async function GelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gel = await prisma.gelSimulation.findUnique({ where: { id } });
  if (!gel) notFound();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        <Link href="/gels" style={{ color: 'var(--accent-blue)' }}>Gel Simulations</Link>
        <ChevronRight size={13} />
        <span>{gel.name}</span>
      </div>
      <GelEditor gel={gel as any} />
    </div>
  );
}
