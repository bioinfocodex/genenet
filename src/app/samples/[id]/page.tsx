import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, FlaskConical } from 'lucide-react';
import SampleDetailClient from './client';

export const dynamic = 'force-dynamic';

export default async function SampleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sample, freezers, sequences] = await Promise.all([
    prisma.sample.findUnique({
      where: { id },
      include: {
        freezer:      true,
        task:         { select: { id: true, title: true } },
        project:      { select: { id: true, name: true } },
        geneSequence: { select: { id: true, name: true } },
        createdBy:    { select: { name: true } },
      },
    }),
    prisma.freezer.findMany({ orderBy: { temperature: 'asc' } }),
    prisma.geneSequence.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  if (!sample) notFound();

  const TYPE_COLOR: Record<string, string> = {
    PLASMID: 'var(--accent-blue)', LINEAR_DNA: 'var(--accent-green)',
    GLYCEROL_STOCK: 'var(--accent-purple)', OTHER: 'var(--text-muted)',
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        <Link href="/samples" style={{ color: 'var(--accent-blue)' }}>Sample Inventory</Link>
        <ChevronRight size={13} />
        <span style={{ fontFamily: 'monospace', color: TYPE_COLOR[sample.type] ?? 'var(--text-primary)' }}>{sample.sampleId}</span>
      </div>
      <SampleDetailClient sample={sample as any} freezers={freezers} sequences={sequences} />
    </div>
  );
}
