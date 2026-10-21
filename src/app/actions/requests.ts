'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import {
  kindById, canMove, rolesOf, isOpen,
  type RequestState,
} from '@/lib/requests';

/**
 * Making a request, and moving it along.
 *
 * Every move is checked against the state it is actually in, read inside the
 * same call rather than taken from the form. Two people working a queue at
 * once is the normal case, not the edge one: the second to press "take it on"
 * should be told somebody already has it, not quietly made the assignee.
 */

export async function createRequest(fd: FormData) {
  const user = await requireUser();
  const kind = kindById(String(fd.get('kind') ?? ''));
  const title = String(fd.get('title') ?? '').trim();
  const body = String(fd.get('body') ?? '').trim();
  const neededBy = String(fd.get('neededBy') ?? '').trim();
  const assigneeId = String(fd.get('assigneeId') ?? '').trim() || null;
  const projectId = String(fd.get('projectId') ?? '').trim() || null;

  if (!kind) return { error: 'That is not a kind of request this offers.' };
  if (!title) return { error: 'A request needs a one-line title.' };

  let subjects: { kind: string; targetId: string; label: string }[] = [];
  try {
    const raw = JSON.parse(String(fd.get('subjects') ?? '[]'));
    if (Array.isArray(raw)) {
      subjects = raw
        .filter(s => s && typeof s.kind === 'string' && typeof s.targetId === 'string')
        .map(s => ({ kind: s.kind, targetId: s.targetId, label: String(s.label ?? s.targetId) }))
        .slice(0, 200);
    }
  } catch { /* a malformed list is no subjects, not a failed request */ }

  const created = await prisma.labRequest.create({
    data: {
      kind: kind.id, title, body,
      requesterId: user.id,
      assigneeId,
      projectId,
      neededBy: neededBy ? new Date(neededBy) : null,
      subjects: { create: subjects },
    },
    select: { id: true },
  });

  revalidatePath('/requests');
  return { ok: true as const, id: created.id };
}

export async function moveRequest(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '');
  const to = String(fd.get('to') ?? '') as RequestState;
  const outcome = String(fd.get('outcome') ?? '').trim();

  const request = await prisma.labRequest.findUnique({
    where: { id },
    select: { state: true, requesterId: true, assigneeId: true },
  });
  if (!request) return { error: 'That request is gone.' };

  const verdict = canMove(request.state as RequestState, to, rolesOf(request, user.id));
  if (!verdict.ok) return { error: verdict.why };

  /*
   * Declining without saying why is the thing that makes a queue useless to
   * the person who asked: they are left with a refusal and no idea whether to
   * ask again, ask somebody else, or do it themselves.
   */
  if (to === 'DECLINED' && !outcome) return { error: 'Say why you are declining, so the asker knows what to do next.' };

  await prisma.labRequest.update({
    where: { id },
    data: {
      state: to,
      outcome: outcome || null,
      // Taking one on claims it; putting it back releases it.
      assigneeId: to === 'ACCEPTED' ? user.id : to === 'OPEN' ? null : request.assigneeId,
      closedAt: isOpen(to) ? null : new Date(),
    },
  });

  revalidatePath('/requests');
  revalidatePath(`/requests/${id}`);
  return { ok: true as const };
}
