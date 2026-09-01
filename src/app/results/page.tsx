import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { LineChart, Plus } from 'lucide-react';
import SchemaBuilder from './builder';

export const dynamic = 'force-dynamic';

export default async function ResultsPage() {
  const user = await requireUser();

  const [schemas, entityTypes] = await Promise.all([
    prisma.resultSchema.findMany({
      where: { archived: false },
      include: {
        fields: { orderBy: { order: 'asc' } },
        _count: { select: { results: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.entityType.findMany({
      where: { archived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <LineChart size={26} /> Assays
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          A result written as free text is a result nobody can plot. Declare the columns an assay
          produces &mdash; OD600 as a number, the verdict as a choice, the operator as text &mdash; and
          a year of readings can be compared without anyone re-reading them.
        </p>
      </div>

      {schemas.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            No assays defined yet. A plate-reader run, a Qubit quantification, a growth curve &mdash;
            anything measured more than once and worth comparing.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.9rem', marginBottom: '1.5rem' }}>
          {schemas.map(s => (
            <Link key={s.id} href={`/results/${s.id}`} className="glass-panel" style={{
              padding: '1.15rem 1.3rem', textDecoration: 'none', color: 'inherit', display: 'block',
            }}>
              <strong style={{ fontSize: '0.98rem' }}>{s.name}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {s._count.results} reading{s._count.results === 1 ? '' : 's'} &middot;{' '}
                {s.fields.length} field{s.fields.length === 1 ? '' : 's'}
              </div>
              {s.description && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
                  {s.description}
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.6rem' }}>
                {s.fields.slice(0, 5).map(f => (
                  <span key={f.id} style={{
                    fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 4,
                    border: '1px solid var(--glass-border)', color: 'var(--text-muted)',
                  }}>
                    {f.label}{f.unit ? ` (${f.unit})` : ''}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}

      {user.role === 'ADMIN' ? (
        <SchemaBuilder entityTypes={entityTypes} />
      ) : (
        <div className="glass-panel" style={{ padding: '1.1rem 1.35rem' }}>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            <Plus size={13} style={{ verticalAlign: '-2px' }} /> Defining an assay is an admin action &mdash;
            a schema anyone can extend stops being a schema. Anyone can record readings against one
            that exists.
          </p>
        </div>
      )}
    </div>
  );
}
