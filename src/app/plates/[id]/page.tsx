import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { Grid3x3 } from 'lucide-react';
import { formatOf, summarise } from '@/lib/plates';
import PlateClient from './client';

export const dynamic = 'force-dynamic';

export default async function PlatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const plate = await prisma.plate.findUnique({
    where: { id },
    include: {
      wells: {
        include: {
          sample: { select: { id: true, sampleId: true, name: true } },
          entity: { select: { id: true, code: true, name: true } },
          sequence: { select: { id: true, name: true } },
        },
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
      },
      project: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      transfersIn: {
        include: { source: { select: { id: true, name: true } }, performedBy: { select: { name: true } }, _count: { select: { wells: true } } },
        orderBy: { performedAt: 'desc' },
      },
      transfersOut: {
        include: { dest: { select: { id: true, name: true } }, performedBy: { select: { name: true } }, _count: { select: { wells: true } } },
        orderBy: { performedAt: 'desc' },
      },
    },
  });
  if (!plate) notFound();

  const [samples, entities, sequences, otherPlates] = await Promise.all([
    prisma.sample.findMany({ select: { id: true, sampleId: true, name: true }, orderBy: { sampleId: 'asc' }, take: 500 }),
    prisma.entity.findMany({ where: { archived: false }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 500 }),
    prisma.geneSequence.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.plate.findMany({
      where: { archived: false, id: { not: id } },
      select: { id: true, name: true, format: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const f = formatOf(plate.format);
  const stats = summarise(plate.wells, f);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/plates" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>&larr; Plates</Link>
        <h1 style={{ fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: '0.7rem', marginTop: '0.3rem', marginBottom: '0.2rem' }}>
          <Grid3x3 size={22} /> {plate.name}
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          {f.name} &middot; {stats.filled} of {stats.total} wells used
          {plate.barcode && <> &middot; <span style={{ fontFamily: 'monospace' }}>{plate.barcode}</span></>}
          {plate.project && <> &middot; <Link href={`/projects/${plate.project.id}`} style={{ color: 'var(--accent-blue)' }}>{plate.project.name}</Link></>}
          {plate.createdBy && <> &middot; {plate.createdBy.name}</>}
        </p>
      </div>

      <PlateClient
        plate={{ id: plate.id, name: plate.name, format: plate.format }}
        wells={plate.wells.map(w => ({
          id: w.id, row: w.row, col: w.col, label: w.label,
          role: w.role, content: w.content, notes: w.notes,
          volumeUl: w.volumeUl, concentration: w.concentration, concentrationUnit: w.concentrationUnit,
          sampleId: w.sampleId, entityId: w.entityId, sequenceId: w.sequenceId,
          sampleName: w.sample ? `${w.sample.sampleId} · ${w.sample.name}` : null,
          entityName: w.entity ? `${w.entity.code} · ${w.entity.name}` : null,
          sequenceName: w.sequence?.name ?? null,
        }))}
        samples={samples}
        entities={entities}
        sequences={sequences}
        otherPlates={otherPlates}
      />

      {(plate.transfersIn.length > 0 || plate.transfersOut.length > 0) && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.8rem' }}>Transfers</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {plate.transfersIn.map(t => (
              <div key={t.id} style={{ fontSize: '0.84rem', lineHeight: 1.55 }}>
                <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>in</span>{' '}
                {t._count.wells} well{t._count.wells === 1 ? '' : 's'} from{' '}
                <Link href={`/plates/${t.source.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{t.source.name}</Link>
                {' '}({t.kind})
                <span style={{ color: 'var(--text-muted)' }}>
                  {' — '}{t.performedBy?.name ?? 'someone'}, {t.performedAt.toLocaleDateString()}
                </span>
              </div>
            ))}
            {plate.transfersOut.map(t => (
              <div key={t.id} style={{ fontSize: '0.84rem', lineHeight: 1.55 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>out</span>{' '}
                {t._count.wells} well{t._count.wells === 1 ? '' : 's'} to{' '}
                <Link href={`/plates/${t.dest.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{t.dest.name}</Link>
                {' '}({t.kind})
                <span style={{ color: 'var(--text-muted)' }}>
                  {' — '}{t.performedBy?.name ?? 'someone'}, {t.performedAt.toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
