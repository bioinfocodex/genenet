import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { Wand2 } from 'lucide-react';
import OptimiseClient from './client';

export const dynamic = 'force-dynamic';

export default async function OptimisePage() {
  await requireUser();

  const sequences = await prisma.geneSequence.findMany({
    select: { id: true, name: true, sequence: true },
    orderBy: { name: 'asc' },
    take: 300,
  });

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <Wand2 size={26} /> Gene Design
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          Rewrite a coding sequence for a different host, or place a diagnostic restriction site in
          one, without changing the protein. Every change here is synonymous, and the protein is
          checked against the original before anything is shown.
        </p>
      </div>
      <OptimiseClient sequences={sequences} />
    </div>
  );
}
