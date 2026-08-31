import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { GitBranch } from 'lucide-react';
import PhylogenyClient from './client';

export const dynamic = 'force-dynamic';

export default async function PhylogenyPage() {
  await requireUser();

  const sequences = await prisma.geneSequence.findMany({
    select: { id: true, name: true, size: true, type: true, sequence: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <GitBranch size={26} /> Phylogenetic Tree
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '70ch', lineHeight: 1.6 }}>
          Aligns the sequences you pick, measures how far apart they are, and builds a tree from
          those distances. Export the result as Newick to open it in FigTree, iTOL or MEGA.
        </p>
      </div>
      <PhylogenyClient sequences={sequences} />
    </div>
  );
}
