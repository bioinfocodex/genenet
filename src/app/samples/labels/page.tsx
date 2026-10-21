import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import LabelSheetClient from './client';

export const dynamic = 'force-dynamic';

/**
 * A sheet of labels for the printer that is already on the bench.
 *
 * Which samples appear is a query parameter rather than a saved selection,
 * so the page can be reached from a sample, from a freezer box, or by hand --
 * and so that printing a sheet leaves nothing behind to go stale.
 */
export default async function LabelSheetPage({ searchParams }: {
  searchParams: Promise<{ ids?: string }>;
}) {
  await requireUser();
  const { ids } = await searchParams;
  const wanted = (ids ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const samples = await prisma.sample.findMany({
    where: wanted.length ? { sampleId: { in: wanted } } : undefined,
    orderBy: { sampleId: 'asc' },
    take: 500,
    select: {
      sampleId: true, name: true, type: true,
      freezer: { select: { name: true } },
      box: true, position: true,
    },
  });

  return (
    <LabelSheetClient
      asked={wanted}
      samples={samples.map(s => ({
        code: s.sampleId,
        name: s.name,
        where: [s.freezer?.name, s.box, s.position].filter(Boolean).join(' · '),
      }))}
    />
  );
}
