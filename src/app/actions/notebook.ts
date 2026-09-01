'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { contentHash, canEdit, canWitness, extractLinks, type EntryStatus } from '@/lib/notebook';
import type { ActionResult } from './entities';

/**
 * Notebook entries.
 *
 * The one rule everything else follows from: a signed entry is not editable.
 * Every write path here checks that before touching anything, rather than
 * relying on the interface to hide the button — a signature that only holds
 * when the front end cooperates is not a signature.
 */

export async function saveEntry(data: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const id = String(data.get('id') ?? '') || null;
    const title = String(data.get('title') ?? '').trim();
    const body = String(data.get('body') ?? '');
    const projectId = String(data.get('projectId') ?? '') || null;
    const rawDate = String(data.get('entryDate') ?? '');

    if (!title) return { error: 'Give the entry a title.' };

    const entryDate = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(entryDate.getTime())) return { error: 'That is not a date.' };

    // Links are read out of the prose rather than maintained separately, so
    // they cannot go stale relative to what the entry actually says.
    const links = extractLinks(body);

    if (id) {
      const existing = await prisma.notebookEntry.findUnique({
        where: { id },
        select: { status: true, authorId: true },
      });
      if (!existing) return { error: 'That entry no longer exists.' };

      const check = canEdit(
        { status: existing.status as EntryStatus, authorId: existing.authorId },
        user.id, user.role,
      );
      if (!check.allowed) return { error: check.reason };

      await prisma.$transaction([
        prisma.notebookEntry.update({
          where: { id },
          data: { title, body, entryDate, projectId },
        }),
        prisma.notebookLink.deleteMany({ where: { entryId: id } }),
        ...(links.length
          ? [prisma.notebookLink.createMany({
              data: links.map(l => ({ entryId: id, kind: l.kind, targetId: l.targetId, label: l.label })),
            })]
          : []),
      ]);

      revalidatePath(`/notebook/${id}`);
      revalidatePath('/notebook');
      return { ok: true, id };
    }

    const created = await prisma.notebookEntry.create({
      data: {
        title, body, entryDate, projectId, authorId: user.id,
        supersedesId: String(data.get('supersedesId') ?? '') || null,
        links: { create: links.map(l => ({ kind: l.kind, targetId: l.targetId, label: l.label })) },
      },
      select: { id: true },
    });

    revalidatePath('/notebook');
    return { ok: true, id: created.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save the entry.' };
  }
}

export async function signEntry(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const id = String(data.get('id') ?? '');

    const entry = await prisma.notebookEntry.findUnique({ where: { id } });
    if (!entry) return { error: 'That entry no longer exists.' };
    if (entry.status !== 'DRAFT') return { error: 'This entry is already signed.' };
    if (entry.authorId !== user.id) return { error: 'Only the author can sign their own entry.' };
    if (!entry.body.trim()) return { error: 'An empty entry is not worth signing.' };

    const hash = contentHash({ title: entry.title, body: entry.body, entryDate: entry.entryDate });

    await prisma.$transaction([
      prisma.notebookEntry.update({
        where: { id },
        data: { status: 'SIGNED', signedAt: new Date(), signedById: user.id, contentHash: hash },
      }),
      // Recorded in the same table as procedure and report signatures, so one
      // query answers "what has this person signed".
      prisma.signature.create({
        data: {
          model: 'NotebookEntry', recordId: id, meaning: 'authored',
          signerId: user.id, signerName: user.name, signerEmail: user.email,
          contentHash: hash,
          note: String(data.get('note') ?? '').trim() || null,
        },
      }),
    ]);

    revalidatePath(`/notebook/${id}`);
    revalidatePath('/notebook');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not sign the entry.' };
  }
}

export async function witnessEntry(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const id = String(data.get('id') ?? '');

    const entry = await prisma.notebookEntry.findUnique({ where: { id } });
    if (!entry) return { error: 'That entry no longer exists.' };

    const check = canWitness(
      { status: entry.status as EntryStatus, authorId: entry.authorId, signedById: entry.signedById },
      user.id,
    );
    if (!check.allowed) return { error: check.reason };

    // Witnessing what the signature covered, not what the record says now: if
    // those differ, the entry has been altered and witnessing it would put a
    // second name on a document nobody can vouch for.
    const now = contentHash({ title: entry.title, body: entry.body, entryDate: entry.entryDate });
    if (entry.contentHash && now !== entry.contentHash) {
      return {
        error: 'This entry no longer matches the digest recorded when it was signed. It cannot be witnessed until that is explained.',
      };
    }

    await prisma.$transaction([
      prisma.notebookEntry.update({
        where: { id },
        data: { status: 'WITNESSED', witnessedAt: new Date(), witnessedById: user.id },
      }),
      prisma.signature.create({
        data: {
          model: 'NotebookEntry', recordId: id, meaning: 'witnessed',
          signerId: user.id, signerName: user.name, signerEmail: user.email,
          contentHash: now,
          note: String(data.get('note') ?? '').trim() || null,
        },
      }),
    ]);

    revalidatePath(`/notebook/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not witness the entry.' };
  }
}

/**
 * Start a correction to a signed entry.
 *
 * A new draft carrying the old text, pointed at the entry it corrects. Both
 * stay readable afterwards, which is the whole difference between correcting a
 * record and rewriting one.
 */
export async function superseedEntry(data: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const id = String(data.get('id') ?? '');

    const original = await prisma.notebookEntry.findUnique({ where: { id } });
    if (!original) return { error: 'That entry no longer exists.' };
    if (original.status === 'DRAFT') {
      return { error: 'That entry is still a draft — edit it rather than superseding it.' };
    }

    const links = extractLinks(original.body);
    const created = await prisma.notebookEntry.create({
      data: {
        title: `${original.title} (corrected)`,
        body: original.body,
        entryDate: original.entryDate,
        projectId: original.projectId,
        authorId: user.id,
        supersedesId: id,
        links: { create: links.map(l => ({ kind: l.kind, targetId: l.targetId, label: l.label })) },
      },
      select: { id: true },
    });

    revalidatePath('/notebook');
    return { ok: true, id: created.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not start a correction.' };
  }
}

export async function deleteDraft(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const id = String(data.get('id') ?? '');
    const entry = await prisma.notebookEntry.findUnique({
      where: { id }, select: { status: true, authorId: true },
    });
    if (!entry) return { error: 'That entry no longer exists.' };
    // Only drafts. A signed entry is part of the record whether or not its
    // author still wants it there.
    if (entry.status !== 'DRAFT') {
      return { error: 'A signed entry cannot be deleted. Supersede it with a correction instead.' };
    }
    if (entry.authorId !== user.id && user.role !== 'ADMIN') {
      return { error: 'Only the author can delete their draft.' };
    }

    await prisma.notebookEntry.delete({ where: { id } });
    revalidatePath('/notebook');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not delete the draft.' };
  }
}
