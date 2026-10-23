'use client';
import { useMemo } from 'react';
import {
  niceScale, formatTick, toSeries, averageReplicates, fitDose, doseAt,
  heatmapOf, heatFraction, plateShape,
  type Point, type ChartKind,
} from '@/lib/charts';

/**
 * Drawing a result set.
 *
 * SVG rather than a charting library: these are four chart types over at most
 * a few thousand points, and a dependency that renders them would be larger
 * than the application's own analysis code and would still need wrapping to
 * say the things that matter here -- that a curve never plateaued, that a
 * plate has wells with no reading.
 */

const W = 720;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 40, left: 54 };

/* Distinguishable at a glance, and legible on white. */
const COLOURS = ['#2563eb', '#dc2626', '#15803d', '#a3560a', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f'];

export default function Chart({ kind, points, xLabel, yLabel, format = 96, blank = 0 }: {
  kind: ChartKind;
  points: Point[];
  xLabel: string;
  yLabel: string;
  /** For a heatmap. */
  format?: number;
  blank?: number;
}) {
  if (points.length === 0) {
    return (
      <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
        Nothing recorded for this chart yet
        {blank > 0 && ` — ${blank} reading${blank === 1 ? '' : 's'} had no number in the fields it draws`}.
      </p>
    );
  }

  return (
    <div>
      {kind === 'heatmap'
        ? <Heatmap points={points} format={format} yLabel={yLabel} />
        : <XY kind={kind} points={points} xLabel={xLabel} yLabel={yLabel} />}
      {blank > 0 && (
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
          {blank} reading{blank === 1 ? '' : 's'} left out: no number in the fields this chart draws.
        </p>
      )}
    </div>
  );
}

function XY({ kind, points, xLabel, yLabel }: {
  kind: ChartKind; points: Point[]; xLabel: string; yLabel: string;
}) {
  const series = useMemo(() => toSeries(points), [points]);
  const xScale = useMemo(() => niceScale(points.map(p => p.x)), [points]);
  const yScale = useMemo(() => niceScale(points.map(p => p.y)), [points]);

  const px = (x: number) => PAD.left + ((x - xScale.min) / (xScale.max - xScale.min)) * (W - PAD.left - PAD.right);
  const py = (y: number) => H - PAD.bottom - ((y - yScale.min) / (yScale.max - yScale.min)) * (H - PAD.top - PAD.bottom);

  const xStep = xScale.ticks[1] - xScale.ticks[0];
  const yStep = yScale.ticks[1] - yScale.ticks[0];

  /** A time axis is drawn as dates; anything else as the number it is. */
  const isTime = xLabel.toLowerCase().includes('time') || xLabel.toLowerCase().includes('date');
  const xText = (t: number) => (isTime ? new Date(t).toLocaleDateString() : formatTick(t, xStep));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yScale.ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} y1={py(t)} x2={W - PAD.right} y2={py(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.left - 6} y={py(t) + 3} textAnchor="end" fontSize={10} fill="#64748b">{formatTick(t, yStep)}</text>
          </g>
        ))}
        {xScale.ticks.map(t => (
          <text key={t} x={px(t)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="#64748b">
            {xText(t)}
          </text>
        ))}

        <text x={PAD.left + (W - PAD.left - PAD.right) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#475569">{xLabel}</text>
        <text x={12} y={PAD.top + (H - PAD.top - PAD.bottom) / 2} textAnchor="middle" fontSize={11} fill="#475569"
              transform={`rotate(-90 12 ${PAD.top + (H - PAD.top - PAD.bottom) / 2})`}>{yLabel}</text>

        {series.map((s, i) => (
          <SeriesMarks key={s.name} name={s.name} points={s.points} colour={COLOURS[i % COLOURS.length]}
                       kind={kind} px={px} py={py} />
        ))}
      </svg>

      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.78rem', marginTop: '0.2rem' }}>
        {series.map((s, i) => (
          <span key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOURS[i % COLOURS.length] }} />
            {s.name}
            {kind === 'dose' && <DoseNote points={s.points} />}
          </span>
        ))}
      </div>
    </div>
  );
}

function SeriesMarks({ name, points, colour, kind, px, py }: {
  name: string; points: Point[]; colour: string; kind: ChartKind;
  px: (n: number) => number; py: (n: number) => number;
}) {
  if (kind === 'scatter') {
    return (
      <g>
        {points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r={3} fill={colour} fillOpacity={0.75} />)}
      </g>
    );
  }

  /*
   * Replicates are averaged for a line or a curve, and their spread drawn as
   * a bar. Drawing all three wells of each concentration separately makes a
   * cloud rather than a curve, and a mean with no spread is a claim nobody
   * can judge.
   */
  const averaged = averageReplicates(points);
  const fit = kind === 'dose' ? fitDose(averaged.map(a => ({ x: a.x, y: a.mean }))) : null;

  const path = averaged.map((a, i) => `${i === 0 ? 'M' : 'L'}${px(a.x).toFixed(1)},${py(a.mean).toFixed(1)}`).join(' ');

  let curve = '';
  if (fit && averaged.length > 1) {
    const from = averaged[0].x, to = averaged[averaged.length - 1].x;
    const steps = 60;
    curve = Array.from({ length: steps + 1 }, (_, i) => {
      const x = from + ((to - from) * i) / steps;
      return `${i === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(doseAt(x, fit)).toFixed(1)}`;
    }).join(' ');
  }

  return (
    <g>
      {curve
        ? <path d={curve} fill="none" stroke={colour} strokeWidth={1.8} />
        : <path d={path} fill="none" stroke={colour} strokeWidth={1.6} />}
      {averaged.map((a, i) => (
        <g key={i}>
          {a.sd > 0 && (
            <line x1={px(a.x)} y1={py(a.mean - a.sd)} x2={px(a.x)} y2={py(a.mean + a.sd)}
                  stroke={colour} strokeWidth={1} opacity={0.7} />
          )}
          <circle cx={px(a.x)} cy={py(a.mean)} r={3} fill={colour}>
            <title>{`${name}: ${a.mean}${a.n > 1 ? ` ± ${a.sd} (n=${a.n})` : ''}`}</title>
          </circle>
        </g>
      ))}
    </g>
  );
}

/** The midpoint, and what is wrong with it where something is. */
function DoseNote({ points }: { points: Point[] }) {
  const fit = useMemo(() => {
    const averaged = averageReplicates(points);
    return fitDose(averaged.map(a => ({ x: a.x, y: a.mean })));
  }, [points]);

  if (!fit) return <span style={{ color: 'var(--text-muted)' }}> — too few points to fit</span>;

  return (
    <span style={{ color: 'var(--text-muted)' }}>
      {' '}— midpoint {fit.ec50}, r² {fit.r2.toFixed(3)}
      {fit.warning && (
        <span style={{ color: '#a3560a' }} title={fit.warning}> ⚠</span>
      )}
    </span>
  );
}

function Heatmap({ points, format, yLabel }: { points: Point[]; format: number; yLabel: string }) {
  const { heat, shape } = useMemo(() => {
    const values = new Map<string, number | null>();
    for (const p of points) if (p.well) values.set(p.well, p.y);
    return { heat: heatmapOf(values, format), shape: plateShape(format) };
  }, [points, format]);

  const cell = Math.min(34, Math.floor(620 / shape.columns));
  const width = cell * shape.columns + 28;
  const height = cell * shape.rows + 24;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, height: 'auto', display: 'block' }}>
        {Array.from({ length: shape.columns }, (_, c) => (
          <text key={c} x={28 + c * cell + cell / 2} y={10} textAnchor="middle" fontSize={9} fill="#64748b">{c + 1}</text>
        ))}
        {heat.cells.map((row, r) => (
          <g key={r}>
            <text x={20} y={24 + r * cell + cell / 2} textAnchor="end" fontSize={9} fill="#64748b">
              {String.fromCharCode(65 + r)}
            </text>
            {row.map((v, c) => (
              <rect key={c} x={28 + c * cell} y={16 + r * cell} width={cell - 1.5} height={cell - 1.5} rx={2}
                    fill={v === null ? '#f1f5f9' : colourFor(heatFraction(v, heat))}
                    stroke={v === null ? '#e2e8f0' : 'none'} strokeDasharray={v === null ? '2,2' : undefined}>
                <title>
                  {`${String.fromCharCode(65 + r)}${c + 1}: ${v === null ? 'no reading' : v}`}
                </title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
        <span>{heat.min}</span>
        <span style={{
          flex: 1, maxWidth: 160, height: 8, borderRadius: 4,
          background: `linear-gradient(to right, ${colourFor(0)}, ${colourFor(0.5)}, ${colourFor(1)})`,
        }} />
        <span>{heat.max}</span>
        <span>{yLabel}</span>
        {/*
          Wells with no reading are drawn as an outline rather than as the
          bottom of the scale. A well nobody read and a well that read zero
          are different things, and a heatmap that paints them the same colour
          says the plate was fuller than it was.
        */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: '#f1f5f9', border: '1px dashed #cbd5e1' }} />
          not read
        </span>
      </div>
    </div>
  );
}

/** Blue through white to red: the convention, and readable in greyscale. */
function colourFor(f: number): string {
  const clamp = Math.min(1, Math.max(0, f));
  if (clamp < 0.5) {
    const t = clamp * 2;
    return `rgb(${Math.round(37 + t * 218)}, ${Math.round(99 + t * 156)}, ${Math.round(235 + t * 20)})`;
  }
  const t = (clamp - 0.5) * 2;
  return `rgb(${Math.round(255 - t * 35)}, ${Math.round(255 - t * 217)}, ${Math.round(255 - t * 217)})`;
}
