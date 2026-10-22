'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';

const KINDS = ['series', 'dose', 'heatmap', 'scatter'] as const;

/**
 * Saving a chart's definition, never its numbers.
 *
 * The points are read fresh every time it is shown, so a chart cannot go
 * stale. One that quietly did would be worse than no chart at all: it is
 * looked at precisely because nobody wants to re-run the query.
 */
export async function saveDashboard(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '').trim();
  const name = String(fd.get('name') ?? '').trim();
  const kind = String(fd.get('kind') ?? '');
  const schemaId = String(fd.get('schemaId') ?? '');
  const yKey = String(fd.get('yKey') ?? '').trim();
  const xKey = String(fd.get('xKey') ?? '').trim() || null;
  const groupKey = String(fd.get('groupKey') ?? '').trim() || null;
  const projectId = String(fd.get('projectId') ?? '').trim() || null;

  if (!name) return { error: 'A chart needs a name, or nobody will know what it is for.' };
  if (!(KINDS as readonly string[]).includes(kind)) return { error: 'That is not a kind of chart this draws.' };
  if (!schemaId || !yKey) return { error: 'Choose an assay and what to put on the y axis.' };

  const schema = await prisma.resultSchema.findUnique({
    where: { id: schemaId },
    select: { fields: { select: { key: true, type: true, label: true } } },
  });
  if (!schema) return { error: 'That assay no longer exists.' };

  const byKey = new Map(schema.fields.map(f => [f.key, f]));
  const y = byKey.get(yKey);
  if (!y) return { error: 'That field is not on this assay.' };
  if (y.type !== 'number' && y.type !== 'integer') {
    return { error: `${y.label} is not a number, so it cannot be an axis.` };
  }
  if (xKey) {
    const x = byKey.get(xKey);
    if (!x) return { error: 'That x field is not on this assay.' };
    if (x.type !== 'number' && x.type !== 'integer' && x.type !== 'date') {
      return { error: `${x.label} is neither a number nor a date, so it cannot be an x axis.` };
    }
  }
  /*
   * A heatmap is laid out by well, so an x field on one would be ignored.
   * Cleared rather than refused: somebody switching an existing chart to a
   * heatmap has not made a mistake, they have changed their mind.
   */
  const x = kind === 'heatmap' ? null : xKey;

  const data = { name, kind, schemaId, xKey: x, yKey, groupKey, projectId };

  const saved = id
    ? await prisma.dashboard.update({ where: { id }, data, select: { id: true } })
    : await prisma.dashboard.create({ data: { ...data, createdById: user.id }, select: { id: true } });

  revalidatePath('/dashboards');
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { ok: true as const, id: saved.id };
}

export async function deleteDashboard(fd: FormData) {
  await requireUser();
  const id = String(fd.get('id') ?? '');
  if (!id) return { error: 'No chart.' };
  await prisma.dashboard.delete({ where: { id } });
  revalidatePath('/dashboards');
  return { ok: true as const };
}
