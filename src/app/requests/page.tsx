import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import RequestsClient from './client';
import { queueOrder, queueSummary, type QueueItem } from '@/lib/requests';

export const dynamic = 'force-dynamic';

/**
 * The queue.
 *
 * Ordered here rather than in the database, because "late first, then by when
 * it is wanted" is a judgement about how a lab works and belongs somewhere it
 * can be read and tested, not in an ORDER BY.
 */
export default async function RequestsPage() {
  const user = await requireUser();

  const [rows, people, projects] = await Promise.all([
    prisma.labRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        requester: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        subjects: true,
        project: { select: { name: true } },
      },
    }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const items = rows.map(r => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    state: r.state as QueueItem['state'],
    outcome: r.outcome,
    createdAt: r.createdAt.toISOString(),
    neededBy: r.neededBy ? r.neededBy.toISOString().slice(0, 10) : null,
    requesterId: r.requester.id,
    requesterName: r.requester.name,
    assigneeId: r.assignee?.id ?? null,
    assigneeName: r.assignee?.name ?? null,
    projectName: r.project?.name ?? null,
    subjects: r.subjects.map(s => ({ kind: s.kind, targetId: s.targetId, label: s.label })),
  }));

  return (
    <RequestsClient
      items={queueOrder(items)}
      summary={queueSummary(items)}
      me={user.id}
      people={people}
      projects={projects}
    />
  );
}
