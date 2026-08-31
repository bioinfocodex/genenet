import { requireUser } from '@/lib/auth-guard';
import { Layers3 } from 'lucide-react';
import AssembleClient from './client';

export const dynamic = 'force-dynamic';

export default async function AssemblePage() {
  await requireUser();

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <Layers3 size={26} /> Assemble Sanger Reads
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          Paste the reads back from sequencing and get one contig. Reads off the reverse primer are
          flipped automatically, the unreliable ends are trimmed before anything is joined, and every
          position where the reads disagree is listed rather than quietly voted away.
        </p>
      </div>
      <AssembleClient />
    </div>
  );
}
