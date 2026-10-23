/**
 * The steps a project's work goes through, and where each thing has got to.
 *
 * A project here is a list of records: constructs, samples, requests. What it
 * could not say is which of them are designed, which are cloned, and which are
 * waiting to be verified -- so the answer lived on a whiteboard, and the
 * whiteboard was right until somebody rubbed it out.
 *
 * Stages are per project and defined by the lab, not shipped: design → clone →
 * verify → express is one lab's workflow and not another's, and a fixed set
 * would be wrong for everybody in a different way.
 */

export interface Stage {
  id: string;
  name: string;
  /** 0-based, left to right. */
  position: number;
}

/** More than this on one board and nobody can read it, let alone work it. */
export const MAX_STAGES = 12;

export interface StagePlan {
  stages: { name: string; position: number }[];
  problems: string[];
}

/**
 * Read a list of stage names into an ordered set.
 *
 * Duplicates are a problem rather than something to silently merge: two
 * columns called "verify" are two different places to a person moving a card
 * and one place to the database, and that disagreement is where cards get
 * lost.
 */
export function planStages(names: string[]): StagePlan {
  const problems: string[] = [];
  const cleaned = names.map(n => n.trim()).filter(Boolean);

  const seen = new Map<string, string>();
  const stages: { name: string; position: number }[] = [];
  for (const name of cleaned) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      problems.push(`Two stages called "${name}". Each needs its own name, or a card in one is a card in both.`);
      continue;
    }
    seen.set(key, name);
    if (stages.length >= MAX_STAGES) {
      problems.push(`More than ${MAX_STAGES} stages is more than a board can show; "${name}" and anything after it were left out.`);
      break;
    }
    stages.push({ name, position: stages.length });
  }

  if (stages.length === 0) problems.push('A workflow needs at least one stage.');
  return { stages, problems };
}

/** Move a stage to a new place, renumbering the rest. */
export function reorder(stages: Stage[], id: string, toIndex: number): Stage[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const from = ordered.findIndex(s => s.id === id);
  if (from === -1) return ordered;
  const to = Math.max(0, Math.min(ordered.length - 1, toIndex));
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return ordered.map((s, i) => ({ ...s, position: i }));
}

// ─── Where a record has got to ───────────────────────────────────────────────

export interface Placed {
  /** The record. */
  kind: string;
  targetId: string;
  label: string;
  /** Null when it is in the project and not yet on the board. */
  stageId: string | null;
  /** When it entered this stage, ISO. */
  since: string | null;
}

export type MoveKind = 'forward' | 'back' | 'skip' | 'onto' | 'off';

/**
 * What kind of move this is, which is worth naming rather than just doing.
 *
 * A card going backwards and a card skipping two stages are both legal and
 * both worth noticing: the first usually means something failed, the second
 * usually means a step was not needed. A board that recorded only the
 * destination could tell you neither.
 */
export function moveKind(stages: Stage[], from: string | null, to: string | null): MoveKind {
  if (!to) return 'off';
  if (!from) return 'onto';
  const a = stages.find(s => s.id === from)?.position;
  const b = stages.find(s => s.id === to)?.position;
  if (a === undefined || b === undefined) return 'onto';
  if (b < a) return 'back';
  return b - a > 1 ? 'skip' : 'forward';
}

export function describeMove(stages: Stage[], from: string | null, to: string | null): string {
  const name = (id: string | null) => stages.find(s => s.id === id)?.name ?? 'nowhere';
  switch (moveKind(stages, from, to)) {
    case 'off': return `taken off the board from ${name(from)}`;
    case 'onto': return `put into ${name(to)}`;
    case 'back': return `moved back from ${name(from)} to ${name(to)}`;
    case 'skip': return `moved from ${name(from)} straight to ${name(to)}`;
    default: return `moved from ${name(from)} to ${name(to)}`;
  }
}

// ─── The board ───────────────────────────────────────────────────────────────

export interface Column {
  stage: Stage;
  cards: Placed[];
}

export interface Board {
  columns: Column[];
  /**
   * Records in the project that are not in any stage.
   *
   * Shown rather than hidden. A board that quietly leaves out half a project
   * is worse than no board: it is read as the whole picture.
   */
  unplaced: Placed[];
  /** Cards pointing at a stage that no longer exists. */
  orphaned: Placed[];
}

export function boardOf(stages: Stage[], placed: Placed[]): Board {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const byStage = new Map(ordered.map(s => [s.id, [] as Placed[]]));

  const unplaced: Placed[] = [];
  const orphaned: Placed[] = [];

  for (const p of placed) {
    if (!p.stageId) { unplaced.push(p); continue; }
    const column = byStage.get(p.stageId);
    if (!column) { orphaned.push(p); continue; }
    column.push(p);
  }

  return {
    columns: ordered.map(s => ({ stage: s, cards: byStage.get(s.id)! })),
    unplaced,
    orphaned,
  };
}

/**
 * How long a card has sat where it is.
 *
 * The number that makes a board worth having. A column of twelve cards says
 * the project is busy; one card that has been in "verify" for three weeks says
 * something is stuck, and that is the thing a weekly meeting is for.
 */
export function sittingFor(card: Placed, now = new Date()): number | null {
  if (!card.since) return null;
  const since = new Date(card.since).getTime();
  if (Number.isNaN(since)) return null;
  return Math.max(0, now.getTime() - since);
}

/** Long enough that somebody should look. Two weeks, which is a fortnight of standups. */
export const STUCK_MS = 14 * 24 * 60 * 60 * 1000;

export const isStuck = (card: Placed, now = new Date()) => {
  const ms = sittingFor(card, now);
  return ms !== null && ms >= STUCK_MS;
};

/** A line for the top of a board, saying what needs attention. */
export function boardSummary(board: Board, now = new Date()): string {
  const cards = board.columns.flatMap(c => c.cards);
  if (cards.length === 0 && board.unplaced.length === 0) return 'Nothing on the board yet.';

  const stuck = cards.filter(c => isStuck(c, now)).length;
  const bits = [`${cards.length} on the board`];
  if (board.unplaced.length) bits.push(`${board.unplaced.length} not placed`);
  if (stuck) bits.push(`${stuck} sitting for over a fortnight`);
  if (board.orphaned.length) bits.push(`${board.orphaned.length} in a stage that no longer exists`);
  return `${bits.join(', ')}.`;
}
