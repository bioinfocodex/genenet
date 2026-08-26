import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Database, Dna } from 'lucide-react';
import SequenceViewer, { type SequenceFeature } from '@/components/SequenceViewer';

export const dynamic = 'force-dynamic';

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const seq = await prisma.geneSequence.findUnique({
    where: { id },
    include: {
      primers: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!seq) notFound();

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        <Link href="/sequences" style={{ color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Database size={13} /> Sequence Library
        </Link>
        <ChevronRight size={13} />
        <span>{seq.name}</span>
      </div>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '1.5rem 2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px',
                background: seq.type === 'plasmid' ? 'rgba(37,99,235,0.1)' : 'rgba(5,150,105,0.1)',
                color: seq.type === 'plasmid' ? 'var(--accent-blue)' : 'var(--accent-green)',
                border: `1px solid ${seq.type === 'plasmid' ? 'rgba(37,99,235,0.2)' : 'rgba(5,150,105,0.2)'}`,
              }}>
                {seq.type === 'plasmid' ? 'PLASMID' : 'GENE'}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{seq.size.toLocaleString()} bp</span>
            </div>
            <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <Dna size={22} color="var(--accent-blue)" />
              {seq.name}
            </h1>
            {seq.description && (
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>{seq.description}</p>
            )}
            {seq.tags && (
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {seq.tags.split(',').map(t => (
                  <span key={t} style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                    {t.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <Link href="/sequences/new" className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>
              + New Sequence
            </Link>
          </div>
        </div>
      </div>

      {/* Sequence Viewer */}
      <SequenceViewer
        id={seq.id}
        name={seq.name}
        sequence={seq.sequence}
        size={seq.size}
        seqType={seq.type}
        initialFeatures={(() => { try { return JSON.parse(seq.features ?? '[]') as SequenceFeature[]; } catch { return []; } })()}
        initialPrimers={seq.primers.map(p => ({
          id: p.id,
          name: p.name,
          sequence: p.sequence,
          direction: p.direction,
          tm: p.tm ?? 0,
          gcContent: p.gcContent ?? 0,
          notes: p.notes ?? undefined,
        }))}
      />
    </div>
  );
}
