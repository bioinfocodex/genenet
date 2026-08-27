import 'server-only';
import type { PrismaClient } from '@prisma/client';

/**
 * Automatic audit trail.
 *
 * Before this, three of roughly forty-eight mutations wrote an Activity row by
 * hand -- projects, procedures and experiments -- and everything else changed
 * the database silently. Samples could be edited, reports rewritten and tasks
 * deleted with no record that it happened.
 *
 * Hand-written logging was never going to hold: it is one more line to
 * remember in every new action, and the three that existed prove how that
 * goes. So this is a Prisma client extension. Every create, update, delete and
 * upsert on every model is recorded because it goes through the client, not
 * because someone remembered.
 *
 * What is captured, per 21 CFR Part 11's expectation of a computer-generated,
 * time-stamped record of creation, modification and deletion:
 *   - which model and which record
 *   - the operation
 *   - who did it, by id and by email (denormalised, so a deleted account still
 *     names its actions)
 *   - when
 *   - the row before and after, as JSON
 *
 * Updates and deletes read the prior row first, which costs an extra query per
 * mutation. That is the price of being able to answer "what did this say
 * before?", and it is the question an audit trail exists for.
 */

/** Never audited: the trail itself, and the UI activity feed. */
const SKIP_MODELS = new Set(['AuditLog', 'Activity']);

/** Fields never copied into the trail. */
const REDACT = new Set(['passwordHash']);

type Op = 'create' | 'update' | 'delete';

interface Actor { id: string | null; email: string | null }

/**
 * Resolving the actor is injected rather than imported, so this module does
 * not depend on the auth layer and can be tested on its own.
 */
export type ActorResolver = () => Promise<Actor>;

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.has(k) ? '[redacted]' : redact(v);
  }
  return out;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(redact(value), (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  } catch {
    return null;
  }
}

/**
 * Build the extension. Takes the base client so it can read prior rows and
 * write the trail without going back through itself.
 */
export function auditExtension(base: PrismaClient, resolveActor: ActorResolver) {
  const raw = base as unknown as Record<string, {
    findUnique?: (a: unknown) => Promise<unknown>;
    findMany?: (a: unknown) => Promise<unknown[]>;
  }>;

  const delegateFor = (model: string) => raw[model.charAt(0).toLowerCase() + model.slice(1)];

  async function record(
    action: Op, model: string, recordId: string | null,
    before: unknown, after: unknown, rows = 1,
  ) {
    try {
      const actor = await resolveActor();
      await base.auditLog.create({
        data: {
          action, model, recordId, rows,
          actorId: actor.id, actorEmail: actor.email,
          before: toJson(before), after: toJson(after),
        },
      });
    } catch (e) {
      // A failed audit write must never roll back the user's work, but it must
      // be loud: a silent gap in the trail is worse than a noisy one.
      console.error(
        `[genenet] AUDIT WRITE FAILED for ${action} ${model} ${recordId ?? ''}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  /** The row a where-clause points at, before it is changed. */
  async function priorRow(model: string, where: unknown): Promise<unknown> {
    try {
      const d = delegateFor(model);
      if (!d?.findUnique) return null;
      return await d.findUnique({ where });
    } catch {
      return null;
    }
  }

  async function priorRows(model: string, where: unknown): Promise<unknown[]> {
    try {
      const d = delegateFor(model);
      if (!d?.findMany) return [];
      // Capped: a bulk delete of thousands should not put thousands of rows
      // into one audit entry. The count is still recorded exactly.
      return await d.findMany({ where, take: 50 });
    } catch {
      return [];
    }
  }

  const idOf = (row: unknown): string | null => {
    if (row && typeof row === 'object' && 'id' in row) {
      const v = (row as { id: unknown }).id;
      return typeof v === 'string' ? v : v == null ? null : String(v);
    }
    return null;
  };

  return base.$extends({
    name: 'genenet-audit',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (!SKIP_MODELS.has(model)) {
            await record('create', model, idOf(result), null, result);
          }
          return result;
        },

        async update({ model, args, query }) {
          if (SKIP_MODELS.has(model)) return query(args);
          const before = await priorRow(model, (args as { where: unknown }).where);
          const result = await query(args);
          await record('update', model, idOf(result) ?? idOf(before), before, result);
          return result;
        },

        async upsert({ model, args, query }) {
          if (SKIP_MODELS.has(model)) return query(args);
          const before = await priorRow(model, (args as { where: unknown }).where);
          const result = await query(args);
          await record(before ? 'update' : 'create', model, idOf(result), before, result);
          return result;
        },

        async delete({ model, args, query }) {
          if (SKIP_MODELS.has(model)) return query(args);
          const before = await priorRow(model, (args as { where: unknown }).where);
          const result = await query(args);
          await record('delete', model, idOf(before) ?? idOf(result), before, null);
          return result;
        },

        async createMany({ model, args, query }) {
          const result = await query(args);
          if (!SKIP_MODELS.has(model)) {
            const data = (args as { data?: unknown }).data;
            const n = Array.isArray(data) ? data.length : 1;
            await record('create', model, null, null, data, n);
          }
          return result;
        },

        async updateMany({ model, args, query }) {
          if (SKIP_MODELS.has(model)) return query(args);
          const before = await priorRows(model, (args as { where?: unknown }).where);
          const result = await query(args);
          const n = (result as { count?: number })?.count ?? before.length;
          await record('update', model, null, before, (args as { data?: unknown }).data, n);
          return result;
        },

        async deleteMany({ model, args, query }) {
          if (SKIP_MODELS.has(model)) return query(args);
          const before = await priorRows(model, (args as { where?: unknown }).where);
          const result = await query(args);
          const n = (result as { count?: number })?.count ?? before.length;
          await record('delete', model, null, before, null, n);
          return result;
        },
      },
    },
  });
}
