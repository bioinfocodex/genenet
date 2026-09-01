import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { Grid3x3 } from 'lucide-react';
import { formatOf, isEmpty } from '@/lib/plates';
import NewPlate from './new-plate';

export const dynamic = 'force-dynamic';

export default async function PlatesPage() {
  await requireUser();

  const [plates, projects] = await Promise.all([
    prisma.plate.findMany({
      where: { archived: false },
      include: {
        wells: { select: { sampleId: true, entityId: true, sequenceId: true, content: true, row: true, col: true, label: true } },
        project: { select: { name: true } },
        _count: { select: { transfersIn: true, transfersOut: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <Grid3x3 size={26} /> Plates
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          Freezer, rack, box and position describe where one tube sits. They cannot describe a screen,
          where the identity of a sample is its coordinates and ninety-six of them were handled as one
          object. Plates can be filled, stamped, cherry-picked and diluted, and every transfer records
          which well each thing came from.
        </p>
      </div>

      <NewPlate projects={projects} />

      {plates.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', marginTop: '1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>No plates yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.9rem', marginTop: '1.5rem' }}>
          {plates.map(p => {
            const filled = p.wells.filter(w => !isEmpty(w)).length;
            const f = formatOf(p.format);
            return (
              <Link key={p.id} href={`/plates/${p.id}`} className="glass-panel" style={{
                padding: '1.15rem 1.3rem', textDecoration: 'none', color: 'inherit', display: 'block',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                  <strong style={{ fontSize: '0.98rem' }}>{p.name}</strong>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{f.name}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {filled} of {f.wells} wells used
                  {p.project && <> &middot; {p.project.name}</>}
                </div>
                {/* A miniature of the layout: what the plate is, at a glance. */}
                <div style={{
                  display: 'grid', gap: 1, marginTop: '0.7rem',
                  gridTemplateColumns: `repeat(${f.cols}, 1fr)`,
                }}>
                  {[...p.wells].sort((a, b) => a.row - b.row || a.col - b.col).map(w => (
                    <span key={w.label} style={{
                      aspectRatio: '1', borderRadius: '50%',
                      background: isEmpty(w) ? 'var(--glass-border)' : 'var(--accent-blue)',
                      opacity: isEmpty(w) ? 0.5 : 0.9,
                    }} />
                  ))}
                </div>
                {(p._count.transfersIn > 0 || p._count.transfersOut > 0) && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.55rem' }}>
                    {p._count.transfersIn > 0 && `${p._count.transfersIn} in`}
                    {p._count.transfersIn > 0 && p._count.transfersOut > 0 && ' · '}
                    {p._count.transfersOut > 0 && `${p._count.transfersOut} out`}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
