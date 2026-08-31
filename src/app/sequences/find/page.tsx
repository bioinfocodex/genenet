import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { ScanSearch } from 'lucide-react';
import FindClient from './client';

export const dynamic = 'force-dynamic';

export default async function FindPage() {
  await requireUser();

  const sequences = await prisma.geneSequence.findMany({
    select: { id: true, name: true, sequence: true, type: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <ScanSearch size={26} /> Search by Sequence
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          Paste DNA and find where it already occurs in the library. Both strands are searched, and a
          hit running past the origin of a circular plasmid is found whole rather than as two halves.
        </p>
      </div>
      <FindClient
        sequences={sequences.map(s => ({
          id: s.id,
          name: s.name,
          sequence: s.sequence,
          // Everything in the library is stored linear unless it says otherwise;
          // plasmids are the circular case and are the reason wrapping matters.
          topology: s.type === 'plasmid' ? ('circular' as const) : ('linear' as const),
        }))}
      />
    </div>
  );
}
