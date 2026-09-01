import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { LineChart } from 'lucide-react';
import type { FieldDefinition, FieldType } from '@/lib/fields';
import ResultsClient from './client';

export const dynamic = 'force-dynamic';

export default async function ResultSchemaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const schema = await prisma.resultSchema.findUnique({
    where: { id },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  if (!schema) notFound();

  const [results, samples, entities, tasks, plates] = await Promise.all([
    prisma.assayResult.findMany({
      where: { schemaId: id },
      include: {
        values: true,
        recordedBy: { select: { name: true } },
        sample: { select: { id: true, sampleId: true, name: true } },
        entity: { select: { id: true, code: true, name: true } },
        task: { select: { id: true, title: true } },
        well: { select: { id: true, label: true, plate: { select: { id: true, name: true } } } },
      },
      orderBy: { measuredAt: 'desc' },
      take: 1000,
    }),
    prisma.sample.findMany({ select: { id: true, sampleId: true, name: true }, orderBy: { sampleId: 'asc' }, take: 500 }),
    prisma.entity.findMany({ where: { archived: false }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 500 }),
    prisma.task.findMany({ select: { id: true, title: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.plate.findMany({ where: { archived: false }, select: { id: true, name: true, format: true }, orderBy: { name: 'asc' } }),
  ]);

  const defs: FieldDefinition[] = schema.fields.map(f => ({
    id: f.id, key: f.key, label: f.label, type: f.type as FieldType,
    required: f.required, isUnique: f.isUnique,
    options: f.options ? (JSON.parse(f.options) as string[]) : null,
    linkTypeId: f.linkTypeId, unit: f.unit, helpText: f.helpText, order: f.order,
  }));

  return (
    <div style={{ maxWidth: '1150px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/results" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>&larr; Assays</Link>
        <h1 style={{ fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem', marginBottom: '0.2rem' }}>
          <LineChart size={22} /> {schema.name}
        </h1>
        {schema.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', margin: 0, maxWidth: '70ch', lineHeight: 1.6 }}>
            {schema.description}
          </p>
        )}
      </div>

      <ResultsClient
        schema={{ id: schema.id, name: schema.name }}
        defs={defs}
        results={results.map(r => ({
          id: r.id,
          measuredAt: r.measuredAt.toISOString(),
          recordedBy: r.recordedBy?.name ?? null,
          canDelete: r.recordedById === user.id || user.role === 'ADMIN',
          values: r.values.map(v => ({
            fieldId: v.fieldId, text: v.text, number: v.number, boolean: v.boolean,
            date: v.date ? v.date.toISOString() : null, refId: v.refId, refEntityId: v.refEntityId,
          })),
          target: r.sample
            ? { kind: 'sample' as const, id: r.sample.id, label: `${r.sample.sampleId} · ${r.sample.name}`, href: `/samples/${r.sample.id}` }
            : r.entity
              ? { kind: 'entity' as const, id: r.entity.id, label: `${r.entity.code} · ${r.entity.name}`, href: `/entities/record/${r.entity.id}` }
              : r.well
                ? { kind: 'well' as const, id: r.well.id, label: `${r.well.plate.name} · ${r.well.label}`, href: `/plates/${r.well.plate.id}` }
                : r.task
                  ? { kind: 'task' as const, id: r.task.id, label: r.task.title, href: `/tasks/${r.task.id}` }
                  : null,
        }))}
        samples={samples}
        entities={entities}
        tasks={tasks}
        plates={plates}
      />
    </div>
  );
}
