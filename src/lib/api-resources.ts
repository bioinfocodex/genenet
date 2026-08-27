import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * What the API exposes, and the shape of each thing.
 *
 * Declared in one table rather than written out per route, so a resource cannot
 * accidentally expose a field it should not, or accept one it should not. The
 * writable list is the allow-list: anything a caller sends that is not on it is
 * ignored rather than passed to the database.
 */

export interface ResourceSpec {
  /** The Prisma delegate name. */
  model: string;
  /** Plural, as it appears in the URL. */
  path: string;
  /** Fields returned. Anything not listed is not exposed. */
  fields: string[];
  /** Fields a caller may set on create or update. */
  writable: string[];
  /** Required on create. */
  required: string[];
  /** Default ordering. */
  orderBy?: Record<string, 'asc' | 'desc'>;
  /** Fields matched by the ?q= filter. */
  searchable?: string[];
  /** Set to the acting user on create, if the model has it. */
  creatorField?: string;
  /** Generated for a new record when absent, e.g. PLA-001. */
  humanIdField?: { field: string; prefix: string };
}

export const RESOURCES: Record<string, ResourceSpec> = {
  samples: {
    model: 'sample', path: 'samples',
    fields: ['id', 'sampleId', 'name', 'type', 'status', 'description', 'notes',
             'freezerId', 'rack', 'box', 'position', 'createdAt', 'updatedAt'],
    writable: ['name', 'type', 'status', 'description', 'notes', 'freezerId', 'rack', 'box', 'position'],
    required: ['name', 'type'],
    orderBy: { createdAt: 'desc' },
    searchable: ['sampleId', 'name', 'description', 'notes'],
    creatorField: 'createdById',
    humanIdField: { field: 'sampleId', prefix: 'SAM' },
  },
  sequences: {
    model: 'geneSequence', path: 'sequences',
    fields: ['id', 'name', 'description', 'type', 'sequence', 'size', 'tags', 'features', 'createdAt', 'updatedAt'],
    writable: ['name', 'description', 'type', 'sequence', 'tags', 'features'],
    required: ['name', 'sequence'],
    orderBy: { createdAt: 'desc' },
    searchable: ['name', 'description', 'tags'],
  },
  procedures: {
    model: 'procedure', path: 'procedures',
    fields: ['id', 'procedureId', 'name', 'description', 'category', 'version', 'status', 'safetyNotes', 'createdAt', 'updatedAt'],
    writable: ['name', 'description', 'category', 'status', 'safetyNotes'],
    required: ['name'],
    orderBy: { updatedAt: 'desc' },
    searchable: ['procedureId', 'name', 'description', 'category'],
    creatorField: 'authorId',
    humanIdField: { field: 'procedureId', prefix: 'PROC' },
  },
  projects: {
    model: 'project', path: 'projects',
    fields: ['id', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
    writable: ['name', 'description', 'status'],
    required: ['name'],
    orderBy: { updatedAt: 'desc' },
    searchable: ['name', 'description'],
    creatorField: 'createdById',
  },
  tasks: {
    model: 'task', path: 'tasks',
    fields: ['id', 'title', 'description', 'status', 'priority', 'projectId', 'assignedToId', 'result', 'createdAt'],
    writable: ['title', 'description', 'status', 'priority', 'projectId', 'assignedToId', 'result'],
    required: ['title'],
    orderBy: { createdAt: 'desc' },
    searchable: ['title', 'description'],
    creatorField: 'createdById',
  },
  freezers: {
    model: 'freezer', path: 'freezers',
    fields: ['id', 'name', 'location', 'temperature', 'notes'],
    writable: ['name', 'location', 'temperature', 'notes'],
    required: ['name', 'temperature'],
    searchable: ['name', 'location'],
  },
};

function delegate(model: string) {
  const d = (prisma as unknown as Record<string, Record<string, (a?: unknown) => Promise<unknown>>>)[model];
  if (!d) throw new Error(`Unknown resource: ${model}`);
  return d;
}

/** Only the declared fields, so an added column is never exposed by accident. */
export function project(spec: ResourceSpec, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) if (f in row) out[f] = row[f];
  return out;
}

/** Only the writable fields, so a caller cannot set an id or a timestamp. */
export function acceptInput(spec: ResourceSpec, body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Body must be a JSON object.');
  }
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of spec.writable) if (f in src && src[f] !== undefined) out[f] = src[f];
  return out;
}

export async function listResource(
  spec: ResourceSpec,
  opts: { limit: number; offset: number; q?: string },
): Promise<{ data: unknown[]; total: number; limit: number; offset: number }> {
  const where = opts.q && spec.searchable?.length
    ? { OR: spec.searchable.map(f => ({ [f]: { contains: opts.q } })) }
    : undefined;

  const d = delegate(spec.model);
  const [rows, total] = await Promise.all([
    d.findMany({ where, take: opts.limit, skip: opts.offset, orderBy: spec.orderBy }) as Promise<Record<string, unknown>[]>,
    d.count({ where }) as unknown as Promise<number>,
  ]);

  return {
    data: rows.map(r => project(spec, r)),
    total,
    limit: opts.limit,
    offset: opts.offset,
  };
}

export async function getResource(spec: ResourceSpec, id: string): Promise<Record<string, unknown> | null> {
  const row = await delegate(spec.model).findUnique({ where: { id } }) as Record<string, unknown> | null;
  return row ? project(spec, row) : null;
}

/** Next in a PLA-001 style series. */
async function nextHumanId(spec: ResourceSpec): Promise<string> {
  const { field, prefix } = spec.humanIdField!;
  const count = await (delegate(spec.model).count({}) as unknown as Promise<number>);
  void field;
  return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

export async function createResource(
  spec: ResourceSpec, body: unknown, actorUserId: string,
): Promise<Record<string, unknown>> {
  const data = acceptInput(spec, body);

  const missing = spec.required.filter(f => data[f] === undefined || data[f] === '');
  if (missing.length) {
    throw new Error(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
  }

  if (spec.humanIdField && !data[spec.humanIdField.field]) {
    data[spec.humanIdField.field] = await nextHumanId(spec);
  }
  if (spec.creatorField) data[spec.creatorField] = actorUserId;

  // Sequences carry a size derived from the sequence itself; a caller should
  // not be able to disagree with it.
  if (spec.model === 'geneSequence' && typeof data.sequence === 'string') {
    data.sequence = data.sequence.toUpperCase().replace(/\s/g, '');
    data.size = (data.sequence as string).length;
    data.type ??= (data.sequence as string).length > 3000 ? 'plasmid' : 'gene';
  }

  const row = await delegate(spec.model).create({ data }) as Record<string, unknown>;
  return project(spec, row);
}

export async function updateResource(
  spec: ResourceSpec, id: string, body: unknown,
): Promise<Record<string, unknown> | null> {
  const data = acceptInput(spec, body);
  if (!Object.keys(data).length) throw new Error('No writable fields in the body.');

  if (spec.model === 'geneSequence' && typeof data.sequence === 'string') {
    data.sequence = data.sequence.toUpperCase().replace(/\s/g, '');
    data.size = (data.sequence as string).length;
  }

  const existing = await delegate(spec.model).findUnique({ where: { id } });
  if (!existing) return null;

  const row = await delegate(spec.model).update({ where: { id }, data }) as Record<string, unknown>;
  return project(spec, row);
}
