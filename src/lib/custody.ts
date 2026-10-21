/**
 * Who has the tube.
 *
 * A freezer inventory answers "where is it" with a shelf and a box, which is
 * the right answer right up until somebody is holding it. Then the shelf is
 * wrong, and the person who walks to the freezer finds a gap -- the single
 * most common way an inventory stops being believed.
 *
 * Deliberately small. This is a lending record, not a chain of custody: it
 * says who has it now, since when, and when it was meant to come back.
 */

export interface Custody {
  /** Null when the sample is in its freezer. */
  heldBy: string | null;
  /** When it left, as an ISO string. */
  heldSince: string | null;
  /** When it was meant to be back, as an ISO string. Optional. */
  dueBack: string | null;
}

export const isOut = (c: Custody): boolean => c.heldBy !== null;

/**
 * Whether it is late, and by how much.
 *
 * A due date with no time is read as the end of that day rather than its
 * start: a tube due back on Friday is not late at one minute past midnight on
 * Friday morning, and reporting it as such would teach everybody to ignore the
 * flag, which is the whole value of having one.
 */
export function overdueBy(c: Custody, now = new Date()): number | null {
  if (!c.heldBy || !c.dueBack) return null;
  const due = endOfDay(c.dueBack);
  if (due === null) return null;
  const late = now.getTime() - due;
  return late > 0 ? late : null;
}

function endOfDay(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  /*
   * A date-only value parses as midnight UTC. Anything carrying a time of day
   * was chosen deliberately and is left alone.
   */
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);
  return dateOnly ? d.getTime() + 24 * 60 * 60 * 1000 - 1 : d.getTime();
}

/**
 * A due date written as the day it was chosen to be.
 *
 * A date with no time parses as midnight UTC, and formatting that in local
 * time shows the day before to anybody west of Greenwich. A tube due back on
 * Saturday read as due Friday on a screen in Boston, which was found by
 * looking at it rather than by any test: a test machine on UTC never sees it.
 */
export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);
  return d.toLocaleDateString(undefined, dateOnly ? { timeZone: 'UTC' } : undefined);
}

/** How long it has been out, in milliseconds. */
export function outFor(c: Custody, now = new Date()): number | null {
  if (!c.heldBy || !c.heldSince) return null;
  const since = new Date(c.heldSince).getTime();
  if (Number.isNaN(since)) return null;
  return Math.max(0, now.getTime() - since);
}

/** "3 days", "5 hours", "20 minutes" — one unit, which is all anybody reads. */
export function describeSpan(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} week${weeks === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** A sentence for the sample page and the freezer list. */
export function describeCustody(c: Custody, now = new Date()): string | null {
  if (!c.heldBy) return null;
  const out = outFor(c, now);
  const late = overdueBy(c, now);
  const held = out === null ? `${c.heldBy} has it` : `${c.heldBy} has had it for ${describeSpan(out)}`;
  if (late !== null) return `${held}, due back ${describeSpan(late)} ago`;
  if (c.dueBack) return `${held}, due back ${formatDueDate(c.dueBack)}`;
  return held;
}

export type CustodyChange =
  | { ok: true }
  | { ok: false; why: string };

/**
 * Whether this person may take it.
 *
 * Refused when somebody else already has it, and refused when the same person
 * already has it -- the second is not pedantry. Checking out twice would move
 * the "since" forward and lose how long it has really been gone, which is the
 * number that matters when a tube has been out for three weeks.
 */
export function canCheckOut(c: Custody, who: string): CustodyChange {
  if (!c.heldBy) return { ok: true };
  if (c.heldBy === who) return { ok: false, why: 'You already have this one.' };
  return { ok: false, why: `${c.heldBy} has it. Ask them to put it back first.` };
}

/**
 * Whether it can be put back.
 *
 * Anybody may return it, not only the person who took it: tubes come back in
 * somebody else's rack, and a rule that only the borrower can return one means
 * the record stays wrong until they are next at their desk.
 */
export function canCheckIn(c: Custody): CustodyChange {
  if (!c.heldBy) return { ok: false, why: 'This one is not out.' };
  return { ok: true };
}

/** A due date so far off it was probably a typo, or one already past. */
export function problemWithDueDate(raw: string, now = new Date()): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'That is not a date.';
  const end = endOfDay(raw);
  if (end !== null && end < now.getTime()) return 'That date has already passed.';
  const years = (d.getTime() - now.getTime()) / (365 * 24 * 60 * 60 * 1000);
  if (years > 2) return 'That is more than two years away.';
  return null;
}
