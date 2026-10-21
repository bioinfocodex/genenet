import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { FlaskConical } from 'lucide-react';
import WorkbenchClient from './client';

export const dynamic = 'force-dynamic';

export default async function WorkbenchPage() {
  await requireUser();
  const sequences = await prisma.geneSequence.findMany({
    select: { id: true, name: true, type: true, sequence: true, size: true, features: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <FlaskConical size={26} /> Fragment workbench
      </h1>
      <p style={{ color: 'var(--text-secondary)', margin: '0.3rem 0 1.25rem', fontSize: '0.88rem', maxWidth: '75ch', lineHeight: 1.6 }}>
        The bench between a digest and a ligation. The Cloning Wizard asks for a method and gives a product; this asks
        for nothing. Put fragments up from a digest, from a sequence whole, or from two annealed oligos, then blunt,
        dephosphorylate or phosphorylate them until their ends fit — and see what ligating them would actually give.
      </p>
      <WorkbenchClient sequences={sequences} />
    </div>
  );
}
