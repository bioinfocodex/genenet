import 'server-only';
import { prisma } from './prisma';
import type { CommentRow } from '@/components/CommentThread';

/**
 * The thread for a record, in the shape the component wants.
 *
 * One function so that every page showing comments shows the same thing in the
 * same order, rather than each assembling its own slightly different query.
 */
export async function threadFor(kind: string, targetId: string): Promise<{
  comments: CommentRow[];
  people: { id: string; name: string; email: string }[];
}> {
  const [rows, people] = await Promise.all([
    prisma.comment.findMany({
      where: { kind, targetId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, body: true, authorId: true, createdAt: true,
        author: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    comments: rows.map(r => ({
      id: r.id,
      body: r.body,
      authorId: r.authorId,
      authorName: r.author.name,
      createdAt: r.createdAt.toISOString(),
    })),
    people,
  };
}
