import { prisma } from '@/lib/prisma';
import TaskBoard from '@/components/TaskBoard';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const [tasks, users, projects, sequences, procedures] = await Promise.all([
    prisma.task.findMany({
      include: { assignedTo: true, project: true, geneSequence: { select: { name: true } }, steps: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.project.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.geneSequence.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.procedure.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, procedureId: true } }),
  ]);

  return (
    <TaskBoard
      tasks={tasks as any}
      users={users}
      projects={projects}
      sequences={sequences}
      procedures={procedures}
    />
  );
}
