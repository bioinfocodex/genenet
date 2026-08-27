import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import TaskExecutionPanel from '@/components/TaskExecutionPanel';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [task, allTasks, freezers] = await Promise.all([
    prisma.task.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        procedure: true,
        project: true,
        geneSequence: { select: { id: true, name: true } },
        steps: { orderBy: { stepNumber: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
        // task is selected because the panel shows which task an image belongs to;
        // without it every image on this page reads as "Unassigned".
        gelImages: { orderBy: { capturedAt: 'desc' }, include: { task: { select: { id: true, title: true } } } },
        samples: { select: { id: true, sampleId: true, name: true } },
        parentTask: { select: { id: true, title: true, attemptNumber: true, success: true } },
        childTasks: { select: { id: true, title: true, attemptNumber: true, status: true }, orderBy: { attemptNumber: 'asc' } },
      },
    }),
    prisma.task.findMany({ select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    prisma.freezer.findMany({ orderBy: { temperature: 'asc' }, select: { id: true, name: true, temperature: true } }),
  ]);

  if (!task) notFound();

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {task.project ? (
          <>
            <Link href="/projects" style={{ color: 'var(--accent-blue)' }}>Projects</Link>
            <ChevronRight size={14} />
            <Link href={`/projects/${task.project.id}`} style={{ color: 'var(--accent-blue)' }}>{task.project.name}</Link>
          </>
        ) : (
          <Link href="/tasks" style={{ color: 'var(--accent-blue)' }}>Tasks</Link>
        )}
        <ChevronRight size={14} />
        <span>{task.title}</span>
        {task.attemptNumber > 1 && <span style={{ color: 'var(--accent-orange)' }}>(Attempt #{task.attemptNumber})</span>}
      </div>

      <TaskExecutionPanel task={task} allTasks={allTasks} freezers={freezers} />
    </div>
  );
}
