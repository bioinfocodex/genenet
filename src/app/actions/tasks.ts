'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export async function getTasks() {
  return prisma.task.findMany({ include: { assignedTo: true } });
}

export async function createTask(fd: FormData) {
  const session = await getSession();
  const title = (fd.get('title') as string).trim();
  if (!title) return;

  const dueDateRaw = fd.get('dueDate') as string | null;
  const assignedToId = (fd.get('assignedToId') as string) || null;
  const projectId = (fd.get('projectId') as string) || null;
  const procedureId = (fd.get('procedureId') as string) || null;
  const geneSequenceId = (fd.get('geneSequenceId') as string) || null;

  await prisma.task.create({
    data: {
      title,
      description: (fd.get('description') as string) || null,
      priority: (fd.get('priority') as string) || 'MEDIUM',
      status: (fd.get('status') as string) || 'TODO',
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      assignedToId: assignedToId || undefined,
      createdById: session?.userId || undefined,
      projectId: projectId || undefined,
      procedureId: procedureId || undefined,
      geneSequenceId: geneSequenceId || undefined,
    },
  });

  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function updateTask(fd: FormData) {
  const id = fd.get('id') as string;
  const dueDateRaw = fd.get('dueDate') as string | null;
  const assignedToId = (fd.get('assignedToId') as string) || null;
  const projectId = (fd.get('projectId') as string) || null;
  const geneSequenceId = (fd.get('geneSequenceId') as string) || null;

  await prisma.task.update({
    where: { id },
    data: {
      title: fd.get('title') as string,
      description: (fd.get('description') as string) || null,
      priority: fd.get('priority') as string,
      status: fd.get('status') as string,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      assignedToId: assignedToId || null,
      projectId: projectId || null,
      geneSequenceId: geneSequenceId || null,
    },
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
}

export async function updateTaskStatus(taskId: string, newStatus: string) {
  await prisma.task.update({ where: { id: taskId }, data: { status: newStatus } });
  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function deleteTask(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.task.delete({ where: { id } });
  revalidatePath('/tasks');
  redirect('/tasks');
}

export async function assignTask(taskId: string, userId: string) {
  await prisma.task.update({ where: { id: taskId }, data: { assignedToId: userId } });
  revalidatePath('/tasks');
}

export async function addTaskComment(fd: FormData) {
  const session = await getSession();
  const taskId = fd.get('taskId') as string;
  const content = (fd.get('content') as string).trim();
  if (!content || !session?.userId) return;

  await prisma.taskComment.create({
    data: { taskId, content, authorId: session.userId },
  });

  revalidatePath(`/tasks/${taskId}`);
}

export async function deleteTaskComment(fd: FormData) {
  const id = fd.get('id') as string;
  const comment = await prisma.taskComment.findUnique({ where: { id } });
  if (!comment) return;
  await prisma.taskComment.delete({ where: { id } });
  revalidatePath(`/tasks/${comment.taskId}`);
}

/** Save experiment results, discussion, troubleshooting, next step. */
export async function saveTaskExecution(fd: FormData) {
  const id = fd.get('id') as string;
  const successRaw = fd.get('success') as string | null;

  await prisma.task.update({
    where: { id },
    data: {
      result: (fd.get('result') as string) || null,
      success: successRaw === 'true' ? true : successRaw === 'false' ? false : null,
      discussion: (fd.get('discussion') as string) || null,
      troubleshooting: (fd.get('troubleshooting') as string) || null,
      nextStep: (fd.get('nextStep') as string) || null,
    },
  });

  revalidatePath(`/tasks/${id}`);
}

/** Clone a task as a new attempt, linking it to the original. */
export async function repeatTask(fd: FormData) {
  const parentId = fd.get('parentId') as string;
  const parent = await prisma.task.findUnique({
    where: { id: parentId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });
  if (!parent) return;

  // Find the highest attemptNumber in this chain
  const siblings = await prisma.task.findMany({
    where: { parentTaskId: parentId },
    select: { attemptNumber: true },
    orderBy: { attemptNumber: 'desc' },
  });
  const nextAttempt = (siblings[0]?.attemptNumber ?? parent.attemptNumber) + 1;

  const newTask = await prisma.task.create({
    data: {
      title: parent.title,
      description: (fd.get('changes') as string) || parent.description,
      status: 'TODO',
      priority: parent.priority,
      dueDate: parent.dueDate,
      assignedToId: parent.assignedToId,
      projectId: parent.projectId,
      procedureId: parent.procedureId,
      geneSequenceId: parent.geneSequenceId,
      parentTaskId: parentId,
      attemptNumber: nextAttempt,
      steps: {
        create: parent.steps.map(s => ({
          stepNumber: s.stepNumber,
          title: s.title,
          description: s.description,
        })),
      },
    },
  });

  revalidatePath('/tasks');
  redirect(`/tasks/${newTask.id}`);
}
