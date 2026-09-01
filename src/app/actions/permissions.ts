'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { checkAccess, canRemoveMember, isLevel, type Level } from '@/lib/permissions';
import type { ActionResult } from './entities';

/**
 * Who may reach a restricted project.
 *
 * Every action here re-reads the project and the caller's membership rather
 * than trusting anything the form said. A permissions system that takes the
 * client's word for the caller's level is not a permissions system.
 */

async function loadAccess(projectId: string, userId: string, role: string) {
  const [project, membership] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, restricted: true, name: true },
    }),
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { level: true },
    }),
  ]);
  return { project, membership, user: { id: userId, role } };
}

export async function setProjectRestricted(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(data.get('projectId') ?? '');
    const restricted = data.get('restricted') === 'yes';

    const ctx = await loadAccess(projectId, user.id, user.role);
    if (!ctx.project) return { error: 'That project no longer exists.' };

    const access = checkAccess(ctx, 'MANAGE');
    if (!access.allowed) return { error: access.reason };

    // Restricting a project whose only members are nobody would lock everyone
    // except admins out of it the moment the switch flips. Add the person
    // doing it, so the project is never left with no named owner.
    if (restricted) {
      const members = await prisma.projectMember.count({ where: { projectId } });
      if (members === 0 && user.role !== 'ADMIN') {
        await prisma.projectMember.create({
          data: { projectId, userId: user.id, level: 'MANAGE', addedById: user.id },
        });
      }
    }

    await prisma.project.update({ where: { id: projectId }, data: { restricted } });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/projects');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not change the project.' };
  }
}

export async function addProjectMember(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(data.get('projectId') ?? '');
    const userId = String(data.get('userId') ?? '');
    const rawLevel = String(data.get('level') ?? 'VIEW');

    if (!isLevel(rawLevel)) return { error: `"${rawLevel}" is not an access level.` };
    const level: Level = rawLevel;

    const ctx = await loadAccess(projectId, user.id, user.role);
    if (!ctx.project) return { error: 'That project no longer exists.' };
    const access = checkAccess(ctx, 'MANAGE');
    if (!access.allowed) return { error: access.reason };

    const target = await prisma.user.findUnique({
      where: { id: userId }, select: { name: true, status: true },
    });
    if (!target) return { error: 'That person is not in the workspace.' };
    if (target.status !== 'ACTIVE') {
      return { error: `${target.name} is not an active workspace member.` };
    }

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, level, addedById: user.id },
      update: { level },
    });

    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not add that person.' };
  }
}

export async function removeProjectMember(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const projectId = String(data.get('projectId') ?? '');
    const userId = String(data.get('userId') ?? '');

    const ctx = await loadAccess(projectId, user.id, user.role);
    if (!ctx.project) return { error: 'That project no longer exists.' };
    const access = checkAccess(ctx, 'MANAGE');
    if (!access.allowed) return { error: access.reason };

    const members = await prisma.projectMember.findMany({
      where: { projectId }, select: { userId: true, level: true },
    });
    const check = canRemoveMember(members, userId);
    if (!check.allowed) return { error: check.reason };

    await prisma.projectMember.deleteMany({ where: { projectId, userId } });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not remove that person.' };
  }
}
