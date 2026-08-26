import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, FlaskConical } from 'lucide-react';
import ProteinViewer from '@/components/ProteinViewer';

export const dynamic = 'force-dynamic';

export default async function ProteinDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const protein = await prisma.protein.findUnique({
    where: { id },
    include: { geneSequence: { select: { id: true, name: true } } },
  });
  if (!protein) notFound();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        <Link href="/proteins" style={{ color: 'var(--accent-blue)' }}>Protein Library</Link>
        <ChevronRight size={13} />
        <span>{protein.name}</span>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem 2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
              <FlaskConical size={22} color="var(--accent-purple)" /> {protein.name}
            </h1>
            {protein.description && <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{protein.description}</p>}
            {protein.geneSequence && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Translated from: <Link href={`/sequences/${protein.geneSequence.id}`} style={{ color: 'var(--accent-blue)' }}>{protein.geneSequence.name}</Link>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/proteins/new" className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>+ New Protein</Link>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <ProteinViewer sequence={protein.sequence} />
      </div>
    </div>
  );
}
