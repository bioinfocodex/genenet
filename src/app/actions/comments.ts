'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { findMentions, isCommentable, commentHref } from '@/lib/mentions';

/**
 * Comments on any record, and the people they name.
 *
 * Mentions are resolved when the comment is written rather than when it is
 * read. A comment saying @Jane means the Jane who was in the lab at the time,
 * and resolving it later would silently re-point it at whoever is called Jane
 * then -- or at nobody, once she has left.
 */

export async function addComment(fd: FormData) {
  const user = await requireUser();
  const kind = String(fd.get('kind') ?? '');
  const targetId = String(fd.get('targetId') ?? '');
  const label = String(fd.get('label') ?? '').trim();
  const body = String(fd.get('body') ?? '').trim();

  if (!isCommentable(kind)) return { error: 'Nothing here takes comments.' };
  if (!targetId) return { error: 'No record to comment on.' };
  if (!body) return { error: 'An empty comment is not a comment.' };
  if (body.length > 10_000) return { error: 'That is longer than a comment should be. Write an entry instead.' };

  const people = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  const mentions = findMentions(body, people);

  await prisma.comment.create({
    data: {
      kind, targetId, label: label || targetId, body, authorId: user.id,
      mentions: {
        // Not the author: writing your own name is not telling yourself.
        create: mentions
          .filter(m => m.person.id !== user.id)
          .map(m => ({ personId: m.person.id })),
      },
    },
  });

  const href = commentHref(kind, targetId);
  if (href) revalidatePath(href);
  return { ok: true as const, mentioned: mentions.filter(m => m.person.id !== user.id).length };
}

/**
 * Remove one's own comment.
 *
 * Only the author, and only ever their own: a comment is somebody's words, and
 * an argument about a construct that one party can quietly delete is not a
 * record of anything. An admin who needs one gone can do it at the database.
 */
export async function deleteComment(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '');
  const comment = await prisma.comment.findUnique({ where: { id }, select: { authorId: true, kind: true, targetId: true } });
  if (!comment) return { error: 'That comment is already gone.' };
  if (comment.authorId !== user.id) return { error: 'Only the person who wrote a comment can remove it.' };

  await prisma.comment.delete({ where: { id } });
  const href = commentHref(comment.kind, comment.targetId);
  if (href) revalidatePath(href);
  return { ok: true as const };
}

/** What this person has been named in and not yet seen. */
export async function unreadMentions() {
  const user = await requireUser();
  return prisma.commentMention.findMany({
    where: { personId: user.id, readAt: null },
    orderBy: { comment: { createdAt: 'desc' } },
    take: 50,
    select: {
      id: true,
      comment: {
        select: {
          id: true, kind: true, targetId: true, label: true, body: true, createdAt: true,
          author: { select: { name: true } },
        },
      },
    },
  });
}

/** Mark one as seen, or all of them. */
export async function markMentionRead(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '');
  await prisma.commentMention.updateMany({
    // Scoped to this person as well as to the id: an id from a form is not
    // permission to mark somebody else's notification read.
    where: id ? { id, personId: user.id } : { personId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath('/');
  return { ok: true as const };
}
