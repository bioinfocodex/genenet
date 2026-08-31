import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * The history of one record, read back out of the audit trail.
 *
 * The trail added in 1d832bc already stores the row before and after every
 * change. Nothing read it back, which meant the past was preserved and
 * invisible -- a record could be rewritten and the only way to find out was to
 * open the database and read a table the application never showed anyone.
 *
 * That is the gap this closes. Not "edits are forbidden": a lab notebook that
 * refuses corrections is one people keep a second, real notebook alongside.
 * Part 11 asks that changes must not obscure what was previously recorded, and
 * the way to satisfy that is to show the previous value, with who changed it
 * and when, next to the record itself.
 *
 * Note that ProcedureVersion, the one existing piece of versioning, stores a
 * version number and a changelog sentence but not the prior content. It says
 * that something changed, not what it used to say.
 */

/** Noise: changes to these say nothing about what the record means. */
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt', 'id']);

/** Never shown, even though the trail redacts it already. */
const HIDDEN_FIELDS = new Set(['passwordHash']);

import { describeSequenceChange, summariseSequenceChange } from '@/lib/sequence-diff';
import type { FieldChange, HistoryEntry } from '@/lib/history-types';
export type { FieldChange, HistoryEntry };

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** A value as a person would read it, truncated so one long field cannot fill the page. */
function show(v: unknown, max = 140): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** camelCase and snake_case into something readable. */
function label(field: string): string {
  const spaced = field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChange[] {
  if (!before || !after) return [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldChange[] = [];
  for (const f of fields) {
    if (IGNORED_FIELDS.has(f) || HIDDEN_FIELDS.has(f)) continue;
    const a = before[f];
    const b = after[f];
    // An update sends only the fields it sets, so a key missing from `after`
    // was not changed rather than cleared.
    if (!(f in after)) continue;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;

      // A sequence is the one field where showing the value tells you nothing:
      // truncated at 140 characters, before and after look identical. Where it
      // changed and by how much is what a person can act on.
      if (f === 'sequence' && typeof a === 'string' && typeof b === 'string') {
        const change = describeSequenceChange(a, b);
        out.push({
          field: 'Sequence',
          from: `${change.before.toLocaleString()} bp`,
          to: summariseSequenceChange(change),
        });
        continue;
      }

    out.push({ field: label(f), from: show(a), to: show(b) });
  }
  return out.sort((x, y) => x.field.localeCompare(y.field));
}

/**
 * Everything that has happened to one record, newest first.
 *
 * `model` is the Prisma model name as the audit trail stores it: Procedure,
 * Report, Sample, and so on.
 */
export async function historyFor(model: string, recordId: string, limit = 50): Promise<HistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { model, recordId },
    orderBy: { at: 'desc' },
    take: limit,
  });

  // The trail stores actorId and actorEmail, not a display name, so that a
  // deleted account can still be attributed. Names are resolved for the people
  // who still exist; everyone else is shown by the email the trail recorded.
  const ids = [...new Set(rows.map(r => r.actorId).filter((v): v is string => !!v))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map(u => [u.id, u.name]));

  return rows.map(r => {
    const changes = r.action === 'update' ? diff(parse(r.before), parse(r.after)) : [];
    return {
      id: r.id,
      at: r.at,
      action: r.action,
      actorName: (r.actorId && nameById.get(r.actorId)) || r.actorEmail || 'the system',
      changes,
      trivial: r.action === 'update' && changes.length === 0,
    };
  });
}

/** For a heading: how many real changes this record has seen. */
export async function changeCountFor(model: string, recordId: string): Promise<number> {
  return prisma.auditLog.count({ where: { model, recordId, action: 'update' } });
}
