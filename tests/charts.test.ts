import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  niceScale, formatTick, toSeries, averageReplicates,
  fitDose, doseAt, plateShape, heatmapOf, heatFraction,
  type Point,
} from '../src/lib/charts.ts';

const p = (series: string, x: number, y: number): Point => ({ series, x, y });

describe('an axis a person can read', () => {
  test('it starts and ends on round numbers, not on the data', () => {
    // Fitting exactly to the data puts the first tick at 0.0813 and the last
    // at 1.2047, which nobody reads.
    const s = niceScale([0.0813, 1.2047]);
    assert.equal(s.min, 0);
    assert.ok(s.max >= 1.2047);
    assert.ok(s.ticks.every(t => Number.isFinite(t)));
  });

  test('ticks are evenly spaced and do not drift', () => {
    // Adding a step repeatedly drifts: ten additions of 0.1 do not make 1.
    const s = niceScale([0, 1]);
    const gaps = s.ticks.slice(1).map((t, i) => t - s.ticks[i]);
    for (const g of gaps) assert.ok(Math.abs(g - gaps[0]) < 1e-9, `gap ${g} vs ${gaps[0]}`);
    assert.ok(s.ticks.includes(1), 'and 1 is exactly 1');
  });

  test('steps are 1, 2 or 5 times a power of ten', () => {
    for (const data of [[0, 3], [0, 7], [0, 240], [0, 0.004]]) {
      const s = niceScale(data);
      const step = s.ticks[1] - s.ticks[0];
      const scaled = step / Math.pow(10, Math.floor(Math.log10(step)));
      assert.ok([1, 2, 5, 10].some(n => Math.abs(scaled - n) < 1e-9), `step ${step}`);
    }
  });

  test('every value the same still has an axis to draw in', () => {
    // A plate of blanks, or one timepoint. An axis from n to n has no height.
    const s = niceScale([0.5, 0.5, 0.5]);
    assert.ok(s.max > s.min);
    assert.ok(s.min < 0.5 && s.max > 0.5, 'and the flat line sits inside it');
  });

  test('all zeros does not divide by nothing', () => {
    const s = niceScale([0, 0]);
    assert.ok(s.max > s.min);
  });

  test('nothing to scale is a unit axis rather than a crash', () => {
    assert.deepEqual(niceScale([]), { min: 0, max: 1, ticks: [0, 0.5, 1] });
    assert.ok(niceScale([NaN, Infinity]).max > 0);
  });

  test('tick labels carry enough places to tell ticks apart', () => {
    assert.equal(formatTick(1, 1), '1');
    assert.equal(formatTick(0.25, 0.25), '0.25');
    assert.equal(formatTick(1.5, 0.5), '1.5');
  });
});

describe('grouping points into series', () => {
  test('one list per series, each sorted along x', () => {
    const s = toSeries([p('b', 2, 1), p('a', 3, 1), p('a', 1, 1), p('b', 1, 1)]);
    assert.deepEqual(s.map(x => x.name), ['b', 'a'], 'in the order first seen');
    assert.deepEqual(s[1].points.map(x => x.x), [1, 3]);
  });

  test('a point with no number in it is not a point', () => {
    const s = toSeries([p('a', 1, 1), p('a', NaN, 2), p('a', 2, Infinity)]);
    assert.equal(s[0].points.length, 1);
  });

  test('nothing in is nothing out', () => {
    assert.deepEqual(toSeries([]), []);
  });
});

describe('replicates', () => {
  test('three wells at one concentration become one point with a spread', () => {
    // Drawing all three separately makes a cloud rather than a curve.
    const out = averageReplicates([p('a', 1, 10), p('a', 1, 12), p('a', 1, 14)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].mean, 12);
    assert.equal(out[0].n, 3);
    assert.equal(out[0].sd, 2, 'sample standard deviation, n-1');
  });

  test('one replicate has no spread, which is honest', () => {
    // One measurement says nothing about variability.
    const out = averageReplicates([p('a', 1, 10)]);
    assert.equal(out[0].sd, 0);
    assert.equal(out[0].n, 1);
  });

  test('points come back in order of x', () => {
    const out = averageReplicates([p('a', 3, 1), p('a', 1, 1), p('a', 2, 1)]);
    assert.deepEqual(out.map(o => o.x), [1, 2, 3]);
  });
});

describe('fitting a dose response', () => {
  /** A clean curve: bottom 0, top 100, midpoint at log10(conc) = -6, hill 1. */
  const ideal = [-9, -8, -7, -6.5, -6, -5.5, -5, -4].map(x => ({
    x, y: 0 + (100 - 0) / (1 + Math.pow(10, (-6 - x) * 1)),
  }));

  test('a clean curve is recovered', () => {
    const fit = fitDose(ideal)!;
    assert.ok(Math.abs(fit.ec50 - (-6)) < 0.3, `ec50 ${fit.ec50}`);
    assert.ok(fit.r2 > 0.98, `r2 ${fit.r2}`);
    assert.ok(Math.abs(fit.top - 100) < 15 && Math.abs(fit.bottom - 0) < 15);
  });

  test('the fitted curve passes near the points it was fitted to', () => {
    const fit = fitDose(ideal)!;
    for (const point of ideal) {
      assert.ok(Math.abs(doseAt(point.x, fit) - point.y) < 12, `at ${point.x}`);
    }
  });

  test('too few points is no fit rather than a confident one', () => {
    assert.equal(fitDose([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null);
    assert.equal(fitDose([]), null);
  });

  test('a clean curve has nothing to warn about', () => {
    assert.equal(fitDose(ideal)!.warning, undefined);
  });

  test('a curve that never levelled off says the plateau was not measured', () => {
    /*
     * This is the warning that matters, and a failed test is how it was
     * found. Fitting the toe of a sigmoid does not give a midpoint outside
     * the tested range, as expected: the fit rescales the top downwards and
     * matches the toe beautifully, r-squared 0.99, midpoint sitting
     * confidently inside the data. The arithmetic is right and the answer is
     * meaningless, because the plateau it is half of was never measured. So
     * flatness at the ends is judged from the data rather than from the fit.
     */
    const toe = [-9, -8.5, -8, -7.5, -7].map(x => ({
      x, y: 100 / (1 + Math.pow(10, (-3 - x) * 1)),
    }));
    const fit = fitDose(toe)!;
    assert.ok(fit.r2 > 0.95, 'it fits well, which is the problem');
    assert.ok(fit.warning, 'and it still says the curve did not level off');
    assert.match(fit.warning!, /top of the curve was never reached/);
  });

  test('a straight line is called a slope rather than a dose response', () => {
    const line = [1, 2, 3, 4, 5, 6].map(x => ({ x, y: x * 10 }));
    const fit = fitDose(line)!;
    assert.match(fit.warning!, /slope rather than a dose response|extrapolated/);
  });

  test('noise that is not a curve fits badly and says so', () => {
    const noise = [1, 2, 3, 4, 5, 6].map((x, i) => ({ x, y: [5, 1, 4, 2, 6, 3][i] }));
    const fit = fitDose(noise)!;
    assert.ok(fit.r2 < 0.8 || fit.warning, `r2 ${fit.r2}`);
  });

  test('a descending curve fits too, since inhibition goes the other way', () => {
    const down = [-9, -8, -7, -6, -5, -4].map(x => ({
      x, y: 100 / (1 + Math.pow(10, (x - (-6)) * 1)),
    }));
    const fit = fitDose(down)!;
    assert.ok(fit.r2 > 0.95, `r2 ${fit.r2}`);
    assert.ok(Math.abs(fit.ec50 - (-6)) < 0.5, `ec50 ${fit.ec50}`);
  });
});

describe('a plate as a heatmap', () => {
  test('the usual plate formats have the usual shapes', () => {
    assert.deepEqual(plateShape(96), { rows: 8, columns: 12 });
    assert.deepEqual(plateShape(384), { rows: 16, columns: 24 });
    assert.deepEqual(plateShape(6), { rows: 2, columns: 3 });
  });

  test('an unknown format falls back to 96 rather than to nothing', () => {
    assert.deepEqual(plateShape(99), { rows: 8, columns: 12 });
  });

  test('wells land in their own cells', () => {
    const h = heatmapOf(new Map([['A1', 0.1], ['B3', 0.9], ['H12', 0.5]]), 96);
    assert.equal(h.cells[0][0], 0.1);
    assert.equal(h.cells[1][2], 0.9);
    assert.equal(h.cells[7][11], 0.5);
    assert.equal(h.min, 0.1);
    assert.equal(h.max, 0.9);
  });

  test('a well outside the plate is dropped rather than wrapping round', () => {
    // A 384-plate's export opened against a 96-well plate would otherwise
    // fold P24's value onto some innocent well.
    const h = heatmapOf(new Map([['A1', 1], ['P24', 2]]), 96);
    assert.equal(h.cells[0][0], 1);
    assert.equal(h.max, 1, 'P24 is not on a 96-well plate');
  });

  test('a well that was read but has no number stays empty, not zero', () => {
    const h = heatmapOf(new Map([['A1', null], ['A2', 5]]), 96);
    assert.equal(h.cells[0][0], null);
    assert.equal(h.min, 5, 'and it does not drag the range to zero');
  });

  test('a flat plate looks flat rather than looking like an error', () => {
    const h = heatmapOf(new Map([['A1', 2], ['A2', 2]]), 96);
    assert.equal(heatFraction(2, h), 0.5);
  });

  test('values map onto nought to one, and are clamped there', () => {
    const h = { min: 0, max: 10 };
    assert.equal(heatFraction(0, h), 0);
    assert.equal(heatFraction(5, h), 0.5);
    assert.equal(heatFraction(10, h), 1);
    assert.equal(heatFraction(-5, h), 0);
    assert.equal(heatFraction(50, h), 1);
  });

  test('an empty plate has a range to draw against', () => {
    const h = heatmapOf(new Map(), 96);
    assert.ok(h.max > h.min);
    assert.equal(h.cells.length, 8);
  });
});
