import { prisma } from '@/lib/prisma';
import { normaliseFeatures } from '@/lib/features';
import { fullLibrary } from '@/lib/feature-library';
import { readDesk } from '@/lib/workspace';
import WorkspaceClient, { type TreeGroup, type OpenSequence } from './client';

export const dynamic = 'force-dynamic';

/**
 * Several sequences open at once, with the folders down the side.
 *
 * The detail page answers "show me this one". This answers the question people
 * actually have open all day -- comparing an insert against its vector, or
 * working through a set -- which the detail page can only do by going back to
 * the list and losing where you were.
 *
 * Which tabs are open lives in the URL rather than in component state, so a
 * reload, a back button or a pasted link all restore the same desk. It is also
 * what keeps the fetching honest: only the open records are read in full.
 */
export default async function WorkspacePage(
  { searchParams }: { searchParams: Promise<{ open?: string; active?: string }> },
) {
  const sp = await searchParams;
  // Parsed by the same function that writes it, so a hand-edited URL is
  // cleaned up rather than trusted.
  const desk = readDesk(sp.open, sp.active);
  const openIds = desk.open;

  const [collections, all, records, library] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { name: 'asc' },
      include: { items: { where: { itemType: 'sequence' } } },
    }),
    // The tree needs names and sizes, not sequences. Reading 4 MB of DNA to
    // draw a list of filenames is the kind of thing that makes a page slow for
    // no visible reason.
    prisma.geneSequence.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, size: true },
    }),
    openIds.length
      ? prisma.geneSequence.findMany({
          where: { id: { in: openIds } },
          include: { primers: { orderBy: { createdAt: 'asc' } } },
        })
      : Promise.resolve([]),
    fullLibrary(),
  ]);

  const byId = new Map(all.map(s => [s.id, s]));
  const filed = new Set<string>();

  const groups: TreeGroup[] = collections.map(c => {
    const items = c.items
      .map(i => byId.get(i.itemId))
      .filter((s): s is NonNullable<typeof s> => !!s);
    items.forEach(s => filed.add(s.id));
    return { id: c.id, name: c.name, sequences: items };
  });

  // Everything not in a collection still has to be reachable, or the tree is a
  // filter pretending to be a file system.
  const unfiled = all.filter(s => !filed.has(s.id));
  if (unfiled.length) groups.push({ id: '__unfiled', name: 'Unfiled', sequences: unfiled });

  /* Keep the tab order the URL asked for, not the order the database returned. */
  const open: OpenSequence[] = openIds
    .map(id => records.find(r => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map(seq => ({
      id: seq.id,
      name: seq.name,
      sequence: seq.sequence,
      size: seq.size,
      seqType: seq.type,
      host: seq.host,
      strain: seq.strain,
      features: normaliseFeatures(seq.features),
      primers: seq.primers.map(p => ({
        id: p.id,
        name: p.name,
        sequence: p.sequence,
        direction: p.direction,
        tm: p.tm ?? 0,
        gcContent: p.gcContent ?? 0,
        notes: p.notes ?? undefined,
      })),
    }));

  return (
    <WorkspaceClient
      groups={groups}
      open={open}
      activeId={desk.active}
      library={library}
    />
  );
}
