import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { pointsFor, plateFormatFor } from '@/lib/dashboard-data';
import DashboardsClient from './client';

export const dynamic = 'force-dynamic';

export default async function DashboardsPage() {
  await requireUser();

  const [dashboards, schemas, projects] = await Promise.all([
    prisma.dashboard.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        schema: { select: { id: true, name: true, fields: { select: { key: true, label: true, type: true } } } },
        project: { select: { name: true } },
      },
    }),
    prisma.resultSchema.findMany({
      where: { archived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, fields: { select: { key: true, label: true, type: true }, orderBy: { order: 'asc' } } },
    }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  // Read in parallel, because a page of six charts should not take six turns.
  const charts = await Promise.all(dashboards.map(async d => {
    const [data, format] = await Promise.all([pointsFor(d), plateFormatFor(d.schemaId)]);
    const label = (key: string | null) =>
      (key && d.schema.fields.find(f => f.key === key)?.label) || null;
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      schemaId: d.schemaId,
      schemaName: d.schema.name,
      projectName: d.project?.name ?? null,
      xKey: d.xKey,
      yKey: d.yKey,
      groupKey: d.groupKey,
      xLabel: label(d.xKey) ?? 'Measured',
      yLabel: label(d.yKey) ?? d.yKey,
      format,
      points: data.points,
      blank: data.blank,
      problem: data.problem ?? null,
    };
  }));

  return <DashboardsClient charts={charts} schemas={schemas} projects={projects} />;
}
