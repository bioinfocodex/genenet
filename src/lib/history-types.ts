/**
 * Shapes shared between the history reader and the panel that renders it.
 *
 * Separate from lib/history.ts for the same reason lib/signature-types.ts is
 * separate: the panel is a client component, and importing anything from a
 * 'server-only' module pulls Prisma and next/headers into the client bundle
 * and fails the build.
 */

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface HistoryEntry {
  id: string;
  at: Date;
  action: 'create' | 'update' | 'delete' | string;
  actorName: string;
  /** Empty for a create or delete; populated for an update. */
  changes: FieldChange[];
  /** True when an update touched only ignored fields. */
  trivial: boolean;
}
