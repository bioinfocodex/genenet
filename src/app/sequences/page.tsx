import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Database, Plus, Scissors } from 'lucide-react';
import SequenceLibrary from '@/components/SequenceLibrary';

export const dynamic = 'force-dynamic';

export default async function SequencesPage() {
  const sequences = await prisma.geneSequence.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Database size={28} /> Sequence Library
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Store gene and plasmid sequences · click any row to explore restriction sites, add features, and view the sequence map.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link href="/sequences/clone" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Scissors size={16} /> Cloning Wizard
          </Link>
          <Link href="/sequences/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={16} /> Add Sequence
          </Link>
        </div>
      </div>

      {sequences.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧬</div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No sequences yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
            Add gene sequences and plasmid sequences to start exploring restriction sites and simulating cloning.
          </p>
          <Link href="/sequences/new" className="btn btn-primary">Add First Sequence</Link>
        </div>
      ) : (
        <SequenceLibrary sequences={sequences} />
      )}
    </div>
  );
}
