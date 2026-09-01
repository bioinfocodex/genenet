import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATS, formatOf, rowLabel, rowIndex, wellLabel, parseWell, allWells,
  expandRange, fillOrder, stamp, quadrant, cherryPick, pool, serialDilution,
  isEmpty, roleColours, summarise, type WellLike,
} from '../src/lib/plates.ts';

const P96 = FORMATS[96];
const P384 = FORMATS[384];

test('every format has the row times column count it claims', () => {
  for (const f of Object.values(FORMATS)) {
    assert.equal(f.rows * f.cols, f.wells, f.name);
  }
});

test('an unknown format is refused by name, with the known ones listed', () => {
  assert.throws(() => formatOf(100), /not a plate format/);
  assert.equal(formatOf(96).name, '96-well');
});

test('row labels carry past Z rather than wrapping back to A', () => {
  assert.equal(rowLabel(0), 'A');
  assert.equal(rowLabel(7), 'H');
  assert.equal(rowLabel(15), 'P');
  assert.equal(rowLabel(25), 'Z');
  // A 1536 plate has 32 rows, so this is not hypothetical.
  assert.equal(rowLabel(26), 'AA');
  assert.equal(rowLabel(31), 'AF');
  // Every row of the largest format must have a distinct label.
  const labels = Array.from({ length: FORMATS[1536].rows }, (_, i) => rowLabel(i));
  assert.equal(new Set(labels).size, labels.length);
});

test('row labels round-trip back to indices', () => {
  for (let i = 0; i < 32; i++) assert.equal(rowIndex(rowLabel(i)), i, `row ${i}`);
  assert.throws(() => rowIndex('1'), /not a row/);
});

test('well labels are 1-indexed on the column, as printed on the plate', () => {
  assert.equal(wellLabel(0, 0), 'A1');
  assert.equal(wellLabel(7, 11), 'H12');
  assert.equal(wellLabel(15, 23), 'P24');
  assert.deepEqual(parseWell('A1'), { row: 0, col: 0 });
  assert.deepEqual(parseWell('h12'), { row: 7, col: 11 });
  assert.deepEqual(parseWell('P24'), { row: 15, col: 23 });
  assert.throws(() => parseWell('A0'), /columns start at 1/);
  assert.throws(() => parseWell('hello'), /not a well/);
});

test('every well of a plate is listed once, row-major', () => {
  const wells = allWells(P96);
  assert.equal(wells.length, 96);
  assert.equal(wells[0].label, 'A1');
  assert.equal(wells[11].label, 'A12');
  assert.equal(wells[12].label, 'B1');
  assert.equal(wells[95].label, 'H12');
  assert.equal(new Set(wells.map(w => w.label)).size, 96);
});

test('a range is the rectangle between its corners, not the row-major run', () => {
  // A1:C4 is twelve wells in a block. Reading it as a run would give thirty.
  const block = expandRange('A1:C4', P96);
  assert.equal(block.length, 12);
  assert.ok(block.every(w => w.row <= 2 && w.col <= 3));
});

test('ranges accept the notations people actually type', () => {
  assert.equal(expandRange('A1', P96).length, 1);
  assert.equal(expandRange('A1-A12', P96).length, 12);
  assert.equal(expandRange('A1:H1', P96).length, 8);
  assert.equal(expandRange('A1:A6, C1:C6', P96).length, 12);
  // Corners given the wrong way round still describe the same rectangle.
  assert.equal(expandRange('C4:A1', P96).length, 12);
});

test('a range names the same well twice only once', () => {
  assert.equal(expandRange('A1:A6, A4:A9', P96).length, 9);
});

test('a range running off the plate is refused, naming the first well that does not exist', () => {
  // A13, not A24: the first well past the edge is the one that tells someone
  // where their range stopped being valid.
  assert.throws(() => expandRange('A1:A24', P96), /A13 is outside a 96-well plate/);
  assert.doesNotThrow(() => expandRange('A1:A24', P384));
});

test('fill order down the columns is not the same as across the rows', () => {
  const wells = allWells(P96);
  const byCol = fillOrder(wells, 'column').map(w => wellLabel(w.row, w.col));
  const byRow = fillOrder(wells, 'row').map(w => wellLabel(w.row, w.col));
  assert.deepEqual(byCol.slice(0, 3), ['A1', 'B1', 'C1']);
  assert.deepEqual(byRow.slice(0, 3), ['A1', 'A2', 'A3']);
  assert.notDeepEqual(byCol, byRow, 'getting these confused transposes an experiment');
});

test('a stamp maps every well onto itself', () => {
  const steps = stamp(P96);
  assert.equal(steps.length, 96);
  assert.ok(steps.every(s => s.from.label === s.to.label));
});

test('each 384 quadrant lands on a different well, and together they tile it', () => {
  const seen = new Set<string>();
  for (const q of [0, 1, 2, 3]) {
    const steps = quadrant(q);
    assert.equal(steps.length, 96);
    for (const s of steps) seen.add(s.to.label);
  }
  // Four 96-well plates fill a 384 exactly, with nothing doubled up.
  assert.equal(seen.size, 384);

  // A1 of the source goes to a different corner of each 2x2 group.
  assert.equal(quadrant(0)[0].to.label, 'A1');
  assert.equal(quadrant(1)[0].to.label, 'A2');
  assert.equal(quadrant(2)[0].to.label, 'B1');
  assert.equal(quadrant(3)[0].to.label, 'B2');
});

test('quadrant destinations stay inside the 384', () => {
  for (const q of [0, 1, 2, 3]) {
    for (const s of quadrant(q)) {
      assert.ok(s.to.row < P384.rows && s.to.col < P384.cols, `${s.to.label} from quadrant ${q}`);
    }
  }
  assert.throws(() => quadrant(4), /four quadrants/);
});

test('a cherry-pick fills the destination in the order asked for', () => {
  const sources = expandRange('A1, C5, H12', P96);
  const byCol = cherryPick(sources, P96, 'column');
  assert.deepEqual(byCol.map(s => s.to.label), ['A1', 'B1', 'C1']);
  const byRow = cherryPick(sources, P96, 'row');
  assert.deepEqual(byRow.map(s => s.to.label), ['A1', 'A2', 'A3']);
  // Sources are preserved in the order given.
  assert.deepEqual(byCol.map(s => s.from.label), ['A1', 'C5', 'H12']);
});

test('a cherry-pick can start part way into the destination plate', () => {
  const sources = expandRange('A1, A2', P96);
  const steps = cherryPick(sources, P96, 'column', 2);
  assert.deepEqual(steps.map(s => s.to.label), ['C1', 'D1']);
});

test('a cherry-pick that will not fit says so instead of dropping wells', () => {
  const sources = allWells(P96);
  assert.throws(() => cherryPick(sources, FORMATS[24]), /will not fit/);
  // And the boundary case fits exactly.
  assert.equal(cherryPick(sources, P96).length, 96);
});

test('pooling sends several wells to one', () => {
  const steps = pool(expandRange('A1:A8', P96), parseWell('H12'));
  assert.equal(steps.length, 8);
  assert.ok(steps.every(s => s.to.label === 'H12'));
});

test('a serial dilution reports the cumulative factor, not the per-step one', () => {
  const steps = serialDilution({ row: 0, col: 0 }, 5, 10, 'row', P96);
  assert.deepEqual(steps.map(s => s.well.label), ['A1', 'A2', 'A3', 'A4', 'A5']);
  // This is the number that goes on the axis. Reporting 10 for every well is
  // how a decade of concentration goes missing.
  assert.deepEqual(steps.map(s => s.factor), [1, 10, 100, 1000, 10000]);
  // The first well is the neat starting material: nothing carried into it.
  assert.equal(steps[0].transferUl, 0);
  assert.equal(steps[0].diluentUl, 0);
});

test('the diluent volume gives the fold change it claims', () => {
  const steps = serialDilution({ row: 0, col: 0 }, 3, 5, 'column', P96, 20);
  const s = steps[1];
  // Carrying v into d of diluent dilutes by (v + d) / v.
  assert.equal((s.transferUl + s.diluentUl) / s.transferUl, 5);
});

test('a dilution running off the plate is refused', () => {
  assert.throws(
    () => serialDilution({ row: 0, col: 8 }, 6, 2, 'row', P96),
    /runs off a 96-well plate/,
  );
  assert.throws(() => serialDilution({ row: 0, col: 0 }, 3, 1, 'row', P96), /more than 1-fold/);
  assert.throws(() => serialDilution({ row: 0, col: 0 }, 0, 2, 'row', P96), /at least one step/);
});

test('a dilution down a column moves down, not across', () => {
  const down = serialDilution({ row: 0, col: 0 }, 4, 2, 'column', P96);
  assert.deepEqual(down.map(s => s.well.label), ['A1', 'B1', 'C1', 'D1']);
});

const well = (over: Partial<WellLike> = {}): WellLike =>
  ({ row: 0, col: 0, label: 'A1', ...over });

test('an empty well is one with nothing in it, tracked or not', () => {
  assert.equal(isEmpty(well()), true);
  assert.equal(isEmpty(well({ content: 'LB' })), false);
  assert.equal(isEmpty(well({ sampleId: 'x' })), false);
  assert.equal(isEmpty(well({ entityId: 'x' })), false);
  assert.equal(isEmpty(well({ sequenceId: 'x' })), false);
});

test('role colours are assigned by first appearance, so a layout looks the same twice', () => {
  const wells = [
    well({ row: 1, col: 0, role: 'treated' }),
    well({ row: 0, col: 0, role: 'control' }),
    well({ row: 0, col: 1, role: 'treated' }),
  ];
  const a = roleColours(wells);
  const b = roleColours([...wells].reverse());
  assert.deepEqual(a, b, 'the order the wells arrive in must not change the colours');
  assert.notEqual(a.control, a.treated, 'two roles must never share a shade');
});

test('a plate summary counts what is filled, by role, and what is untracked', () => {
  const wells = [
    well({ row: 0, col: 0, role: 'control', sampleId: 's1' }),
    well({ row: 0, col: 1, role: 'treated', sampleId: 's2' }),
    well({ row: 0, col: 2, role: 'treated', content: 'LB only' }),
    well({ row: 0, col: 3 }),
  ];
  const s = summarise(wells, P96);
  assert.equal(s.total, 96);
  assert.equal(s.filled, 3);
  assert.equal(s.empty, 93);
  assert.deepEqual(s.roles, [{ role: 'treated', count: 2 }, { role: 'control', count: 1 }]);
  assert.equal(s.untracked, 1, 'the LB-only well holds something the system does not track');
});
