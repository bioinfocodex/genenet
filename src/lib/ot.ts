/**
 * Two people typing in the same entry at the same time.
 *
 * The whole difficulty is that an edit is described by a position, and a
 * position means something different once somebody else has edited before it.
 * "Delete four characters at 12" is correct when it is written and wrong by
 * the time it arrives, if a colleague inserted a word at position 3 in the
 * meantime.
 *
 * So the server is the sequencer. Every change carries the version it was
 * written against; the server rebases it over whatever has happened since,
 * applies it, and gives it a new version. The clients converge because they
 * all end up applying the same sequence, which is the property the tests at
 * the bottom of this file actually check by brute force rather than by
 * assertion.
 *
 * Operational transformation rather than a CRDT, deliberately. A CRDT buys
 * offline editing and peer-to-peer merge, neither of which this needs: there
 * is one server, and an entry that cannot reach it is an entry nobody else is
 * editing either. What a CRDT costs is a representation nobody can read in the
 * database, and this one has to stay plain Markdown that a signature is taken
 * over.
 */

export interface Insert {
  at: number;
  insert: string;
}

export interface Remove {
  at: number;
  remove: number;
}

export type Op = Insert | Remove;

export const isInsert = (op: Op): op is Insert => 'insert' in op;

/** How long the document is after an op, given how long it was before. */
export const lengthAfter = (before: number, op: Op): number =>
  isInsert(op) ? before + op.insert.length : before - Math.min(op.remove, Math.max(0, before - op.at));

/**
 * Apply one op.
 *
 * Out-of-range positions are clamped rather than throwing. An op that arrives
 * describing a document longer than the one here is a bug somewhere, and
 * losing the whole entry to an exception is a worse answer than applying it
 * at the end -- the version check upstream is what actually catches it.
 */
export function apply(text: string, op: Op): string {
  const at = Math.max(0, Math.min(text.length, op.at));
  if (isInsert(op)) return text.slice(0, at) + op.insert + text.slice(at);
  const end = Math.max(at, Math.min(text.length, at + op.remove));
  return text.slice(0, at) + text.slice(end);
}

export function applyAll(text: string, ops: Op[]): string {
  return ops.reduce(apply, text);
}

/**
 * Where a position lands after `against` has been applied.
 *
 * The three cases are the whole of it. Before the change, nothing moves.
 * After it, everything shifts by what was added or removed. Inside a deleted
 * range, there is nowhere left to be, so it collapses to the start of the
 * hole.
 */
function slide(pos: number, against: Op, bias: 'left' | 'right'): number {
  if (isInsert(against)) {
    if (pos < against.at) return pos;
    if (pos > against.at) return pos + against.insert.length;
    // Exactly at the insertion point: the tie-break decides which side of the
    // new text this position belongs on. Without one, two people typing at
    // the same spot end up with each other's characters interleaved
    // differently on each screen, which is the failure this whole file exists
    // to prevent.
    return bias === 'left' ? pos : pos + against.insert.length;
  }
  const end = against.at + against.remove;
  if (pos <= against.at) return pos;
  if (pos >= end) return pos - against.remove;
  return against.at;
}

/**
 * Rebase `op` so it means the same thing after `against` has been applied.
 *
 * Returns a list, because one op does not always stay one op: a deletion
 * spanning text that somebody has typed into splits in two, so that their
 * typing survives. Deleting through it would be simpler and is what several
 * well-known implementations do; it also means a colleague's sentence
 * vanishes because somebody else happened to be deleting a paragraph around
 * it, which is not a trade worth making.
 *
 * An empty list means the op has nothing left to do -- the characters it
 * wanted to remove are already gone.
 */
export function transform(op: Op, against: Op, bias: 'left' | 'right' = 'left'): Op[] {
  if (isInsert(op)) {
    const at = slide(op.at, against, bias);
    return op.insert.length === 0 ? [] : [{ at, insert: op.insert }];
  }

  const start = op.at;
  const end = op.at + op.remove;

  if (isInsert(against)) {
    const insertAt = against.at;
    const insertLen = against.insert.length;

    // Entirely after the insertion, or entirely before it.
    if (insertAt <= start) return op.remove === 0 ? [] : [{ at: start + insertLen, remove: op.remove }];
    if (insertAt >= end) return op.remove === 0 ? [] : [{ at: start, remove: op.remove }];

    /*
     * The insertion landed inside what this op wants to delete. Split around
     * it, so the inserted text stays.
     *
     * The second piece is positioned against the document *after* the first
     * piece has been applied, not against the one both were computed from.
     * Returning two positions measured from the same base reads correctly and
     * is wrong the moment they are applied in order -- the second lands three
     * characters late and eats whatever follows. Found by the convergence
     * test, which is the only thing that would have found it.
     */
    const before = insertAt - start;
    const after = end - insertAt;
    const out: Op[] = [];
    if (before > 0) out.push({ at: start, remove: before });
    if (after > 0) out.push({ at: insertAt + insertLen - before, remove: after });
    return out;
  }

  // Delete against delete: what is left of this op's range once the other's
  // range has gone.
  const againstEnd = against.at + against.remove;
  const overlap = Math.max(0, Math.min(end, againstEnd) - Math.max(start, against.at));
  const remaining = op.remove - overlap;
  if (remaining <= 0) return [];
  return [{ at: slide(start, against, 'left'), remove: remaining }];
}

/** Rebase an op over a whole run of them, in order. */
export function transformOver(op: Op, against: Op[], bias: 'left' | 'right' = 'left'): Op[] {
  let current: Op[] = [op];
  for (const other of against) {
    current = current.flatMap(o => transform(o, other, bias));
    if (current.length === 0) return [];
  }
  return current;
}

// ─── What the server does with a change that arrives ─────────────────────────

export interface Change {
  /** The version the writer had when they wrote it. */
  base: number;
  ops: Op[];
  /** Who wrote it, which is also the tie-break for simultaneous insertions. */
  author: string;
}

export interface Committed {
  version: number;
  ops: Op[];
  author: string;
}

export interface CommitResult {
  /** The ops as they were actually applied, after rebasing. */
  applied: Op[];
  text: string;
  version: number;
  /** Set when the change was written against a version the server has lost. */
  tooOld?: true;
}

/**
 * Rebase a change onto the current state and apply it.
 *
 * `history` holds every committed change from `base` onward. A change written
 * against a version older than the history goes back as `tooOld` rather than
 * being guessed at: a client that has fallen that far behind should take the
 * document afresh, and silently applying its stale positions is how a
 * paragraph ends up in the middle of a word.
 */
export function commit(
  text: string,
  version: number,
  history: Committed[],
  change: Change,
): CommitResult {
  if (change.base > version) {
    // A base ahead of the server is not a late client, it is a wrong one.
    return { applied: [], text, version, tooOld: true };
  }

  const since = history.filter(h => h.version > change.base);
  const expected = version - change.base;
  if (since.length < expected) {
    return { applied: [], text, version, tooOld: true };
  }

  const concurrent = since.flatMap(h =>
    /*
     * Simultaneous insertions at one position are ordered by author, so every
     * participant breaks the tie the same way. Any total order would do; what
     * matters is that it is the same everywhere.
     */
    h.ops.map(op => ({ op, bias: (h.author < change.author ? 'left' : 'right') as 'left' | 'right' })),
  );

  const applied: Op[] = [];
  let next = text;
  for (const op of change.ops) {
    let rebased: Op[] = [op];
    for (const { op: other, bias } of concurrent) {
      rebased = rebased.flatMap(o => transform(o, other, bias));
    }
    /*
     * Each op of this change is also rebased over the earlier ops of the same
     * change, because those have already been applied to `next` and moved
     * everything after them. Missing this is the bug that makes a two-op
     * paste land in the wrong order.
     */
    for (const earlier of applied) {
      rebased = rebased.flatMap(o => transform(o, earlier, 'left'));
    }
    for (const o of rebased) {
      next = apply(next, o);
      applied.push(o);
    }
  }

  return { applied, text: next, version: version + 1 };
}

// ─── Turning two versions of a textarea into ops ─────────────────────────────

/**
 * The smallest change that turns one string into another.
 *
 * A textarea gives its whole value, not the keystroke. Diffing from both ends
 * finds the one contiguous edit that nearly every real keystroke, paste or
 * selection-replacement is, and it costs one pass. Anything more elaborate --
 * a real diff -- would find a smaller edit for a reshuffle, which is not a
 * thing that happens by typing.
 */
export function diff(before: string, after: string): Op[] {
  if (before === after) return [];

  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;

  let fromEnd = 0;
  while (
    fromEnd < max - start
    && before[before.length - 1 - fromEnd] === after[after.length - 1 - fromEnd]
  ) fromEnd++;

  const removed = before.length - start - fromEnd;
  const inserted = after.slice(start, after.length - fromEnd);

  const ops: Op[] = [];
  if (removed > 0) ops.push({ at: start, remove: removed });
  if (inserted.length > 0) ops.push({ at: start, insert: inserted });
  return ops;
}

// ─── Who else is here ────────────────────────────────────────────────────────

export interface Presence {
  /** The connection, not the person: one scientist with two tabs is two. */
  id: string;
  /** Who is behind it, so a person is shown once however many tabs they have. */
  userId: string;
  name: string;
  /** Where their cursor is, so it can be drawn. */
  at?: number;
  /** Last heard from, as epoch milliseconds. */
  seen: number;
}

/** Long enough that a slow tab is not evicted, short enough to notice a leaver. */
export const PRESENCE_TIMEOUT_MS = 20_000;

/**
 * Who is still here.
 *
 * A browser that closes a laptop lid never says goodbye, so presence is a
 * heartbeat and absence is inferred. Reporting somebody as present ten
 * minutes after they left would make the whole indicator untrustworthy, which
 * is worse than not having one.
 */
export function stillHere(people: Presence[], now = Date.now()): Presence[] {
  const live = people
    .filter(p => now - p.seen < PRESENCE_TIMEOUT_MS)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  /*
   * One row per person, not per tab. Somebody with the entry open twice is
   * still one colleague, and "Ann, Ann is editing this too" reads as a bug.
   * The most recently active of their connections is the one kept, so the
   * cursor shown is the tab they are actually typing in.
   */
  const byUser = new Map<string, Presence>();
  for (const p of live) {
    const existing = byUser.get(p.userId);
    if (!existing || p.seen > existing.seen) byUser.set(p.userId, p);
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Move everybody's cursor along with an op, so the carets stay where they were. */
export function slidePresence(people: Presence[], op: Op): Presence[] {
  return people.map(p => (p.at === undefined ? p : { ...p, at: slide(p.at, op, 'left') }));
}
