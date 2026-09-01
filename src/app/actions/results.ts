'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser, requireAdmin } from '@/lib/auth-guard';
import {
  keyFromLabel, uniqueKey, validateDefinition, coerceRecord,
  type FieldDefinition, type FieldType, FIELD_TYPES,
} from '@/lib/fields';
import type { ActionResult } from './entities';

/**
 * Result schemas, and the results recorded against them.
 *
 * A result written as free text is a result nobody can plot. Declaring the
 * columns up front — OD600 as a number, "passed" as a boolean, operator as text
 * — means a year of assays can be compared without anyone re-reading them.
 *
 * Defining a schema is an admin action for the same reason defining an entity
 * type is: a schema anyone can extend stops being a schema. Recording against
 * one is not, because the person at the plate reader has to be able to file
 * what they measured.
 */

/** Parse field definitions from the form, keeping existing keys stable. */
function parseFields(raw: string): FieldDefinition[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'The field list could not be read.' };
  }
  if (!Array.isArray(parsed)) return { error: 'The field list is not a list.' };

  const taken: string[] = [];
  const defs: FieldDefinition[] = [];

  for (const [i, item] of parsed.entries()) {
    const o = item as Record<string, unknown>;
    const label = String(o.label ?? '').trim();
    const type = String(o.type ?? 'text') as FieldType;
    if (!FIELD_TYPES.includes(type)) return { error: `Field ${i + 1} has an unknown type.` };

    const key = o.key ? String(o.key) : uniqueKey(keyFromLabel(label), taken);
    taken.push(key);

    const def: FieldDefinition = {
      id: o.id ? String(o.id) : undefined,
      key, label, type,
      required: Boolean(o.required),
      isUnique: Boolean(o.isUnique),
      options: Array.isArray(o.options) ? o.options.map(String).filter(Boolean) : null,
      linkTypeId: o.linkTypeId ? String(o.linkTypeId) : null,
      unit: o.unit ? String(o.unit) : null,
      helpText: o.helpText ? String(o.helpText) : null,
      order: i,
    };

    const problems = validateDefinition(def);
    if (problems.length) return { error: problems[0] };
    defs.push(def);
  }

  const keys = defs.map(d => d.key);
  if (new Set(keys).size !== keys.length) return { error: 'Two fields ended up with the same key.' };
  return defs;
}

export async function createResultSchema(data: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const name = String(data.get('name') ?? '').trim();
    const description = String(data.get('description') ?? '').trim() || null;
    if (!name) return { error: 'Give the assay a name.' };

    const defs = parseFields(String(data.get('fields') ?? '[]'));
    if ('error' in defs) return defs;
    if (defs.length === 0) return { error: 'An assay needs at least one field to record.' };

    const clash = await prisma.resultSchema.findUnique({ where: { name }, select: { id: true } });
    if (clash) return { error: `An assay called "${name}" already exists.` };

    const created = await prisma.resultSchema.create({
      data: {
        name, description, createdById: user.id,
        fields: {
          create: defs.map(d => ({
            key: d.key, label: d.label, type: d.type,
            required: d.required ?? false, isUnique: d.isUnique ?? false,
            options: d.options?.length ? JSON.stringify(d.options) : null,
            linkTypeId: d.linkTypeId ?? null,
            unit: d.unit ?? null, helpText: d.helpText ?? null, order: d.order ?? 0,
          })),
        },
      },
      select: { id: true },
    });

    revalidatePath('/results');
    return { ok: true, id: created.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create the assay.' };
  }
}

export async function updateResultSchema(data: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(data.get('id') ?? '');
    const schema = await prisma.resultSchema.findUnique({
      where: { id }, include: { fields: true },
    });
    if (!schema) return { error: 'That assay no longer exists.' };

    const name = String(data.get('name') ?? '').trim();
    if (!name) return { error: 'Give the assay a name.' };

    const defs = parseFields(String(data.get('fields') ?? '[]'));
    if ('error' in defs) return defs;
    if (defs.length === 0) return { error: 'An assay needs at least one field.' };

    const kept = new Set(defs.filter(d => d.id).map(d => d.id));
    const removed = schema.fields.filter(f => !kept.has(f.id));

    // Removing a field deletes every reading taken under it. Say how many
    // rather than doing it quietly.
    if (removed.length > 0 && data.get('confirmDelete') !== 'yes') {
      const count = await prisma.fieldValue.count({
        where: { fieldId: { in: removed.map(f => f.id) } },
      });
      return {
        error: `Removing ${removed.map(f => f.label).join(', ')} would delete ${count} recorded reading${count === 1 ? '' : 's'}. Confirm to go ahead.`,
      };
    }

    await prisma.$transaction([
      prisma.resultSchema.update({
        where: { id },
        data: { name, description: String(data.get('description') ?? '').trim() || null },
      }),
      ...removed.map(f => prisma.fieldDef.delete({ where: { id: f.id } })),
      ...defs.map(d =>
        d.id
          ? prisma.fieldDef.update({
              where: { id: d.id },
              data: {
                label: d.label, required: d.required ?? false, isUnique: d.isUnique ?? false,
                options: d.options?.length ? JSON.stringify(d.options) : null,
                unit: d.unit ?? null, order: d.order ?? 0,
              },
            })
          : prisma.fieldDef.create({
              data: {
                resultSchemaId: id,
                key: d.key, label: d.label, type: d.type,
                required: d.required ?? false, isUnique: d.isUnique ?? false,
                options: d.options?.length ? JSON.stringify(d.options) : null,
                linkTypeId: d.linkTypeId ?? null,
                unit: d.unit ?? null, order: d.order ?? 0,
              },
            }),
      ),
    ]);

    revalidatePath(`/results/${id}`);
    revalidatePath('/results');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update the assay.' };
  }
}

function toDefinitions(fields: {
  id: string; key: string; label: string; type: string; required: boolean;
  isUnique: boolean; options: string | null; linkTypeId: string | null;
  unit: string | null; helpText: string | null; order: number;
}[]): FieldDefinition[] {
  return fields
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(f => ({
      id: f.id, key: f.key, label: f.label, type: f.type as FieldType,
      required: f.required, isUnique: f.isUnique,
      options: f.options ? (JSON.parse(f.options) as string[]) : null,
      linkTypeId: f.linkTypeId, unit: f.unit, helpText: f.helpText, order: f.order,
    }));
}

export async function recordResult(data: FormData): Promise<ActionResult<{ id: string; count: number }>> {
  try {
    const user = await requireUser();
    const schemaId = String(data.get('schemaId') ?? '');

    const schema = await prisma.resultSchema.findUnique({
      where: { id: schemaId }, include: { fields: true },
    });
    if (!schema) return { error: 'That assay no longer exists.' };

    const defs = toDefinitions(schema.fields);

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(String(data.get('values') ?? '{}')) as Record<string, unknown>;
    } catch {
      return { error: 'The readings could not be read.' };
    }

    const coerced = coerceRecord(defs, input);
    if ('errors' in coerced) return { error: coerced.errors.map(e => e.message).join(' ') };

    const rawDate = String(data.get('measuredAt') ?? '');
    const measuredAt = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(measuredAt.getTime())) return { error: 'That is not a date.' };

    // What was measured. At most one target, because a reading attached to
    // both a sample and a well would be counted twice by anything that groups.
    const targets = {
      sampleId: String(data.get('sampleId') ?? '') || null,
      wellId: String(data.get('wellId') ?? '') || null,
      taskId: String(data.get('taskId') ?? '') || null,
      entityId: String(data.get('entityId') ?? '') || null,
    };
    const named = Object.values(targets).filter(Boolean);
    if (named.length > 1) {
      return { error: 'A reading is attached to one thing. Choose a sample, a well, a task or a record — not several.' };
    }

    const created = await prisma.assayResult.create({
      data: {
        schemaId, measuredAt, recordedById: user.id, ...targets,
        values: { create: defs.map(d => ({ fieldId: d.id!, ...coerced.values[d.key] })) },
      },
      select: { id: true },
    });

    revalidatePath(`/results/${schemaId}`);
    if (targets.entityId) revalidatePath(`/entities/record/${targets.entityId}`);
    return { ok: true, id: created.id, count: 1 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not record the result.' };
  }
}

/**
 * Record one reading per well of a plate, from a pasted grid.
 *
 * This is the shape plate-reader output actually arrives in: a block of numbers
 * copied out of the instrument's export. Typing ninety-six values into ninety-
 * six forms is the reason structured results go unused.
 */
export async function recordPlateResults(data: FormData): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const schemaId = String(data.get('schemaId') ?? '');
    const plateId = String(data.get('plateId') ?? '');
    const fieldKey = String(data.get('fieldKey') ?? '');
    const grid = String(data.get('grid') ?? '');

    const [schema, plate] = await Promise.all([
      prisma.resultSchema.findUnique({ where: { id: schemaId }, include: { fields: true } }),
      prisma.plate.findUnique({ where: { id: plateId }, include: { wells: true } }),
    ]);
    if (!schema) return { error: 'That assay no longer exists.' };
    if (!plate) return { error: 'That plate no longer exists.' };

    const defs = toDefinitions(schema.fields);
    const target = defs.find(d => d.key === fieldKey);
    if (!target) return { error: 'Choose which reading the numbers are.' };
    if (target.type !== 'number' && target.type !== 'integer') {
      return { error: `${target.label} is not a number field — a pasted grid can only fill one.` };
    }

    // A required field the grid does not fill would fail every row, so say so
    // once here rather than ninety-six times.
    const unfillable = defs.filter(d => d.required && d.key !== fieldKey);
    if (unfillable.length) {
      return {
        error: `${unfillable.map(d => d.label).join(', ')} ${unfillable.length === 1 ? 'is' : 'are'} required and cannot come from a grid. Record these one at a time, or make the field optional.`,
      };
    }

    const rows = grid.trim().split(/\r?\n/).map(line => line.trim().split(/[\t,;]|\s{2,}|\s/).filter(s => s !== ''));
    if (rows.length === 0) return { error: 'Nothing pasted.' };

    const measuredAt = String(data.get('measuredAt') ?? '')
      ? new Date(String(data.get('measuredAt')))
      : new Date();
    if (Number.isNaN(measuredAt.getTime())) return { error: 'That is not a date.' };

    const byPos = new Map(plate.wells.map(w => [`${w.row}:${w.col}`, w]));
    const readings: { wellId: string; value: number }[] = [];
    const skipped: string[] = [];

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cell = rows[r][c];
        const n = Number(cell);
        if (!Number.isFinite(n)) { skipped.push(cell); continue; }
        const well = byPos.get(`${r}:${c}`);
        // A grid larger than the plate is a paste that included the row and
        // column headers; dropping the overflow silently would file every
        // reading one row out of place, so it is refused instead.
        if (!well) {
          return {
            error: `The pasted grid is ${rows.length} × ${Math.max(...rows.map(x => x.length))}, which does not fit this plate. Paste the numbers only, without the row letters or column numbers.`,
          };
        }
        readings.push({ wellId: well.id, value: n });
      }
    }

    if (readings.length === 0) return { error: 'No numbers found in what was pasted.' };

    await prisma.$transaction(
      readings.map(r =>
        prisma.assayResult.create({
          data: {
            schemaId, measuredAt, recordedById: user.id, wellId: r.wellId,
            values: { create: [{ fieldId: target.id!, number: r.value }] },
          },
        }),
      ),
    );

    revalidatePath(`/results/${schemaId}`);
    revalidatePath(`/plates/${plateId}`);
    return { ok: true, count: readings.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not record those readings.' };
  }
}

export async function deleteResult(data: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const id = String(data.get('id') ?? '');
    const result = await prisma.assayResult.findUnique({
      where: { id }, select: { recordedById: true, schemaId: true },
    });
    if (!result) return { error: 'That result no longer exists.' };
    if (result.recordedById !== user.id && user.role !== 'ADMIN') {
      return { error: 'Only the person who recorded a reading, or an admin, can remove it.' };
    }

    await prisma.assayResult.delete({ where: { id } });
    revalidatePath(`/results/${result.schemaId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not remove the result.' };
  }
}
