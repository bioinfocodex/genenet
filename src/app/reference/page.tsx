import { requireUser } from '@/lib/auth-guard';
import { BookMarked } from 'lucide-react';
import { REFERENCE_VECTORS, STANDARD_PRIMERS } from '@/lib/reference-content';
import { referenceStatus } from '@/app/actions/reference';
import ReferenceClient from './client';

export const dynamic = 'force-dynamic';

export default async function ReferencePage() {
  await requireUser();
  const status = await referenceStatus();
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <BookMarked size={26} /> Reference content
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '75ch', lineHeight: 1.6 }}>
        Widely used vectors and universal primers, so a new plasmid has something to be compared with and the M13s are
        already on every map they anneal to. Vectors are fetched from GenBank when you import them and annotated on the
        way in; nothing here is a sequence typed from memory. Each primer was checked to anneal, full length, to at
        least one of these vectors.
      </p>
      <ReferenceClient vectors={REFERENCE_VECTORS} primers={STANDARD_PRIMERS} status={status} />
    </div>
  );
}
