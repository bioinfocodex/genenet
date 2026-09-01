'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireUser, requireAdmin } from '@/lib/auth-guard';
import {
  keyFromLabel, uniqueKey, validateDefinition, coerceRecord, nextCode, validatePrefix,
  type FieldDefinition, type FieldType, FIELD_TYPES,
} from '@/lib/fields';

/**
 * Creating and filling lab-defined record types.
 *
 * Defining a type is an admin action and filling one in is not. Getting that
 * backwards in either direction is a real cost: if anyone can add a field, the
 * schema turns to mush within a month; if only admins can add a record, the
 * feature goes unused because the person holding the tube cannot file it.
 */

export type ActionResult<T = unknown> = ({ ok: true } & T) | { error: string };

/** Field definitions as the form sends them, parsed and checked. */
function parseFields(raw: string, existingKeys: string[] = []): FieldDefinition[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'The field list could not be read.' };
  }
  if (!Array.isArray(parsed)) return { error: 'The field list is not a list.' };

  const taken = [...existingKeys];
  const defs: FieldDefinition[] = [];

  for (const [i, item] of parsed.entries()) {
    const o = item as Record<string, unknown>;
    const label = String(o.label ?? '').trim();
    const type = String(o.type ?? 'text') as FieldType;
    if (!FIELD_TYPES.includes(type)) return { error: `Field ${i + 1} has an unknown type.` };

    // An existing field keeps its key; a new one gets one derived from its
    // label. Regenerating keys on every save would orphan every value already
    // recorded under the old key.
    const key = o.key ? String(o.key) : uniqueKey(keyFromLabel(label), taken);
    taken.push(key);

    const def: FieldDefinition = {
      id: o.id ? String(o.id) : undefined,
      key,
      label,
      type,
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

export async function createEntityType(data: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();

    const name = String(data.get('name') ?? '').trim();
    const plural = String(data.get('plural') ?? '').trim() || `${name}s`;
    const prefix = String(data.get('prefix') ?? '').trim().toUpperCase();
    const description = String(data.get('description') ?? '').trim() || null;
    const color = String(data.get('color') ?? '#3b82f6');

    if (!name) return { error: 'Give the type a name.' };
    const prefixProblem = validatePrefix(prefix);
    if (prefixProblem) return { error: prefixProblem };

    const defs = parseFields(String(data.get('fields') ?? '[]'));
    if ('error' in defs) return defs;
    if (defs.length === 0) return { error: 'A type needs at least one field.' };

    const clash = await prisma.entityType.findFirst({
      where: { OR: [{ name }, { prefix }] },
      select: { name: true, prefix: true },
    });
    if (clash) {
      return {
        error: clash.name === name
          ? `A type called "${name}" already exists.`
          : `The prefix ${prefix} is already used by "${clash.name}".`,
      };
    }

    const created = await prisma.entityType.create({
      data: {
        name, plural, prefix, description, color,
        createdById: user.id,
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

    revalidatePath('/entities');
    return { ok: true, id: created.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create the type.' };
  }
}

export async function updateEntityType(data: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(data.get('id') ?? '');
    const type = await prisma.entityType.findUnique({
      where: { id },
      include: { fields: true },
    });
    if (!type) return { error: 'That type no longer exists.' };

    const name = String(data.get('name') ?? '').trim();
    const plural = String(data.get('plural') ?? '').trim() || `${name}s`;
    if (!name) return { error: 'Give the type a name.' };

    const defs = parseFields(String(data.get('fields') ?? '[]'), []);
    if ('error' in defs) return defs;
    if (defs.length === 0) return { error: 'A type needs at least one field.' };

    const keptIds = new Set(defs.filter(d => d.id).map(d => d.id));
    const removed = type.fields.filter(f => !keptIds.has(f.id));

    // Removing a field deletes every value recorded under it. Say how many
    // rather than doing it quietly — this is the one irreversible thing on
    // the page.
    if (removed.length > 0 && data.get('confirmDelete') !== 'yes') {
      const count = await prisma.fieldValue.count({
        where: { fieldId: { in: removed.map(f => f.id) } },
      });
      return {
        error: count > 0
          ? `Removing ${removed.map(f => f.label).join(', ')} would delete ${count} recorded value${count === 1 ? '' : 's'}. Confirm to go ahead.`
          : `Removing ${removed.map(f => f.label).join(', ')}. Confirm to go ahead.`,
      };
    }

    await prisma.$transaction([
      prisma.entityType.update({
        where: { id },
        data: {
          name, plural,
          description: String(data.get('description') ?? '').trim() || null,
          color: String(data.get('color') ?? '#3b82f6'),
        },
      }),
      ...removed.map(f => prisma.fieldDef.delete({ where: { id: f.id } })),
      ...defs.map(d =>
        d.id
          ? prisma.fieldDef.update({
              where: { id: d.id },
              data: {
                label: d.label, required: d.required ?? false, isUnique: d.isUnique ?? false,
                options: d.options?.length ? JSON.stringify(d.options) : null,
                unit: d.unit ?? null, helpText: d.helpText ?? null, order: d.order ?? 0,
              },
            })
          // The type of an existing field is not editable: changing "number"
          // to "date" would leave every recorded value in the wrong column.
          : prisma.fieldDef.create({
              data: {
                entityTypeId: id,
                key: d.key, label: d.label, type: d.type,
                required: d.required ?? false, isUnique: d.isUnique ?? false,
                options: d.options?.length ? JSON.stringify(d.options) : null,
                linkTypeId: d.linkTypeId ?? null,
                unit: d.unit ?? null, helpText: d.helpText ?? null, order: d.order ?? 0,
              },
            }),
      ),
    ]);

    revalidatePath('/entities');
    revalidatePath(`/entities/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update the type.' };
  }
}

export async function archiveEntityType(data: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(data.get('id') ?? '');
    const archived = data.get('archived') === 'yes';
    await prisma.entityType.update({ where: { id }, data: { archived } });
    revalidatePath('/entities');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not archive the type.' };
  }
}

/** Field definitions as the engine wants them, read back from the database. */
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

export async function saveEntity(data: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();

    const entityTypeId = String(data.get('entityTypeId') ?? '');
    const entityId = String(data.get('entityId') ?? '') || null;
    const name = String(data.get('name') ?? '').trim();
    const projectId = String(data.get('projectId') ?? '') || null;

    if (!name) return { error: 'Give the record a name.' };

    const type = await prisma.entityType.findUnique({
      where: { id: entityTypeId },
      include: { fields: true },
    });
    if (!type) return { error: 'That type no longer exists.' };

    const defs = toDefinitions(type.fields);

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(String(data.get('values') ?? '{}')) as Record<string, unknown>;
    } catch {
      return { error: 'The values could not be read.' };
    }

    const coerced = coerceRecord(defs, input);
    if ('errors' in coerced) {
      return { error: coerced.errors.map(e => e.message).join(' ') };
    }

    // Uniqueness is checked here rather than by a database constraint: the
    // constraint would have to be per (field, value) across a shared table, and
    // SQLite cannot express "unique among rows whose fieldId is this one" for
    // a value that lives in one of four possible columns.
    for (const def of defs.filter(d => d.isUnique)) {
      const v = coerced.values[def.key];
      const probe = v.text ?? v.number ?? v.date ?? v.refId;
      if (probe === null || probe === undefined) continue;
      const clash = await prisma.fieldValue.findFirst({
        where: {
          fieldId: def.id,
          ...(v.text !== null ? { text: v.text } : {}),
          ...(v.number !== null ? { number: v.number } : {}),
          ...(v.date !== null ? { date: v.date } : {}),
          ...(v.refId !== null ? { refId: v.refId } : {}),
          ...(entityId ? { entityId: { not: entityId } } : {}),
          entity: { is: {} },
        },
        select: { entity: { select: { code: true, name: true } } },
      });
      if (clash?.entity) {
        return { error: `${def.label} must be unique — ${clash.entity.code} (${clash.entity.name}) already has that value.` };
      }
    }

    // Resolve the display name for every reference, so a deleted target still
    // reads as something.
    const withLabels = await Promise.all(defs.map(async def => {
      const v = coerced.values[def.key];
      if (!v.refId) return [def, v] as const;
      let label: string | null = null;
      if (def.type === 'link') {
        const e = await prisma.entity.findUnique({ where: { id: v.refId }, select: { code: true, name: true } });
        label = e ? `${e.code} · ${e.name}` : null;
      } else if (def.type === 'sequence') {
        const s = await prisma.geneSequence.findUnique({ where: { id: v.refId }, select: { name: true } });
        label = s?.name ?? null;
      } else if (def.type === 'sample') {
        const s = await prisma.sample.findUnique({ where: { id: v.refId }, select: { sampleId: true, name: true } });
        label = s ? `${s.sampleId} · ${s.name}` : null;
      }
      return [def, { ...v, text: label }] as const;
    }));

    if (entityId) {
      await prisma.$transaction([
        prisma.entity.update({ where: { id: entityId }, data: { name, projectId } }),
        ...withLabels.map(([def, v]) =>
          prisma.fieldValue.upsert({
            where: { entityId_fieldId: { entityId, fieldId: def.id! } },
            create: { entityId, fieldId: def.id!, ...v },
            update: { ...v },
          }),
        ),
      ]);
      revalidatePath(`/entities/record/${entityId}`);
      revalidatePath(`/entities/${entityTypeId}`);
      return { ok: true, id: entityId };
    }

    // Codes are issued from the highest already used, so a deleted record's
    // code is never handed to a different record.
    const existing = await prisma.entity.findMany({
      where: { entityTypeId },
      select: { code: true },
    });
    const code = nextCode(type.prefix, existing.map(e => e.code));

    const created = await prisma.entity.create({
      data: {
        code, name, entityTypeId, projectId, createdById: user.id,
        values: { create: withLabels.map(([def, v]) => ({ fieldId: def.id!, ...v })) },
      },
      select: { id: true },
    });

    revalidatePath(`/entities/${entityTypeId}`);
    return { ok: true, id: created.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save the record.' };
  }
}

export async function archiveEntity(data: FormData): Promise<ActionResult> {
  try {
    await requireUser();
    const id = String(data.get('id') ?? '');
    const archived = data.get('archived') === 'yes';
    const e = await prisma.entity.update({
      where: { id }, data: { archived }, select: { entityTypeId: true },
    });
    revalidatePath(`/entities/${e.entityTypeId}`);
    revalidatePath(`/entities/record/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not archive the record.' };
  }
}
