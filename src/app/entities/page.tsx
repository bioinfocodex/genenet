import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { Boxes, Plus } from 'lucide-react';
import EntityTypeBuilder from './builder';

export const dynamic = 'force-dynamic';

export default async function EntitiesPage() {
  const user = await requireUser();

  const types = await prisma.entityType.findMany({
    where: { archived: false },
    include: {
      fields: { orderBy: { order: 'asc' } },
      _count: { select: { entities: true } },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <Boxes size={26} /> Record Types
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          Everything else in GeneNet is a decision someone else made about what a lab tracks. Here the
          lab decides: name a type, give it the fields it actually has, and it behaves like any other
          record — searchable, linkable, and part of the audit trail.
        </p>
      </div>

      {types.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            No types yet. A strain, an antibody, a cell line, a mouse colony — anything the lab keeps
            track of that does not fit a sequence or a sample.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.9rem', marginBottom: '1.5rem' }}>
          {types.map(t => (
            <Link key={t.id} href={`/entities/${t.id}`} className="glass-panel" style={{
              padding: '1.15rem 1.3rem', textDecoration: 'none', color: 'inherit',
              borderLeft: `4px solid ${t.color}`, display: 'block',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.98rem' }}>{t.plural}</strong>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t.prefix}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {t._count.entities} record{t._count.entities === 1 ? '' : 's'} &middot;{' '}
                {t.fields.length} field{t.fields.length === 1 ? '' : 's'}
              </div>
              {t.description && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
                  {t.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      {user.role === 'ADMIN' ? (
        <EntityTypeBuilder existingTypes={types.map(t => ({ id: t.id, name: t.name }))} />
      ) : (
        <div className="glass-panel" style={{ padding: '1.1rem 1.35rem' }}>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            <Plus size={13} style={{ verticalAlign: '-2px' }} /> Defining a new type is an admin action.
            Anyone can add records to a type that already exists — ask an admin to set one up.
          </p>
        </div>
      )}
    </div>
  );
}
