'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { nextCode } from '@/lib/fields';
import { OLIGO_PREFIX, cleanOligo, validateOligo, findDuplicate, parseOligoList } from '@/lib/oligos';

export type ActionResult<T = unknown> = ({ ok: true } & T) | { error: string };

const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

export async function createOligo(data: FormData): Promise<ActionResult<{ id: string; code: string }>> {
  const user = await requireUser();
  const name = text(data, 'name');
  const sequence = cleanOligo(text(data, 'sequence') ?? '');
  if (!name) return { error: 'Give the oligo a name.' };
  const problem = validateOligo(sequence);
  if (problem) return { error: problem };

  const existing = await prisma.oligo.findMany({ select: { code: true, name: true, sequence: true } });
  const dup = findDuplicate(sequence, existing);
  if (dup) return { error: `${dup.code} (${dup.name}) already has this sequence.` };

  const created = await prisma.oligo.create({
    data: {
      code: nextCode(OLIGO_PREFIX, existing.map(o => o.code)),
      name, sequence,
      modifications: text(data, 'modifications'),
      location: text(data, 'location'),
      notes: text(data, 'notes'),
      createdById: user.id,
    },
    select: { id: true, code: true },
  });
  revalidatePath('/oligos');
  return { ok: true, ...created };
}

export async function updateOligo(data: FormData): Promise<ActionResult> {
  await requireUser();
  const id = text(data, 'id');
  const name = text(data, 'name');
  if (!id) return { error: 'No oligo given.' };
  if (!name) return { error: 'Give the oligo a name.' };

  // The sequence is deliberately not editable: the code on the tube names
  // these bases. A different sequence is a different oligo with its own code.
  await prisma.oligo.update({
    where: { id },
    data: {
      name,
      modifications: text(data, 'modifications'),
      location: text(data, 'location'),
      notes: text(data, 'notes'),
    },
  });
  revalidatePath('/oligos');
  revalidatePath(`/oligos/${id}`);
  return { ok: true };
}

/**
 * Archived rather than deleted: the tube may be gone but notebook entries and
 * old protocols still name its code, and that code should still lead somewhere.
 */
export async function setOligoArchived(data: FormData): Promise<ActionResult> {
  await requireUser();
  const id = text(data, 'id');
  if (!id) return { error: 'No oligo given.' };
  await prisma.oligo.update({ where: { id }, data: { archived: data.get('archived') === 'true' } });
  revalidatePath('/oligos');
  revalidatePath(`/oligos/${id}`);
  return { ok: true };
}

export interface ImportOutcome {
  added: { code: string; name: string }[];
  /** Rows already in the collection, by sequence. */
  skipped: { name: string; existing: string }[];
  problems: { line: number; message: string }[];
}

/** Add a pasted list, skipping anything already in the collection. */
export async function importOligos(data: FormData): Promise<ActionResult<ImportOutcome>> {
  const user = await requireUser();
  const { rows, problems } = parseOligoList(text(data, 'list') ?? '');
  if (!rows.length && !problems.length) return { error: 'Paste one oligo per line: name, then sequence.' };

  const existing = await prisma.oligo.findMany({ select: { code: true, name: true, sequence: true } });
  const codes = existing.map(o => o.code);
  const known = [...existing];
  const outcome: ImportOutcome = { added: [], skipped: [], problems };

  for (const row of rows) {
    const dup = findDuplicate(row.sequence, known);
    if (dup) {
      outcome.skipped.push({ name: row.name, existing: `${dup.code} (${dup.name})` });
      continue;
    }
    const code = nextCode(OLIGO_PREFIX, codes);
    await prisma.oligo.create({
      data: { code, name: row.name, sequence: row.sequence, notes: row.notes ?? null, createdById: user.id },
    });
    codes.push(code);
    known.push({ code, name: row.name, sequence: row.sequence });
    outcome.added.push({ code, name: row.name });
  }

  revalidatePath('/oligos');
  return { ok: true, ...outcome };
}

/**
 * File a primer saved on one sequence into the lab collection. If the
 * collection already holds that sequence, say which oligo rather than copy it.
 */
export async function addPrimerToCollection(primerId: string): Promise<ActionResult<{ code: string; existed: boolean }>> {
  const user = await requireUser();
  const primer = await prisma.primer.findUnique({ where: { id: primerId } });
  if (!primer) return { error: 'That primer no longer exists.' };

  const sequence = cleanOligo(primer.sequence);
  const problem = validateOligo(sequence);
  if (problem) return { error: problem };

  const existing = await prisma.oligo.findMany({ select: { code: true, name: true, sequence: true } });
  const dup = findDuplicate(sequence, existing);
  if (dup) return { ok: true, code: dup.code, existed: true };

  const code = nextCode(OLIGO_PREFIX, existing.map(o => o.code));
  await prisma.oligo.create({
    data: { code, name: primer.name, sequence, notes: primer.notes, createdById: user.id },
  });
  revalidatePath('/oligos');
  revalidatePath(`/sequences/${primer.geneSequenceId}`);
  return { ok: true, code, existed: false };
}
