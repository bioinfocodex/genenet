import 'server-only';
import { prisma } from './prisma';
import {
  commit, stillHere, slidePresence, PRESENCE_TIMEOUT_MS,
  type Change, type Committed, type Op, type Presence,
} from './ot';

/**
 * One entry being edited by more than one person, held in memory.
 *
 * The server is the sequencer: it is the only thing that decides what order
 * changes happened in, which is what lets every client converge. That makes
 * this module the single copy of the truth while an entry is open, and the
 * database the place it lands.
 *
 * In memory rather than in the database because the sequencing has to be
 * synchronous. A version number read, incremented and written across an await
 * is a version number two requests can both get, and two clients given the
 * same version is exactly the divergence the transform exists to prevent.
 * This application is one Node process, so a module-level map is genuinely
 * the single copy; the day it is not, this is the file that has to change,
 * and the comment is here so that is not a surprise.
 */

interface Session {
  entryId: string;
  text: string;
  version: number;
  /** Recent committed changes, for rebasing clients that are behind. */
  history: Committed[];
  people: Presence[];
  listeners: Set<(event: ServerEvent) => void>;
  /** Pending save, so a burst of keystrokes is one write. */
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** True once the text differs from what is stored. */
  dirty: boolean;
}

export type ServerEvent =
  | { kind: 'init'; text: string; version: number; people: Presence[] }
  | { kind: 'ops'; version: number; ops: Op[]; author: string }
  | { kind: 'people'; people: Presence[] }
  | { kind: 'closed'; why: string };

const sessions = new Map<string, Session>();

/**
 * How much history to keep.
 *
 * Enough that a client on a slow connection can still be rebased, bounded so
 * a long editing session does not grow without limit. A client that falls
 * further behind than this is told to take the document again, which is
 * correct rather than merely cheap: its positions are no longer meaningful.
 */
const HISTORY = 200;

/** Keystrokes are frequent; writes need not be. */
const SAVE_AFTER_MS = 1_000;

export async function open(entryId: string): Promise<Session | { error: string }> {
  const existing = sessions.get(entryId);
  if (existing) return existing;

  const entry = await prisma.notebookEntry.findUnique({
    where: { id: entryId },
    select: { id: true, body: true, status: true },
  });
  if (!entry) return { error: 'That entry no longer exists.' };
  /*
   * Only drafts. A signed entry is immutable by design -- a correction is a
   * new entry that supersedes it -- so there is nothing here to co-edit, and
   * offering it would be offering to break a signature.
   */
  if (entry.status !== 'DRAFT') return { error: 'This entry is signed, so it cannot be edited.' };

  const session: Session = {
    entryId,
    text: entry.body,
    version: 0,
    history: [],
    people: [],
    listeners: new Set(),
    saveTimer: null,
    dirty: false,
  };
  sessions.set(entryId, session);
  return session;
}

export function sessionFor(entryId: string): Session | null {
  return sessions.get(entryId) ?? null;
}

function broadcast(session: Session, event: ServerEvent) {
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      /* A listener whose connection has gone is removed when its stream closes. */
    }
  }
}

/**
 * Take a change from one client and tell everybody.
 *
 * Synchronous through the sequencing, which is the point: no await between
 * reading the version and writing the next one.
 */
export function submit(session: Session, change: Change): { version: number; tooOld?: true } {
  const result = commit(session.text, session.version, session.history, change);
  if (result.tooOld) return { version: session.version, tooOld: true };

  session.text = result.text;
  session.version = result.version;
  session.history.push({ version: result.version, ops: result.applied, author: change.author });
  if (session.history.length > HISTORY) session.history.splice(0, session.history.length - HISTORY);

  // Everybody's caret moves with the text, so a cursor drawn for a colleague
  // stays where they left it rather than where it happened to be indexed.
  for (const op of result.applied) session.people = slidePresence(session.people, op);

  broadcast(session, { kind: 'ops', version: result.version, ops: result.applied, author: change.author });
  if (result.applied.length > 0) scheduleSave(session);
  return { version: result.version };
}

function scheduleSave(session: Session) {
  session.dirty = true;
  if (session.saveTimer) return;
  session.saveTimer = setTimeout(() => {
    session.saveTimer = null;
    void save(session);
  }, SAVE_AFTER_MS);
  session.saveTimer.unref?.();
}

async function save(session: Session) {
  if (!session.dirty) return;
  const text = session.text;
  try {
    await prisma.notebookEntry.update({
      where: { id: session.entryId },
      /*
       * Guarded on the entry still being a draft. Somebody signing while
       * another tab has it open would otherwise have their signature
       * invalidated a second later by a write they did not make.
       */
      data: { body: text },
    });
    if (session.text === text) session.dirty = false;
  } catch {
    // A failed write leaves the session dirty, so the next keystroke retries.
  }
}

/** Write anything outstanding now, for a page that is closing. */
export async function flush(entryId: string): Promise<void> {
  const session = sessions.get(entryId);
  if (!session) return;
  if (session.saveTimer) { clearTimeout(session.saveTimer); session.saveTimer = null; }
  await save(session);
}

export function join(
  session: Session,
  person: { id: string; userId: string; name: string },
  listener: (event: ServerEvent) => void,
): () => void {
  session.listeners.add(listener);
  touch(session, person);

  listener({
    kind: 'init',
    text: session.text,
    version: session.version,
    people: stillHere(session.people),
  });
  broadcast(session, { kind: 'people', people: stillHere(session.people) });

  return () => {
    session.listeners.delete(listener);
    session.people = session.people.filter(p => p.id !== person.id);
    broadcast(session, { kind: 'people', people: stillHere(session.people) });
    /*
     * The last person out writes and closes. Keeping an empty session alive
     * would hold an entry's text in memory indefinitely and, worse, keep
     * serving it to the next person to open the page even if the row changed
     * underneath.
     */
    if (session.listeners.size === 0) {
      void flush(session.entryId).finally(() => {
        const current = sessions.get(session.entryId);
        if (current && current.listeners.size === 0) sessions.delete(session.entryId);
      });
    }
  };
}

/** Record that somebody is still here, and where their cursor is. */
export function touch(session: Session, person: { id: string; userId: string; name: string; at?: number }) {
  const now = Date.now();
  const existing = session.people.find(p => p.id === person.id);
  if (existing) {
    existing.seen = now;
    existing.name = person.name;
    if (person.at !== undefined) existing.at = person.at;
  } else {
    session.people.push({
      id: person.id, userId: person.userId, name: person.name, seen: now,
      ...(person.at === undefined ? {} : { at: person.at }),
    });
  }
  session.people = session.people.filter(p => now - p.seen < PRESENCE_TIMEOUT_MS || p.id === person.id);
}

export function announcePeople(session: Session) {
  broadcast(session, { kind: 'people', people: stillHere(session.people) });
}
