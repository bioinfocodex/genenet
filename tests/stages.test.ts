import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planStages, reorder, moveKind, describeMove, boardOf,
  sittingFor, isStuck, boardSummary, MAX_STAGES, STUCK_MS,
  type Stage, type Placed,
} from '../src/lib/stages.ts';

const stage = (id: string, name: string, position: number): Stage => ({ id, name, position });
const STAGES = [stage('s1', 'Design', 0), stage('s2', 'Clone', 1), stage('s3', 'Verify', 2), stage('s4', 'Express', 3)];

const card = (over: Partial<Placed> = {}): Placed => ({
  kind: 'sequence', targetId: 'g1', label: 'pUC19-x', stageId: 's1', since: null, ...over,
});
const at = (s: string) => new Date(s);

describe('reading a list of stages', () => {
  test('names become an ordered set', () => {
    const plan = planStages(['Design', 'Clone', 'Verify']);
    assert.deepEqual(plan.stages, [
      { name: 'Design', position: 0 }, { name: 'Clone', position: 1 }, { name: 'Verify', position: 2 },
    ]);
    assert.deepEqual(plan.problems, []);
  });

  test('blank lines and padding are not stages', () => {
    const plan = planStages(['  Design  ', '', '   ', 'Clone']);
    assert.deepEqual(plan.stages.map(s => s.name), ['Design', 'Clone']);
  });

  test('two stages with the same name is a problem, not something to merge', () => {
    // Two columns called "verify" are two places to a person moving a card
    // and one place to the database, and that is where cards get lost.
    const plan = planStages(['Clone', 'Verify', 'verify']);
    assert.deepEqual(plan.stages.map(s => s.name), ['Clone', 'Verify']);
    assert.equal(plan.problems.length, 1);
    assert.match(plan.problems[0], /Two stages called/);
  });

  test('more than a board can show is capped, and says which were dropped', () => {
    const many = Array.from({ length: MAX_STAGES + 3 }, (_, i) => `Stage ${i + 1}`);
    const plan = planStages(many);
    assert.equal(plan.stages.length, MAX_STAGES);
    assert.match(plan.problems[0], new RegExp(`More than ${MAX_STAGES}`));
  });

  test('no stages at all is a problem', () => {
    assert.match(planStages([]).problems[0], /at least one stage/);
    assert.match(planStages(['', '  ']).problems[0], /at least one stage/);
  });
});

describe('reordering', () => {
  test('a stage moved along renumbers the rest', () => {
    const out = reorder(STAGES, 's4', 0);
    assert.deepEqual(out.map(s => s.name), ['Express', 'Design', 'Clone', 'Verify']);
    assert.deepEqual(out.map(s => s.position), [0, 1, 2, 3]);
  });

  test('an index past either end lands at that end rather than throwing', () => {
    assert.equal(reorder(STAGES, 's1', 99)[3].id, 's1');
    assert.equal(reorder(STAGES, 's4', -5)[0].id, 's4');
  });

  test('a stage that is not there changes nothing', () => {
    assert.deepEqual(reorder(STAGES, 'nope', 0).map(s => s.id), ['s1', 's2', 's3', 's4']);
  });

  test('it does not alter what it was given', () => {
    const before = STAGES.map(s => s.position);
    reorder(STAGES, 's1', 3);
    assert.deepEqual(STAGES.map(s => s.position), before);
  });
});

describe('what kind of move this is', () => {
  test('one stage along is forward', () => {
    assert.equal(moveKind(STAGES, 's1', 's2'), 'forward');
  });

  test('backwards is named, because it usually means something failed', () => {
    assert.equal(moveKind(STAGES, 's3', 's2'), 'back');
    assert.match(describeMove(STAGES, 's3', 's2'), /moved back from Verify to Clone/);
  });

  test('skipping is named, because it usually means a step was not needed', () => {
    assert.equal(moveKind(STAGES, 's1', 's3'), 'skip');
    assert.match(describeMove(STAGES, 's1', 's3'), /straight to Verify/);
  });

  test('onto the board and off it', () => {
    assert.equal(moveKind(STAGES, null, 's1'), 'onto');
    assert.equal(moveKind(STAGES, 's1', null), 'off');
    assert.match(describeMove(STAGES, 's2', null), /taken off the board from Clone/);
  });

  test('a stage that has been deleted does not break the description', () => {
    assert.equal(moveKind(STAGES, 'gone', 's2'), 'onto');
    assert.match(describeMove(STAGES, null, 'gone'), /nowhere/);
  });
});

describe('the board', () => {
  test('cards land in their columns, in stage order', () => {
    const board = boardOf(
      [stage('s2', 'Clone', 1), stage('s1', 'Design', 0)],
      [card({ targetId: 'a', stageId: 's2' }), card({ targetId: 'b', stageId: 's1' })],
    );
    assert.deepEqual(board.columns.map(c => c.stage.name), ['Design', 'Clone']);
    assert.deepEqual(board.columns[0].cards.map(c => c.targetId), ['b']);
    assert.deepEqual(board.columns[1].cards.map(c => c.targetId), ['a']);
  });

  test('records in the project but in no stage are shown, not hidden', () => {
    // A board that quietly leaves out half a project is worse than no board:
    // it gets read as the whole picture.
    const board = boardOf(STAGES, [card({ targetId: 'x', stageId: null })]);
    assert.deepEqual(board.unplaced.map(c => c.targetId), ['x']);
  });

  test('a card in a stage somebody deleted is reported rather than dropped', () => {
    const board = boardOf(STAGES, [card({ targetId: 'y', stageId: 'deleted' })]);
    assert.deepEqual(board.orphaned.map(c => c.targetId), ['y']);
    assert.equal(board.columns.every(c => c.cards.length === 0), true);
  });

  test('an empty board has a column per stage and no cards', () => {
    const board = boardOf(STAGES, []);
    assert.equal(board.columns.length, 4);
    assert.deepEqual(board.unplaced, []);
  });
});

describe('how long a card has sat', () => {
  test('from when it entered the stage', () => {
    const c = card({ since: '2026-10-01T00:00:00.000Z' });
    assert.equal(sittingFor(c, at('2026-10-03T00:00:00Z')), 2 * 24 * 60 * 60 * 1000);
  });

  test('a card that never recorded when it arrived says nothing', () => {
    assert.equal(sittingFor(card({ since: null })), null);
    assert.equal(isStuck(card({ since: null })), false);
  });

  test('a fortnight is the point at which somebody should look', () => {
    const c = card({ since: '2026-10-01T00:00:00.000Z' });
    assert.equal(isStuck(c, at('2026-10-14T00:00:00Z')), false);
    assert.equal(isStuck(c, new Date(at('2026-10-01T00:00:00Z').getTime() + STUCK_MS)), true);
  });

  test('a clock that disagrees does not give a negative age', () => {
    assert.equal(sittingFor(card({ since: '2026-10-10T00:00:00Z' }), at('2026-10-01T00:00:00Z')), 0);
  });
});

describe('the line at the top of a board', () => {
  const now = at('2026-10-21T12:00:00Z');

  test('an empty board says so', () => {
    assert.equal(boardSummary(boardOf(STAGES, []), now), 'Nothing on the board yet.');
  });

  test('what is on it, what is not placed, and what is stuck', () => {
    const s = boardSummary(boardOf(STAGES, [
      card({ targetId: 'a', stageId: 's1', since: '2026-10-20T00:00:00Z' }),
      card({ targetId: 'b', stageId: 's2', since: '2026-09-01T00:00:00Z' }),
      card({ targetId: 'c', stageId: null }),
      card({ targetId: 'd', stageId: 'gone' }),
    ]), now);
    assert.match(s, /2 on the board/);
    assert.match(s, /1 not placed/);
    assert.match(s, /1 sitting for over a fortnight/);
    assert.match(s, /1 in a stage that no longer exists/);
  });
});
