/**
 * Asking somebody else to do something, and being able to see where it got to.
 *
 * The work a lab shares is mostly requests: sequence these four clones, make
 * this construct, run this plate. Today that is an email or a shout across the
 * bench, which means nobody can answer "what is outstanding" and the person
 * who asked has to keep asking.
 *
 * A request is deliberately not a task. A task is something somebody has taken
 * on; a request is something somebody wants, which may be refused, may be
 * queued behind thirty others, and belongs to two people at once -- the one
 * who asked and the one who will do it. Collapsing them loses the distinction
 * that makes a queue worth having.
 */

export const REQUEST_STATES = ['OPEN', 'ACCEPTED', 'DONE', 'DECLINED', 'WITHDRAWN'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const STATE_LABELS: Record<RequestState, string> = {
  OPEN: 'Waiting',
  ACCEPTED: 'In hand',
  DONE: 'Done',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

/** Still somebody's problem. */
export const isOpen = (s: RequestState) => s === 'OPEN' || s === 'ACCEPTED';

/**
 * Where a request may go from where it is.
 *
 * A closed graph rather than a free status field, because the interesting
 * question about a request is always "is this still coming", and a status
 * anybody can set to anything cannot answer it. Nothing moves out of a
 * finished state: a request that was declined and then reopened is a new
 * request, and saying so keeps the first one's history honest.
 */
const NEXT: Record<RequestState, RequestState[]> = {
  OPEN: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: ['DONE', 'DECLINED', 'OPEN'],
  DONE: [],
  DECLINED: [],
  WITHDRAWN: [],
};

export type Role = 'requester' | 'assignee' | 'other';

export interface Move {
  to: RequestState;
  label: string;
  /** Who may do it. */
  by: Role[];
  /** Said on the button, so the consequence is visible before it happens. */
  about: string;
}

/*
 * Who may do what, which is the other half of the graph.
 *
 * The requester may withdraw and may not decline; the person doing the work
 * may decline and may not withdraw. They are different acts -- "I no longer
 * need this" against "I am not going to do this" -- and a lab where those
 * read the same in the record is one where nobody can tell why a thing did
 * not happen.
 */
export const MOVES: Move[] = [
  { to: 'ACCEPTED', label: 'Take it on', by: ['requester', 'assignee', 'other'], about: 'Says you are doing it.' },
  { to: 'DONE', label: 'Mark done', by: ['assignee'], about: 'The work is finished.' },
  { to: 'DECLINED', label: 'Decline', by: ['assignee', 'other'], about: 'You are not going to do it. Say why.' },
  { to: 'WITHDRAWN', label: 'Withdraw', by: ['requester'], about: 'You no longer need it.' },
  { to: 'OPEN', label: 'Put it back', by: ['assignee'], about: 'Back to the queue for somebody else.' },
];

export function allowedMoves(from: RequestState, roles: Role | Role[]): Move[] {
  const mine = Array.isArray(roles) ? roles : [roles];
  const reachable = NEXT[from] ?? [];
  return MOVES.filter(m => reachable.includes(m.to) && m.by.some(r => mine.includes(r)));
}

export function canMove(from: RequestState, to: RequestState, roles: Role | Role[]): { ok: true } | { ok: false; why: string } {
  const mine = Array.isArray(roles) ? roles : [roles];
  if (from === to) return { ok: false, why: `It is already ${STATE_LABELS[to].toLowerCase()}.` };
  if (!(NEXT[from] ?? []).includes(to)) {
    return { ok: false, why: `Something ${STATE_LABELS[from].toLowerCase()} cannot become ${STATE_LABELS[to].toLowerCase()}.` };
  }
  const move = MOVES.find(m => m.to === to);
  if (!move || !move.by.some(r => mine.includes(r))) {
    /*
     * Named by role rather than by person, because the reason is about which
     * side of the request somebody is on, not who they are.
     */
    const who = move?.by.includes('requester') ? 'the person who asked' : 'whoever is doing the work';
    return { ok: false, why: `Only ${who} can do that.` };
  }
  return { ok: true };
}

/**
 * Which sides of a request somebody is on -- plural, because they can be both.
 *
 * Somebody asks for sequencing, nobody picks it up, and in the end they do it
 * themselves. With one role they could only withdraw their own request, which
 * loses the record that the work was actually done. So the person who asked
 * and then took it on holds both, and may both mark it done and withdraw it.
 */
export function rolesOf(
  request: { requesterId: string; assigneeId: string | null },
  userId: string,
): Role[] {
  const out: Role[] = [];
  if (request.requesterId === userId) out.push('requester');
  if (request.assigneeId === userId) out.push('assignee');
  if (out.length === 0) out.push('other');
  return out;
}

/** The single strongest role, where only one can be shown. */
export function roleOf(
  request: { requesterId: string; assigneeId: string | null },
  userId: string,
): Role {
  return rolesOf(request, userId)[0];
}

// ─── What a request is for ───────────────────────────────────────────────────

export interface RequestKind {
  id: string;
  name: string;
  about: string;
  /** What to call the records attached: "clones", "constructs", "plates". */
  subjects: string;
  /** Prompts shown in the form, which become the body's headings. */
  prompts: string[];
}

export const REQUEST_KINDS: RequestKind[] = [
  {
    id: 'sequencing',
    name: 'Sequencing',
    about: 'Sanger reads on clones somebody else will pick and send.',
    subjects: 'clones',
    prompts: ['Which primers', 'What you expect to see', 'By when'],
  },
  {
    id: 'construct',
    name: 'Make a construct',
    about: 'A plasmid built to a design.',
    subjects: 'parts',
    prompts: ['The design', 'Method if it matters', 'By when'],
  },
  {
    id: 'prep',
    name: 'Prep or purification',
    about: 'Miniprep, midiprep, protein prep.',
    subjects: 'samples',
    prompts: ['How much you need', 'Purity needed', 'By when'],
  },
  {
    id: 'other',
    name: 'Something else',
    about: 'Anything the list does not cover.',
    subjects: 'records',
    prompts: ['What you need', 'By when'],
  },
];

export const kindById = (id: string) => REQUEST_KINDS.find(k => k.id === id) ?? null;

/** The body a form starts with: one heading per prompt. */
export function bodyFor(kind: RequestKind): string {
  return kind.prompts.map(p => `## ${p}\n\n`).join('');
}

// ─── Reading a queue ─────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  state: RequestState;
  /** ISO. */
  createdAt: string;
  neededBy: string | null;
  requesterName: string;
  assigneeName: string | null;
}

/**
 * How late a request is, counting the day it is wanted as a whole day.
 *
 * The same reasoning as a tube due back: something wanted on Friday is not
 * late on Friday morning, and flagging it then teaches people to ignore the
 * flag.
 */
export function lateBy(item: { neededBy: string | null; state: RequestState }, now = new Date()): number | null {
  if (!item.neededBy || !isOpen(item.state)) return null;
  const d = new Date(item.neededBy);
  if (Number.isNaN(d.getTime())) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(item.neededBy)
    || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);
  const due = dateOnly ? d.getTime() + 24 * 60 * 60 * 1000 - 1 : d.getTime();
  const late = now.getTime() - due;
  return late > 0 ? late : null;
}

/**
 * The order a queue is worked in.
 *
 * Late first, then by when it is wanted, then oldest. Requests with no date
 * sort after those with one -- not because they matter less, but because a
 * date is somebody saying when they need it, and a queue that ignored that
 * would make people put fake dates on everything.
 */
export function queueOrder<T extends QueueItem>(items: T[], now = new Date()): T[] {
  return [...items].sort((a, b) => {
    const lateA = lateBy(a, now), lateB = lateBy(b, now);
    if ((lateA !== null) !== (lateB !== null)) return lateA !== null ? -1 : 1;
    if (lateA !== null && lateB !== null && lateA !== lateB) return lateB - lateA;
    if (a.neededBy !== b.neededBy) {
      if (!a.neededBy) return 1;
      if (!b.neededBy) return -1;
      return a.neededBy < b.neededBy ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/** A line for the top of a queue: what is waiting and what is late. */
export function queueSummary(items: QueueItem[], now = new Date()): string {
  const open = items.filter(i => isOpen(i.state));
  if (open.length === 0) return 'Nothing waiting.';
  const late = open.filter(i => lateBy(i, now) !== null).length;
  const unclaimed = open.filter(i => i.state === 'OPEN').length;
  const bits = [`${open.length} open`];
  if (unclaimed) bits.push(`${unclaimed} nobody has taken on`);
  if (late) bits.push(`${late} past the day it was wanted`);
  return `${bits.join(', ')}.`;
}
