'use client';
import { useCallback, useMemo, useState } from 'react';

interface Reading {
  elapsedHrs: number;
  ph: number | null;
  temperature: number | null;
  dissolvedO2: number | null;
  feedRate: number | null;
  od600: number | null;
}

type Param = 'ph' | 'temperature' | 'dissolvedO2' | 'feedRate' | 'od600';

const PARAM_CONFIG: Record<Param, { label: string; color: string; unit: string; range: [number, number] }> = {
  ph:          { label: 'pH',           color: '#3b82f6', unit: '',    range: [4, 9]    },
  temperature: { label: 'Temperature',  color: '#ef4444', unit: '°C', range: [15, 45]  },
  dissolvedO2: { label: 'DO₂',          color: '#22c55e', unit: '%',  range: [0, 100]  },
  feedRate:    { label: 'Feed Rate',    color: '#f59e0b', unit: 'mL/h', range: [0, 100] },
  od600:       { label: 'OD₆₀₀',       color: '#a855f7', unit: '',    range: [0, 10]   },
};

interface Props {
  readings: Reading[];
}

// Fixed chart geometry. Outside the component because it never varies.
const W = 700, H = 260;
const PAD = { l: 50, r: 20, t: 20, b: 40 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

export default function BioreactorChart({ readings }: Props) {
  const [activeParams, setActiveParams] = useState<Set<Param>>(new Set(['ph', 'temperature', 'dissolvedO2']));

  const toggleParam = (p: Param) => {
    setActiveParams(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const maxT = useMemo(() => Math.max(...readings.map(r => r.elapsedHrs), 1), [readings]);

  // Stable across renders, so the memo below can depend on them honestly.
  const toX = useCallback((t: number) => PAD.l + (t / maxT) * plotW, [maxT]);
  const toY = useCallback((val: number, range: [number, number]) => {
    const [lo, hi] = range;
    const clamped = Math.max(lo, Math.min(hi, val));
    return PAD.t + plotH - ((clamped - lo) / (hi - lo)) * plotH;
  }, []);

  const lines = useMemo(() => {
    return (Object.keys(PARAM_CONFIG) as Param[])
      .filter(p => activeParams.has(p))
      .map(p => {
        const cfg = PARAM_CONFIG[p];
        const pts = readings
          .map(r => ({ t: r.elapsedHrs, v: r[p] }))
          .filter(pt => pt.v !== null) as { t: number; v: number }[];
        if (pts.length < 2) return null;
        const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${toX(pt.t).toFixed(1)},${toY(pt.v, cfg.range).toFixed(1)}`).join(' ');
        return { p, cfg, d, pts };
      })
      .filter(Boolean);
  }, [readings, activeParams, toX, toY]);

  const xTicks = Array.from({ length: 6 }, (_, i) => (i / 5) * maxT);

  if (readings.length === 0) {
    return <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>No readings yet</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Legend / toggles */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {(Object.keys(PARAM_CONFIG) as Param[]).map(p => {
          const cfg = PARAM_CONFIG[p];
          const active = activeParams.has(p);
          const hasData = readings.some(r => r[p] !== null);
          return (
            <button
              key={p}
              onClick={() => toggleParam(p)}
              disabled={!hasData}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.25rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: hasData ? 'pointer' : 'default',
                border: `1px solid ${active ? cfg.color : 'var(--glass-border)'}`,
                background: active ? cfg.color + '18' : 'white',
                color: active ? cfg.color : 'var(--text-muted)',
                opacity: hasData ? 1 : 0.4,
                fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 10, height: 2, background: cfg.color, borderRadius: 1 }} />
              {cfg.label} {cfg.unit && <span style={{ opacity: 0.7 }}>({cfg.unit})</span>}
            </button>
          );
        })}
      </div>

      {/* SVG chart */}
      <div style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} style={{ display: 'block', minWidth: W }}>
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const y = PAD.t + f * plotH;
            return <line key={f} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--glass-border)" strokeWidth={1} />;
          })}

          {/* Lines */}
          {lines.map(line => line && (
            <g key={line.p}>
              <path d={line.d} fill="none" stroke={line.cfg.color} strokeWidth={2} strokeLinejoin="round" />
              {line.pts.map((pt, i) => (
                <circle key={i} cx={toX(pt.t)} cy={toY(pt.v, line.cfg.range)} r={3} fill={line.cfg.color} />
              ))}
            </g>
          ))}

          {/* X axis */}
          <line x1={PAD.l} y1={PAD.t + plotH} x2={W - PAD.r} y2={PAD.t + plotH} stroke="#94a3b8" strokeWidth={1} />
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={toX(t)} y1={PAD.t + plotH} x2={toX(t)} y2={PAD.t + plotH + 5} stroke="#94a3b8" strokeWidth={1} />
              <text x={toX(t)} y={PAD.t + plotH + 16} textAnchor="middle" fontSize={9} fill="#94a3b8" fontFamily="monospace">
                {t.toFixed(1)}h
              </text>
            </g>
          ))}

          {/* Y axis label */}
          <text x={12} y={PAD.t + plotH / 2} fontSize={9} fill="#94a3b8" textAnchor="middle" transform={`rotate(-90, 12, ${PAD.t + plotH / 2})`}>
            Normalized value
          </text>
        </svg>
      </div>
    </div>
  );
}
