'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth-guard';
import { parseQuantity, canTake, type Stock } from '@/lib/quantities';

/** The sample's quantity fields, as the arithmetic in lib/quantities wants them. */
function stockOf(s: {
  amount: number | null; amountUnit: string | null;
  concValue: number | null; concPer: string | null; concVolume: string | null;
}): Stock {
  return {
    initial: { value: s.amount ?? 0, unit: s.amountUnit ?? 'item' },
    concentration: s.concValue && s.concPer && s.concVolume
      ? { value: s.concValue, per: s.concPer, volume: s.concVolume }
      : null,
  };
}

const TYPE_PREFIX: Record<string, string> = {
  PLASMID:       'PLA',
  LINEAR_DNA:    'DNA',
  GLYCEROL_STOCK:'GLY',
  OTHER:         'SAM',
};

/** Generate the next unique sampleId for a given type prefix, e.g. PLA-007 */
async function nextSampleId(prefix: string): Promise<string> {
  const existing = await prisma.sample.findMany({
    where: { sampleId: { startsWith: `${prefix}-` } },
    select: { sampleId: true },
    orderBy: { createdAt: 'desc' },
  });
  let max = 0;
  for (const s of existing) {
    const num = parseInt(s.sampleId.split('-')[1] ?? '0', 10);
    if (num > max) max = num;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export async function createSample(fd: FormData) {
  const session = await requireUser();
  const type = (fd.get('type') as string) || 'OTHER';
  const prefix = TYPE_PREFIX[type] ?? 'SAM';
  const sampleId = await nextSampleId(prefix);

  const sample = await prisma.sample.create({
    data: {
      sampleId,
      name: (fd.get('name') as string).trim(),
      type,
      status: 'ACTIVE',
      description: (fd.get('description') as string) || null,
      notes:       (fd.get('notes') as string) || null,
      freezerId:   (fd.get('freezerId') as string) || null,
      rack:        (fd.get('rack') as string) || null,
      box:         (fd.get('box') as string) || null,
      position:    (fd.get('position') as string) || null,
      taskId:      (fd.get('taskId') as string) || null,
      projectId:   (fd.get('projectId') as string) || null,
      geneSequenceId: (fd.get('geneSequenceId') as string) || null,
      createdById: session.id,
    },
  });

  revalidatePath('/samples');
  revalidatePath('/freezers');
  if (sample.taskId) revalidatePath(`/tasks/${sample.taskId}`);
  redirect(`/samples/${sample.id}`);
}

export async function updateSample(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.sample.update({
    where: { id },
    data: {
      name:        (fd.get('name') as string).trim(),
      description: (fd.get('description') as string) || null,
      notes:       (fd.get('notes') as string) || null,
      freezerId:   (fd.get('freezerId') as string) || null,
      rack:        (fd.get('rack') as string) || null,
      box:         (fd.get('box') as string) || null,
      position:    (fd.get('position') as string) || null,
      geneSequenceId: (fd.get('geneSequenceId') as string) || null,
    },
  });
  revalidatePath('/samples');
  revalidatePath(`/samples/${id}`);
  revalidatePath('/freezers');
}

export async function updateSampleStatus(fd: FormData) {
  const id = fd.get('id') as string;
  const status = fd.get('status') as string;
  await prisma.sample.update({ where: { id }, data: { status } });
  revalidatePath('/samples');
  revalidatePath(`/samples/${id}`);
}

export async function deleteSample(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.sample.delete({ where: { id } });
  revalidatePath('/samples');
  revalidatePath('/freezers');
  redirect('/samples');
}

export async function createFreezer(fd: FormData) {
  await prisma.freezer.create({
    data: {
      name:        (fd.get('name') as string).trim(),
      temperature: parseInt(fd.get('temperature') as string, 10),
      location:    (fd.get('location') as string) || null,
      notes:       (fd.get('notes') as string) || null,
    },
  });
  revalidatePath('/freezers');
}

export async function deleteFreezer(fd: FormData) {
  const id = fd.get('id') as string;
  await prisma.freezer.delete({ where: { id } });
  revalidatePath('/freezers');
}

// ─── Quantities and uses ─────────────────────────────────────────────────────

/**
 * What is in the tube, and what links a volume to a mass.
 *
 * Set separately from the sample's other details because it is a different
 * kind of fact: the name and the freezer position describe where a thing is,
 * and this describes how much of it there is -- which only means anything
 * alongside the uses recorded against it.
 */
export async function setSampleQuantity(fd: FormData) {
  await requireUser();
  const id = fd.get('id') as string;
  if (!id) return { error: 'No sample.' };

  const typed = (fd.get('amount') as string | null)?.trim() ?? '';
  const parsed = typed ? parseQuantity(typed) : null;
  if (typed && !parsed) {
    return { error: `"${typed}" is not an amount this understands. Try 50 µL, 10 µg, or 3 tubes.` };
  }

  /*
   * A concentration is all three parts or none of them. Half of one -- a
   * number with no unit, or units with no number -- would be stored as a
   * link between a volume and a mass that cannot actually convert anything,
   * and would then fail at the point of use rather than here.
   */
  const concRaw = (fd.get('concValue') as string | null)?.trim() ?? '';
  const concPer = (fd.get('concPer') as string | null) ?? '';
  const concVolume = (fd.get('concVolume') as string | null) ?? '';
  const concValue = concRaw ? Number(concRaw) : null;
  if (concRaw && (!Number.isFinite(concValue) || (concValue as number) <= 0)) {
    return { error: 'A concentration has to be a number greater than nought.' };
  }
  if (concRaw && !(concPer && concVolume)) {
    return { error: 'A concentration needs both of its units.' };
  }

  const expires = (fd.get('expiresAt') as string | null)?.trim();

  await prisma.sample.update({
    where: { id },
    data: {
      amount: parsed ? parsed.value : null,
      amountUnit: parsed ? parsed.unit : null,
      concValue: concRaw ? concValue : null,
      concPer: concRaw ? concPer : null,
      concVolume: concRaw ? concVolume : null,
      lot: ((fd.get('lot') as string | null)?.trim() || null),
      expiresAt: expires ? new Date(expires) : null,
    },
  });
  revalidatePath(`/samples/${id}`);
  return { ok: true as const };
}

/**
 * Record that somebody took some.
 *
 * Checked against what is left before it is written, so the common mistake --
 * taking a tube that somebody else emptied an hour ago -- is caught while the
 * person is still standing at the bench, rather than appearing later as a
 * negative number nobody can explain.
 */
export async function recordSampleUse(fd: FormData) {
  const user = await requireUser();
  const id = fd.get('id') as string;
  const typed = (fd.get('amount') as string | null)?.trim() ?? '';
  if (!id || !typed) return { error: 'How much was taken?' };

  const drawn = parseQuantity(typed);
  if (!drawn) return { error: `"${typed}" is not an amount this understands.` };
  if (drawn.value <= 0) return { error: 'A use has to be more than nothing.' };

  const sample = await prisma.sample.findUnique({
    where: { id },
    include: { uses: { select: { amount: true, unit: true } } },
  });
  if (!sample) return { error: 'That sample is gone.' };
  if (sample.amount === null || !sample.amountUnit) {
    return { error: 'This sample has no amount recorded, so there is nothing to take from.' };
  }

  const stock = stockOf(sample);
  const verdict = canTake(stock, sample.uses.map(u => ({ amount: { value: u.amount, unit: u.unit } })), drawn);
  if (!verdict.ok) return { error: verdict.why };

  await prisma.sampleUse.create({
    data: {
      sampleId: id,
      amount: drawn.value,
      unit: drawn.unit,
      note: ((fd.get('note') as string | null)?.trim() || null),
      usedById: user.id,
    },
  });
  revalidatePath(`/samples/${id}`);
  return { ok: true as const };
}

/** Undo a use. The tube fills back up, because the use was the only claim it was ever empty. */
export async function deleteSampleUse(fd: FormData) {
  await requireUser();
  const useId = fd.get('useId') as string;
  if (!useId) return { error: 'No use.' };
  const use = await prisma.sampleUse.findUnique({ where: { id: useId }, select: { sampleId: true } });
  if (!use) return { error: 'That use is already gone.' };
  await prisma.sampleUse.delete({ where: { id: useId } });
  revalidatePath(`/samples/${use.sampleId}`);
  return { ok: true as const };
}
