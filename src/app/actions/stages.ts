'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { planStages, describeMove, type Stage } from '@/lib/stages';
import { isCommentable } from '@/lib/mentions';

/**
 * Defining a project's workflow, and moving things through it.
 *
 * Stages are rewritten as a list rather than added and removed one at a time,
 * because the thing somebody is editing is the order -- and an interface that
 * made them add "verify", then drag it into place, then renumber everything
 * else would be three operations where there is one intention.
 */

export async function setStages(fd: FormData) {
  await requireUser();
  const projectId = String(fd.get('projectId') ?? '');
  if (!projectId) return { error: 'No project.' };

  const names = String(fd.get('names') ?? '').split('\n');
  const plan = planStages(names);
  if (plan.stages.length === 0) return { error: plan.problems[0] ?? 'A workflow needs at least one stage.' };

  const existing = await prisma.projectStage.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map(s => [s.name.toLowerCase(), s.id]));

  /*
   * A stage kept under the same name keeps its id, so the cards in it stay
   * where they are. Renaming a column would otherwise empty it, which is the
   * sort of thing people only discover after they have done it.
   */
  const keep = new Set<string>();
  for (const s of plan.stages) {
    const id = byName.get(s.name.toLowerCase());
    if (id) {
      keep.add(id);
      await prisma.projectStage.update({ where: { id }, data: { name: s.name, position: s.position } });
    } else {
      await prisma.projectStage.create({ data: { projectId, name: s.name, position: s.position } });
    }
  }

  /*
   * Cards in a deleted stage are not deleted with it -- the relation is set
   * null, so they come back as unplaced and the board says so. Losing a
   * record because somebody tidied up a column would be unforgivable.
   */
  const gone = existing.filter(e => !keep.has(e.id)).map(e => e.id);
  if (gone.length) await prisma.projectStage.deleteMany({ where: { id: { in: gone } } });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const, problems: plan.problems };
}

/** Put a record on the board, or move it. */
export async function moveCard(fd: FormData) {
  const user = await requireUser();
  const projectId = String(fd.get('projectId') ?? '');
  const kind = String(fd.get('kind') ?? '');
  const targetId = String(fd.get('targetId') ?? '');
  const label = String(fd.get('label') ?? '').trim();
  const toStage = String(fd.get('stageId') ?? '').trim() || null;

  if (!projectId || !targetId) return { error: 'Nothing to move.' };
  if (!isCommentable(kind)) return { error: 'That kind of record does not go on a board.' };

  const stages: Stage[] = await prisma.projectStage.findMany({
    where: { projectId },
    select: { id: true, name: true, position: true },
    orderBy: { position: 'asc' },
  });

  // A stage from a form is not a stage until it is one of this project's.
  if (toStage && !stages.some(s => s.id === toStage)) return { error: 'That stage is not on this board.' };

  const existing = await prisma.stageCard.findUnique({
    where: { projectId_kind_targetId: { projectId, kind, targetId } },
    select: { id: true, stageId: true },
  });

  if (existing?.stageId === toStage) return { error: 'It is already there.' };

  if (existing) {
    await prisma.stageCard.update({
      where: { id: existing.id },
      // `since` restarts, because the question a board answers is how long
      // this card has been where it is now, not how long it has been on the
      // board at all.
      data: { stageId: toStage, since: new Date(), movedById: user.id, label: label || undefined },
    });
  } else {
    await prisma.stageCard.create({
      data: { projectId, kind, targetId, label: label || targetId, stageId: toStage, movedById: user.id },
    });
  }

  revalidatePath(`/projects/${projectId}`);
  return {
    ok: true as const,
    what: describeMove(stages, existing?.stageId ?? null, toStage),
  };
}

/** Take a record off the board entirely. */
export async function removeCard(fd: FormData) {
  await requireUser();
  const projectId = String(fd.get('projectId') ?? '');
  const id = String(fd.get('id') ?? '');
  if (!id) return { error: 'No card.' };
  await prisma.stageCard.deleteMany({ where: { id, projectId } });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const };
}
