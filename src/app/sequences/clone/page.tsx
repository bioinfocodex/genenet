import { prisma } from '@/lib/prisma';
import CloningWizard from '@/components/CloningWizard';
import Link from 'next/link';
import { Scissors } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ClonePage() {
  const sequences = await prisma.geneSequence.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Scissors size={28} /> Cloning Wizard
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Simulate restriction enzyme cloning — see expected gels, compatibility, and step-by-step protocol.
          </p>
        </div>
        <Link href="/sequences" className="btn btn-secondary">← Sequence Library</Link>
      </div>

      <CloningWizard sequences={sequences} />
    </div>
  );
}
