import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { Boxes } from 'lucide-react';
import { format as formatValue, type FieldDefinition, type FieldType } from '@/lib/fields';
import EntityForm from './form';

export const dynamic = 'force-dynamic';

export default async function EntityTypePage({
  params,
}: {
  params: Promise<{ typeId: string }>;
}) {
  await requireUser();
  const { typeId } = await params;

  const type = await prisma.entityType.findUnique({
    where: { id: typeId },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  if (!type) notFound();

  const [entities, projects, sequences, samples, linkables] = await Promise.all([
    prisma.entity.findMany({
      where: { entityTypeId: typeId, archived: false },
      include: { values: true, project: { select: { name: true } } },
      orderBy: { code: 'asc' },
    }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    type.fields.some(f => f.type === 'sequence')
      ? prisma.geneSequence.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 })
      : Promise.resolve([]),
    type.fields.some(f => f.type === 'sample')
      ? prisma.sample.findMany({ select: { id: true, name: true, sampleId: true }, orderBy: { sampleId: 'asc' }, take: 500 })
      : Promise.resolve([]),
    prisma.entity.findMany({
      where: { entityTypeId: { in: type.fields.map(f => f.linkTypeId).filter((x): x is string => !!x) } },
      select: { id: true, code: true, name: true, entityTypeId: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  const defs: FieldDefinition[] = type.fields.map(f => ({
    id: f.id, key: f.key, label: f.label, type: f.type as FieldType,
    required: f.required, isUnique: f.isUnique,
    options: f.options ? (JSON.parse(f.options) as string[]) : null,
    linkTypeId: f.linkTypeId, unit: f.unit, helpText: f.helpText, order: f.order,
  }));

  // The first four fields go in the table; the rest live on the record page.
  // A table wide enough to hold twenty custom fields is a table nobody reads.
  const columns = defs.slice(0, 4);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/entities" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>&larr; Record types</Link>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem', marginTop: '0.3rem' }}>
          <Boxes size={26} color={type.color} /> {type.plural}
        </h1>
        {type.description && (
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '70ch', lineHeight: 1.6 }}>
            {type.description}
          </p>
        )}
      </div>

      <EntityForm
        type={{ id: type.id, name: type.name, prefix: type.prefix, color: type.color }}
        defs={defs}
        projects={projects}
        sequences={sequences}
        samples={samples}
        linkables={linkables}
      />

      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.85rem' }}>
          {entities.length} {entities.length === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()}
        </h2>

        {entities.length === 0 ? (
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: 0 }}>
            Nothing recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem', minWidth: 520 }}>
              <thead>
                <tr>
                  {['Code', 'Name', ...columns.map(c => c.label), 'Project'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '0.35rem 0.6rem', color: 'var(--text-muted)',
                      fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase',
                      letterSpacing: '0.04em', borderBottom: '1px solid var(--glass-border)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entities.map(e => {
                  const byField = new Map(e.values.map(v => [v.fieldId, v]));
                  return (
                    <tr key={e.id}>
                      <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        <Link href={`/entities/record/${e.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                          {e.code}
                        </Link>
                      </td>
                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{e.name}</td>
                      {columns.map(c => (
                        <td key={c.key} style={{ padding: '0.4rem 0.6rem', color: 'var(--text-secondary)' }}>
                          {formatValue(c, byField.get(c.id!))}
                        </td>
                      ))}
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-muted)' }}>
                        {e.project?.name ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {defs.length > columns.length && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
                {defs.length - columns.length} more field{defs.length - columns.length === 1 ? '' : 's'} on each record.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
