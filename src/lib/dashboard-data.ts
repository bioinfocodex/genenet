import 'server-only';
import { prisma } from './prisma';
import type { Point } from './charts';

/**
 * The points behind a chart, read fresh.
 *
 * A dashboard stores its definition and never its numbers, so it shows what is
 * recorded now rather than what was recorded when somebody saved it. A chart
 * that quietly went stale would be worse than no chart: it is looked at
 * precisely because nobody wants to re-run the query.
 */

export interface ChartData {
  points: Point[];
  /** Readings with no number, counted rather than silently dropped. */
  blank: number;
  /** Set when the axes cannot be read from this assay's fields. */
  problem?: string;
}

export async function pointsFor(dashboard: {
  schemaId: string;
  xKey: string | null;
  yKey: string;
  groupKey: string | null;
  kind: string;
}): Promise<ChartData> {
  const schema = await prisma.resultSchema.findUnique({
    where: { id: dashboard.schemaId },
    include: { fields: true },
  });
  if (!schema) return { points: [], blank: 0, problem: 'That assay no longer exists.' };

  const byKey = new Map(schema.fields.map(f => [f.key, f]));
  const yField = byKey.get(dashboard.yKey);
  if (!yField) return { points: [], blank: 0, problem: `This chart reads a field called "${dashboard.yKey}", which the assay no longer has.` };

  const xField = dashboard.xKey ? byKey.get(dashboard.xKey) : null;
  if (dashboard.xKey && !xField) {
    return { points: [], blank: 0, problem: `This chart reads a field called "${dashboard.xKey}", which the assay no longer has.` };
  }
  const groupField = dashboard.groupKey ? byKey.get(dashboard.groupKey) : null;

  const results = await prisma.assayResult.findMany({
    where: { schemaId: dashboard.schemaId },
    orderBy: { measuredAt: 'asc' },
    take: 20_000,
    select: {
      id: true, measuredAt: true,
      values: { select: { fieldId: true, number: true, text: true, date: true, boolean: true } },
      well: { select: { row: true, col: true, plate: { select: { format: true, name: true } } } },
      sample: { select: { name: true, sampleId: true } },
    },
  });

  const points: Point[] = [];
  let blank = 0;

  for (const r of results) {
    const value = (fieldId: string) => r.values.find(v => v.fieldId === fieldId);

    const y = value(yField.id)?.number;
    if (y === null || y === undefined) { blank++; continue; }

    /*
     * Without an x field the measurement time is the x axis, which is what a
     * time series over a stability study or a growth curve actually is. A
     * chart that refused to draw without an explicit x would make somebody
     * add a column holding the date that is already on the row.
     */
    let x: number;
    if (!xField) {
      x = r.measuredAt.getTime();
    } else {
      const xv = value(xField.id);
      const raw = xv?.number ?? (xv?.date ? xv.date.getTime() : null);
      if (raw === null || raw === undefined) { blank++; continue; }
      x = raw;
    }

    const groupValue = groupField ? value(groupField.id) : null;
    const series = groupValue
      ? String(groupValue.text ?? groupValue.number ?? groupValue.boolean ?? '—')
      : (r.sample?.name ?? yField.label);

    points.push({
      series,
      x,
      y,
      id: r.id,
      ...(r.well ? { well: `${String.fromCharCode(65 + r.well.row)}${r.well.col + 1}` } : {}),
    });
  }

  return { points, blank };
}

/** The plate a heatmap is drawn on, taken from the results themselves. */
export async function plateFormatFor(schemaId: string): Promise<number> {
  const withWell = await prisma.assayResult.findFirst({
    where: { schemaId, wellId: { not: null } },
    select: { well: { select: { plate: { select: { format: true } } } } },
  });
  return withWell?.well?.plate.format ?? 96;
}
