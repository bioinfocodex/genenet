import 'server-only';
import { prisma } from './prisma';
import type { EmbedState } from './notebook-embeds';

/**
 * The state of each record an entry embeds, read from the database.
 *
 * What counts as "the state" is a judgement per kind, and the judgement is
 * the same one twice: what a reader of the entry would see on the card. A
 * construct's bases and features are on the card, so editing either means the
 * page is showing something other than what was signed. Its description is
 * not, so changing it is not a change to the entry.
 *
 * Written once and used on both sides of every comparison, because two
 * equal states must render to the same string or a signature fails for no
 * reason -- which is worse than one that never checked.
 */

const SEP = '\u001f';

export async function statesFor(
  links: { kind: string; targetId: string }[],
): Promise<EmbedState[]> {
  if (links.length === 0) return [];

  const byKind = new Map<string, string[]>();
  for (const l of links) (byKind.get(l.kind) ?? byKind.set(l.kind, []).get(l.kind)!).push(l.targetId);

  const out: EmbedState[] = [];

  const sequenceIds = byKind.get('sequence') ?? [];
  if (sequenceIds.length) {
    const rows = await prisma.geneSequence.findMany({
      where: { id: { in: sequenceIds } },
      select: { id: true, name: true, sequence: true, features: true, code: true },
    });
    for (const r of rows) {
      out.push({
        kind: 'sequence',
        targetId: r.id,
        // The bases and the annotation, which are what the card draws.
        state: [r.code ?? '', r.name, r.sequence, r.features ?? '[]'].join(SEP),
      });
    }
  }

  const sampleIds = byKind.get('sample') ?? [];
  if (sampleIds.length) {
    const rows = await prisma.sample.findMany({
      where: { id: { in: sampleIds } },
      select: {
        id: true, sampleId: true, name: true, status: true,
        amount: true, amountUnit: true, concValue: true, concPer: true, concVolume: true,
        box: true, position: true,
        uses: { select: { amount: true, unit: true }, orderBy: { usedAt: 'asc' } },
      },
    });
    for (const r of rows) {
      /*
       * The uses are part of the state, not an afterthought: how much is left
       * is computed from them, and a tube drawn down after an entry was signed
       * is showing a different number from the one that was signed.
       */
      const uses = r.uses.map(u => `${u.amount}${u.unit}`).join(',');
      out.push({
        kind: 'sample',
        targetId: r.id,
        state: [
          r.sampleId, r.name, r.status,
          `${r.amount ?? ''}${r.amountUnit ?? ''}`,
          `${r.concValue ?? ''}${r.concPer ?? ''}${r.concVolume ?? ''}`,
          `${r.box ?? ''}/${r.position ?? ''}`,
          uses,
        ].join(SEP),
      });
    }
  }

  const plateIds = byKind.get('plate') ?? [];
  if (plateIds.length) {
    const rows = await prisma.plate.findMany({
      where: { id: { in: plateIds } },
      select: {
        id: true, name: true, format: true,
        wells: {
          select: { row: true, col: true, label: true, sampleId: true, content: true, role: true },
          orderBy: [{ row: 'asc' }, { col: 'asc' }],
        },
      },
    });
    for (const r of rows) {
      out.push({
        kind: 'plate',
        targetId: r.id,
        state: [
          r.name, String(r.format),
          r.wells.map(w => `${w.row}.${w.col}:${w.label}:${w.sampleId ?? ''}:${w.content ?? ''}:${w.role ?? ''}`).join(','),
        ].join(SEP),
      });
    }
  }

  const resultIds = byKind.get('result') ?? [];
  if (resultIds.length) {
    const rows = await prisma.assayResult.findMany({
      where: { id: { in: resultIds } },
      select: {
        id: true, schemaId: true, measuredAt: true,
        values: {
          select: { fieldId: true, text: true, number: true, boolean: true, date: true, refId: true },
          orderBy: { fieldId: 'asc' },
        },
      },
    });
    for (const r of rows) {
      out.push({
        kind: 'result',
        targetId: r.id,
        state: [
          r.schemaId, r.measuredAt.toISOString(),
          /*
           * Every column of a value, not whichever one happens to be set. A
           * number replaced by text in the same field is a change to the
           * result, and reading only one column would miss it.
           */
          r.values.map(v => [
            v.fieldId, v.text ?? '', v.number ?? '', v.boolean ?? '',
            v.date?.toISOString() ?? '', v.refId ?? '',
          ].join('=')).join(','),
        ].join(SEP),
      });
    }
  }

  /*
   * Kinds with no reader here -- tasks, entities, procedures, gels -- are left
   * out rather than given an empty state. An empty state would digest to
   * something stable and claim the record had been checked, which is a lie a
   * signature should not tell. Absent, they show up as unrecorded, and the
   * entry says plainly that nothing can be said about them.
   */
  return out;
}

/** The links on an entry, in the shape the state reader and the checker want. */
export async function embedsForEntry(entryId: string) {
  return prisma.notebookLink.findMany({
    where: { entryId },
    select: { kind: true, targetId: true, label: true, snapshot: true },
  });
}
