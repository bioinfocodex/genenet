'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import { nextCode } from '@/lib/fields';
import { withCodeRetry } from '@/lib/registry';
import {
  OLIGO_PREFIX, cleanOligo, validateOligo, findDuplicate, parseOligoList, planPrimerImport,
  type PrimerImportPlan,
} from '@/lib/oligos';

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

  /*
   * The code is read off what exists and then written, which two people
   * ordering primers at the same moment both do with the same answer. The
   * column is unique, so the loser used to get the database's own error where
   * its code should have been. Re-reading inside the retry gives it the next
   * code instead.
   */
  const created = await withCodeRetry(async () => {
    const codes = (await prisma.oligo.findMany({ select: { code: true } })).map(o => o.code);
    return prisma.oligo.create({
      data: {
        code: nextCode(OLIGO_PREFIX, codes),
        name, sequence,
        modifications: text(data, 'modifications'),
        location: text(data, 'location'),
        notes: text(data, 'notes'),
        createdById: user.id,
      },
      select: { id: true, code: true },
    });
  }, { field: 'code' });
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
    // One failed row in an import of two hundred should cost that row, not
    // the import.
    const made = await withCodeRetry(async (attempt) => {
      if (attempt > 0) {
        codes.length = 0;
        codes.push(...(await prisma.oligo.findMany({ select: { code: true } })).map(o => o.code));
      }
      const code = nextCode(OLIGO_PREFIX, codes);
      await prisma.oligo.create({
        data: { code, name: row.name, sequence: row.sequence, notes: row.notes ?? null, createdById: user.id },
      });
      return code;
    }, { field: 'code' });
    codes.push(made);
    known.push({ code: made, name: row.name, sequence: row.sequence });
    outcome.added.push({ code: made, name: row.name });
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

  const code = await withCodeRetry(async () => {
    const codes = (await prisma.oligo.findMany({ select: { code: true } })).map(o => o.code);
    const next = nextCode(OLIGO_PREFIX, codes);
    await prisma.oligo.create({
      data: { code: next, name: primer.name, sequence, notes: primer.notes, createdById: user.id },
    });
    return next;
  }, { field: 'code' });
  revalidatePath('/oligos');
  revalidatePath(`/sequences/${primer.geneSequenceId}`);
  return { ok: true, code, existed: false };
}

async function primerImportPlan(): Promise<PrimerImportPlan> {
  const [primers, collection] = await Promise.all([
    prisma.primer.findMany({
      select: { name: true, sequence: true, notes: true, geneSequence: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.oligo.findMany({ select: { code: true, sequence: true } }),
  ]);
  return planPrimerImport(
    primers.map(p => ({ name: p.name, sequence: p.sequence, notes: p.notes, sequenceName: p.geneSequence.name })),
    collection,
  );
}

/** What filing every saved primer would do, without doing it. */
export async function previewPrimerImport(): Promise<PrimerImportPlan> {
  await requireUser();
  return primerImportPlan();
}

/**
 * File the per-sequence primers into the collection. The plan is worked out
 * again here rather than trusted from the preview, so a primer added between
 * preview and confirm is handled the same way and nothing is filed twice.
 */
export async function importPrimersFromSequences(): Promise<ActionResult<{ added: { code: string; name: string }[] }>> {
  const user = await requireUser();
  const plan = await primerImportPlan();
  const codes = (await prisma.oligo.findMany({ select: { code: true } })).map(o => o.code);
  const added: { code: string; name: string }[] = [];

  for (const row of plan.add) {
    const code = await withCodeRetry(async (attempt) => {
      if (attempt > 0) {
        codes.length = 0;
        codes.push(...(await prisma.oligo.findMany({ select: { code: true } })).map(o => o.code));
      }
      const next = nextCode(OLIGO_PREFIX, codes);
      await prisma.oligo.create({
        data: { code: next, name: row.name, sequence: row.sequence, notes: row.notes, createdById: user.id },
      });
      return next;
    }, { field: 'code' });
    codes.push(code);
    added.push({ code, name: row.name });
  }
  revalidatePath('/oligos');
  return { ok: true, added };
}
