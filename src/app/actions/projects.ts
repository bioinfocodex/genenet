'use server'
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMockUser } from './auth';
import { initReport } from './reports';

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function createProject(_prev: any, formData: FormData) {
  const user = await getMockUser();
  if (!user) return { error: 'Not authenticated' };

  const name = (formData.get('name') as string).trim();
  const description = (formData.get('description') as string | null)?.trim() || null;
  if (!name) return { error: 'Name is required' };

  const project = await prisma.project.create({
    data: { name, description, createdById: user.id },
  });

  // Auto-initialize a report for every new project
  await initReport(project.id);

  revalidatePath('/projects');
  redirect(`/projects/${project.id}`);
}

export async function updateProjectStatus(formData: FormData) {
  const id = formData.get('id') as string;
  const status = formData.get('status') as string;
  await prisma.project.update({ where: { id }, data: { status } });
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function createTask(_prev: any, formData: FormData) {
  const user = await getMockUser();
  if (!user) return { error: 'Not authenticated' };

  const title = (formData.get('title') as string).trim();
  const description = (formData.get('description') as string | null)?.trim() || null;
  const assignedToId = (formData.get('assignedToId') as string | null) || null;
  const procedureId  = (formData.get('procedureId') as string | null) || null;
  const projectId    = (formData.get('projectId') as string | null) || null;
  const priority     = (formData.get('priority') as string) || 'MEDIUM';
  const dueDateRaw   = formData.get('dueDate') as string | null;
  const dueDate      = dueDateRaw ? new Date(dueDateRaw) : null;

  if (!title) return { error: 'Title is required' };

  const task = await prisma.task.create({
    data: {
      title,
      description,
      assignedToId: assignedToId || null,
      procedureId: procedureId || null,
      projectId: projectId || null,
      priority,
      dueDate,
    },
  });

  // Clone procedure steps into task_steps
  if (procedureId) {
    const steps = await prisma.procedureStep.findMany({
      where: { procedureId },
      orderBy: { stepNumber: 'asc' },
    });
    if (steps.length > 0) {
      await prisma.taskStep.createMany({
        data: steps.map(s => ({
          taskId: task.id,
          stepNumber: s.stepNumber,
          title: s.title,
          description: s.description,
          sourceStepId: s.id,
          status: 'PENDING',
        })),
      });
    }
  }

  await prisma.activity.create({
    data: { action: 'created task', target: title, userId: user.id },
  });

  revalidatePath('/tasks');
  if (projectId) revalidatePath(`/projects/${projectId}`);
  redirect(projectId ? `/projects/${projectId}` : `/tasks/${task.id}`);
}

// ─── Task Step Execution ──────────────────────────────────────────────────────

export async function completeTaskStep(formData: FormData) {
  const user = await getMockUser();
  if (!user) throw new Error('Not authenticated');

  const id     = formData.get('id') as string;
  const notes  = (formData.get('notes') as string | null)?.trim() || null;
  const status = formData.get('status') as string; // PENDING | COMPLETED

  await prisma.taskStep.update({
    where: { id },
    data: {
      status,
      notes,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      completedById: status === 'COMPLETED' ? user.id : null,
    },
  });

  const step = await prisma.taskStep.findUnique({ where: { id } });
  if (step) revalidatePath(`/tasks/${step.taskId}`);
}

// ─── Task status (extend existing) ───────────────────────────────────────────

export async function updateTaskStatusAction(formData: FormData) {
  const id     = formData.get('id') as string;
  const status = formData.get('status') as string;
  await prisma.task.update({ where: { id }, data: { status } });
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
}
