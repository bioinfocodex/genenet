'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth-guard';
import {
  formatOf, allWells, expandRange, stamp, quadrant, cherryPick,
  serialDilution, hasMaterial, type TransferStep,
} from '@/lib/plates';
import type { ActionResult } from './entities';

/**
 * Making plates and moving material between them.
 *
 * A transfer writes two things: the contents of the destination wells, and a
 * record of where each came from. Writing only the first would leave a plate
 * whose provenance has to be reconstructed from memory, which is the state
 * these records exist to end.
 */

export async function createPlate(data: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const name = String(data.get('name') ?? '').trim();
    const format = Number(data.get('format') ?? 96);
    const barcode = String(data.get('barcode') ?? '').trim() || null;
    const projectId = String(data.get('projectId') ?? '') || null;
    const description = String(data.get('description') ?? '').trim() || null;

    if (!name) return { error: 'Give the plate a name.' };

    let f;
    try {
      f = formatOf(format);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Unknown plate format.' };
    }

    if (barcode) {
      const clash = await prisma.plate.findUnique({ where: { barcode }, select: { name: true } });
      if (clash) return { error: `That barcode is already on "${clash.name}".` };
    }

    // Every well is created, empty ones included: an empty well is a fact about
    // the plate, and a layout with gaps in it is a layout, not missing data.
    const created = await prisma.plate.create({
      data: {
        name, format, barcode, projectId, description, createdById: user.id,
        wells: { create: allWells(f).map(w => ({ row: w.row, col: w.col, label: w.label })) },
      },
      select: { id: true },
    });

    revalidatePath('/plates');
    return { ok: true, id: created.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create the plate.' };
  }
}

export async function fillWells(data: FormData): Promise<ActionResult<{ filled: number }>> {
  try {
    await requireUser();
    const plateId = String(data.get('plateId') ?? '');
    const range = String(data.get('range') ?? '').trim();

    const plate = await prisma.plate.findUnique({
      where: { id: plateId },
      select: { format: true },
    });
    if (!plate) return { error: 'That plate no longer exists.' };

    let wells;
    try {
      wells = expandRange(range, formatOf(plate.format));
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That is not a well range.' };
    }
    if (wells.length === 0) return { error: 'No wells selected.' };

    const patch = {
      sampleId: String(data.get('sampleId') ?? '') || null,
      entityId: String(data.get('entityId') ?? '') || null,
      sequenceId: String(data.get('sequenceId') ?? '') || null,
      content: String(data.get('content') ?? '').trim() || null,
      role: String(data.get('role') ?? '').trim() || null,
      volumeUl: data.get('volumeUl') ? Number(data.get('volumeUl')) : null,
      concentration: data.get('concentration') ? Number(data.get('concentration')) : null,
      concentrationUnit: String(data.get('concentrationUnit') ?? '').trim() || null,
      notes: String(data.get('notes') ?? '').trim() || null,
    };

    await prisma.$transaction(
      wells.map(w =>
        prisma.plateWell.update({
          where: { plateId_row_col: { plateId, row: w.row, col: w.col } },
          data: patch,
        }),
      ),
    );

    revalidatePath(`/plates/${plateId}`);
    return { ok: true, filled: wells.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not fill those wells.' };
  }
}

export async function clearWells(data: FormData): Promise<ActionResult<{ cleared: number }>> {
  try {
    await requireUser();
    const plateId = String(data.get('plateId') ?? '');
    const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { format: true } });
    if (!plate) return { error: 'That plate no longer exists.' };

    let wells;
    try {
      wells = expandRange(String(data.get('range') ?? ''), formatOf(plate.format));
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That is not a well range.' };
    }

    await prisma.$transaction(
      wells.map(w =>
        prisma.plateWell.update({
          where: { plateId_row_col: { plateId, row: w.row, col: w.col } },
          data: {
            sampleId: null, entityId: null, sequenceId: null, content: null, role: null,
            volumeUl: null, concentration: null, concentrationUnit: null, notes: null,
          },
        }),
      ),
    );

    revalidatePath(`/plates/${plateId}`);
    return { ok: true, cleared: wells.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not clear those wells.' };
  }
}

/** Work out the well-to-well steps a transfer of this kind implies. */
function planTransfer(
  kind: string, sourceFormat: number, destFormat: number,
  sourceRange: string, quad: number, order: 'row' | 'column',
): TransferStep[] | { error: string } {
  const sf = formatOf(sourceFormat);
  const df = formatOf(destFormat);

  try {
    switch (kind) {
      case 'stamp': {
        if (sourceFormat !== destFormat) {
          return { error: `A stamp needs matching formats — this is ${sf.name} to ${df.name}. Use a quadrant transfer instead.` };
        }
        const wells = sourceRange ? expandRange(sourceRange, sf) : undefined;
        return stamp(sf, wells);
      }
      case 'quadrant': {
        if (sourceFormat !== 96 || destFormat !== 384) {
          return { error: 'A quadrant transfer goes from a 96-well plate into a 384.' };
        }
        return quadrant(quad);
      }
      case 'cherry-pick': {
        if (!sourceRange) return { error: 'Name the wells to pick.' };
        return cherryPick(expandRange(sourceRange, sf), df, order);
      }
      default:
        return { error: `"${kind}" is not a transfer kind.` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not plan that transfer.' };
  }
}

export async function transferPlate(data: FormData): Promise<ActionResult<{ moved: number }>> {
  try {
    const user = await requireUser();
    const sourceId = String(data.get('sourceId') ?? '');
    const destId = String(data.get('destId') ?? '');
    const kind = String(data.get('kind') ?? 'stamp');

    if (sourceId === destId) return { error: 'Source and destination are the same plate.' };

    const [source, dest] = await Promise.all([
      prisma.plate.findUnique({ where: { id: sourceId }, include: { wells: true } }),
      prisma.plate.findUnique({ where: { id: destId }, include: { wells: true } }),
    ]);
    if (!source || !dest) return { error: 'One of those plates no longer exists.' };

    const steps = planTransfer(
      kind, source.format, dest.format,
      String(data.get('sourceRange') ?? '').trim(),
      Number(data.get('quadrant') ?? 0),
      (String(data.get('order') ?? 'column') as 'row' | 'column'),
    );
    if ('error' in steps) return steps;

    const sourceByLabel = new Map(source.wells.map(w => [w.label, w]));
    const destByLabel = new Map(dest.wells.map(w => [w.label, w]));

    // Only wells holding material move. Transferring the empties too would
    // overwrite whatever the destination held with nothing, which is a
    // destructive no-op nobody asks for. A role is a label, not material: you
    // cannot pipette it, so a role-only well does not move either.
    const live = steps.filter(s => {
      const from = sourceByLabel.get(s.from.label);
      return from ? hasMaterial(from) : false;
    });
    if (live.length === 0) {
      const labelled = steps.some(s => sourceByLabel.get(s.from.label)?.role);
      return {
        error: labelled
          ? 'Nothing to move. Those wells carry a role but no sample, record, sequence or contents — a label is not material.'
          : 'Nothing to move — every source well is empty.',
      };
    }

    const volumeUl = data.get('volumeUl') ? Number(data.get('volumeUl')) : null;

    await prisma.$transaction(async tx => {
      const transfer = await tx.plateTransfer.create({
        data: {
          sourceId, destId, kind, volumeUl,
          note: String(data.get('note') ?? '').trim() || null,
          performedById: user.id,
        },
        select: { id: true },
      });

      for (const step of live) {
        const from = sourceByLabel.get(step.from.label)!;
        const to = destByLabel.get(step.to.label);
        if (!to) continue;

        await tx.plateWell.update({
          where: { id: to.id },
          data: {
            sampleId: from.sampleId, entityId: from.entityId, sequenceId: from.sequenceId,
            content: from.content, role: from.role,
            volumeUl, concentration: from.concentration, concentrationUnit: from.concentrationUnit,
          },
        });
        await tx.plateTransferWell.create({
          data: { transferId: transfer.id, fromId: from.id, toId: to.id, volumeUl },
        });
      }
    });

    revalidatePath(`/plates/${destId}`);
    revalidatePath(`/plates/${sourceId}`);
    return { ok: true, moved: live.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not run that transfer.' };
  }
}

export async function layoutDilution(data: FormData): Promise<ActionResult<{ wells: number }>> {
  try {
    await requireUser();
    const plateId = String(data.get('plateId') ?? '');
    const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { format: true } });
    if (!plate) return { error: 'That plate no longer exists.' };

    const start = String(data.get('start') ?? 'A1');
    const steps = Number(data.get('steps') ?? 8);
    const fold = Number(data.get('fold') ?? 10);
    const direction = String(data.get('direction') ?? 'row') as 'row' | 'column';
    const transferUl = Number(data.get('transferUl') ?? 20);
    const role = String(data.get('role') ?? '').trim() || null;

    let plan;
    try {
      const f = formatOf(plate.format);
      const { row, col } = expandRange(start, f)[0];
      plan = serialDilution({ row, col }, steps, fold, direction, f, transferUl);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not lay out that dilution.' };
    }

    await prisma.$transaction(
      plan.map(p =>
        prisma.plateWell.update({
          where: { plateId_row_col: { plateId, row: p.well.row, col: p.well.col } },
          data: {
            role,
            // The cumulative factor is what goes on the axis, so it is what
            // gets written into the well rather than the per-step fold.
            content: `1:${p.factor.toLocaleString()}`,
            volumeUl: p.transferUl + p.diluentUl || transferUl,
            notes: p.transferUl === 0
              ? 'Neat'
              : `${p.transferUl} µl into ${p.diluentUl} µl diluent`,
          },
        }),
      ),
    );

    revalidatePath(`/plates/${plateId}`);
    return { ok: true, wells: plan.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not lay out that dilution.' };
  }
}

export async function archivePlate(data: FormData): Promise<ActionResult> {
  try {
    await requireUser();
    const id = String(data.get('id') ?? '');
    await prisma.plate.update({ where: { id }, data: { archived: data.get('archived') === 'yes' } });
    revalidatePath('/plates');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not archive the plate.' };
  }
}
