import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import FreezerViewer from '@/components/FreezerViewer';
import FreezersClient from './client';
import OutOfFreezer from '@/components/samples/OutOfFreezer';

export const dynamic = 'force-dynamic';

export default async function FreezersPage() {
  /*
   * What is not in a freezer, asked for separately.
   *
   * A map of the shelves cannot show a tube that is on somebody's bench, and
   * a map that silently leaves one out is the reason people stop trusting it.
   * Listed above the map rather than below, because "who has it" is the
   * question somebody standing at an empty slot is actually asking.
   */
  const out = await prisma.sample.findMany({
    where: { heldById: { not: null } },
    orderBy: [{ dueBack: 'asc' }, { heldSince: 'asc' }],
    select: {
      id: true, sampleId: true, name: true,
      heldSince: true, dueBack: true,
      heldBy: { select: { name: true } },
      freezer: { select: { name: true } },
    },
  });

  const freezers = await prisma.freezer.findMany({
    orderBy: { temperature: 'asc' },
    include: {
      samples: {
        select: { id: true, sampleId: true, name: true, type: true, status: true, rack: true, box: true, position: true },
      },
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '2rem' }}>🧊 Freezer Inventory</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
            Visual storage map · {freezers.length} freezer{freezers.length !== 1 ? 's' : ''} · {freezers.reduce((a, f) => a + f.samples.length, 0)} samples total
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <Link href="/samples" className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>🧪 All Samples</Link>
          <FreezersClient />
        </div>
      </div>

      <OutOfFreezer
        samples={out.map(s => ({
          id: s.id,
          code: s.sampleId,
          name: s.name,
          from: s.freezer?.name ?? null,
          custody: {
            heldBy: s.heldBy?.name ?? null,
            heldSince: s.heldSince?.toISOString() ?? null,
            dueBack: s.dueBack?.toISOString() ?? null,
          },
        }))}
      />

      <FreezerViewer freezers={freezers} />
    </div>
  );
}
