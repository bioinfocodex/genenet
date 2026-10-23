import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, FlaskConical } from 'lucide-react';
import SampleDetailClient from './client';
import QuantityPanel from '@/components/samples/QuantityPanel';
import SampleBarcode from '@/components/samples/SampleBarcode';
import CustodyPanel from '@/components/samples/CustodyPanel';

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
        heldBy:       { select: { name: true } },
        uses:         {
          orderBy: { usedAt: 'desc' },
          include: { usedBy: { select: { name: true } } },
        },
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
      <SampleDetailClient sample={sample} freezers={freezers} sequences={sequences} />
      <CustodyPanel
        id={sample.id}
        custody={{
          heldBy: sample.heldBy?.name ?? null,
          heldSince: sample.heldSince?.toISOString() ?? null,
          dueBack: sample.dueBack?.toISOString() ?? null,
        }}
        where={[sample.freezer?.name, sample.rack, sample.box, sample.position].filter(Boolean).join(' · ')}
      />
      <SampleBarcode code={sample.sampleId} caption={sample.name} />
      <QuantityPanel
        sample={{
          id: sample.id,
          amount: sample.amount,
          amountUnit: sample.amountUnit,
          concValue: sample.concValue,
          concPer: sample.concPer,
          concVolume: sample.concVolume,
          lot: sample.lot,
          expiresAt: sample.expiresAt?.toISOString() ?? null,
        }}
        uses={sample.uses.map(u => ({
          id: u.id,
          amount: u.amount,
          unit: u.unit,
          note: u.note,
          usedAt: u.usedAt.toISOString(),
          usedBy: u.usedBy?.name ?? null,
        }))}
      />
    </div>
  );
}
