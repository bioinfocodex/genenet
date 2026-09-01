import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { Boxes } from 'lucide-react';
import { format as formatValue, decode, type FieldDefinition, type FieldType } from '@/lib/fields';
import EntityForm from '../../[typeId]/form';

export const dynamic = 'force-dynamic';

export default async function EntityRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const entity = await prisma.entity.findUnique({
    where: { id },
    include: {
      entityType: { include: { fields: { orderBy: { order: 'asc' } } } },
      values: true,
      project: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      wells: { include: { plate: { select: { id: true, name: true } } } },
    },
  });
  if (!entity) notFound();

  const type = entity.entityType;
  const defs: FieldDefinition[] = type.fields.map(f => ({
    id: f.id, key: f.key, label: f.label, type: f.type as FieldType,
    required: f.required, isUnique: f.isUnique,
    options: f.options ? (JSON.parse(f.options) as string[]) : null,
    linkTypeId: f.linkTypeId, unit: f.unit, helpText: f.helpText, order: f.order,
  }));

  const byField = new Map(entity.values.map(v => [v.fieldId, v]));

  const [projects, sequences, samples, linkables, referencedBy] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    defs.some(f => f.type === 'sequence')
      ? prisma.geneSequence.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 })
      : Promise.resolve([]),
    defs.some(f => f.type === 'sample')
      ? prisma.sample.findMany({ select: { id: true, name: true, sampleId: true }, orderBy: { sampleId: 'asc' }, take: 500 })
      : Promise.resolve([]),
    prisma.entity.findMany({
      where: { entityTypeId: { in: defs.map(f => f.linkTypeId).filter((x): x is string => !!x) } },
      select: { id: true, code: true, name: true, entityTypeId: true },
      orderBy: { code: 'asc' },
    }),
    // What points at this record. Without it a link is one-way, and the
    // question people actually ask — "what used this strain?" — has no answer.
    prisma.fieldValue.findMany({
      where: { refEntityId: id, entityId: { not: null } },
      include: {
        field: { select: { label: true } },
        entity: { select: { id: true, code: true, name: true, entityType: { select: { name: true } } } },
      },
    }),
  ]);

  // Values as the form wants them back: decoded, and dates as yyyy-mm-dd.
  const initialValues: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = byField.get(def.id!);
    const v = decode(def, raw);
    initialValues[def.key] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href={`/entities/${type.id}`} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          &larr; {type.plural}
        </Link>
        <h1 style={{
          fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: '0.7rem',
          marginTop: '0.3rem', marginBottom: '0.2rem',
        }}>
          <Boxes size={22} color={type.color} /> {entity.name}
          <span style={{ fontFamily: 'monospace', fontSize: '0.95rem', color: 'var(--text-muted)', fontWeight: 400 }}>
            {entity.code}
          </span>
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          {type.name}
          {entity.project && <> &middot; <Link href={`/projects/${entity.project.id}`} style={{ color: 'var(--accent-blue)' }}>{entity.project.name}</Link></>}
          {entity.createdBy && <> &middot; added by {entity.createdBy.name}</>}
          {' '}&middot; {entity.createdAt.toLocaleDateString()}
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.9rem' }}>Details</h2>
        <dl style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '0.9rem 1.4rem', margin: 0,
        }}>
          {defs.map(def => (
            <div key={def.key}>
              <dt style={{
                fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.15rem',
              }}>
                {def.label}
              </dt>
              <dd style={{ margin: 0, fontSize: '0.9rem' }}>{formatValue(def, byField.get(def.id!))}</dd>
            </div>
          ))}
        </dl>
      </div>

      {entity.wells.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.7rem' }}>On plates</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {entity.wells.map(w => (
              <Link key={w.id} href={`/plates/${w.plate.id}`} style={{
                fontSize: '0.78rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: 5,
                border: '1px solid var(--glass-border)', color: 'var(--accent-blue)', textDecoration: 'none',
              }}>
                {w.plate.name} · {w.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {referencedBy.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.7rem' }}>Referenced by</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {referencedBy.map(r => r.entity && (
              <div key={r.id} style={{ fontSize: '0.85rem' }}>
                <Link href={`/entities/record/${r.entity.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                  {r.entity.code} · {r.entity.name}
                </Link>
                <span style={{ color: 'var(--text-muted)' }}> — {r.entity.entityType.name}, as {r.field.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <EntityForm
        type={{ id: type.id, name: type.name, prefix: type.prefix, color: type.color }}
        defs={defs}
        projects={projects}
        sequences={sequences}
        samples={samples}
        linkables={linkables}
        entityId={entity.id}
        initial={{ name: entity.name, projectId: entity.projectId, values: initialValues }}
      />
    </div>
  );
}
