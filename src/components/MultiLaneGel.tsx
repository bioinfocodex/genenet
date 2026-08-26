import React from 'react';

const LADDER_BANDS = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 800, 600, 500, 400, 300, 200, 100];

function getLogPos(bp: number): number {
  const minLog = Math.log10(100);
  const maxLog = Math.log10(10000);
  const logBp = Math.log10(Math.max(100, Math.min(bp, 10000)));
  return 90 - ((logBp - minLog) / (maxLog - minLog)) * 80;
}

export interface GelBand {
  size: number;
  highlight?: boolean; // glow in accent color
  label?: string;      // short label shown beside band
}

export interface GelLane {
  label: string;
  color: string;  // hex or css color for the lane bands
  bands: GelBand[];
}

interface Props {
  lanes: GelLane[];
  compact?: boolean;
}

export default function MultiLaneGel({ lanes, compact = false }: Props) {
  const laneWidth = compact ? 50 : 70;
  const height = compact ? 200 : 300;
  const ladderWidth = compact ? 45 : 55;
  const labelOffset = compact ? 20 : 25;
  const totalWidth = ladderWidth + lanes.length * (laneWidth + 16) + 50;

  return (
    <div style={{
      background: '#111827',
      padding: compact ? '0.75rem' : '1.25rem',
      borderRadius: '12px',
      display: 'inline-flex',
      gap: '0',
      color: '#e5e7eb',
      border: '1px solid var(--glass-border)',
      boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.5)',
      overflowX: 'auto',
    }}>
      <svg width={totalWidth} height={height + labelOffset + 10} style={{ display: 'block' }}>
        {/* --- Ladder lane --- */}
        <text x={ladderWidth / 2} y={12} textAnchor="middle" fontSize={compact ? 8 : 9} fill="#6b7280">Ladder</text>
        <rect x={8} y={labelOffset} width={ladderWidth - 16} height={height} fill="rgba(0,0,0,0.35)" rx={3} />
        {LADDER_BANDS.map(bp => {
          const top = labelOffset + (getLogPos(bp) / 100) * height;
          const isLabelled = [10000, 3000, 1000, 100].includes(bp);
          const isBright = bp === 1000 || bp === 3000;
          return (
            <g key={bp}>
              <rect
                x={14} y={top - 1.5}
                width={ladderWidth - 28} height={3}
                fill={isBright ? 'rgba(56,189,248,0.85)' : 'rgba(156,163,175,0.4)'}
                rx={1}
              />
              {isBright && <rect x={14} y={top - 1.5} width={ladderWidth - 28} height={3} fill="rgba(56,189,248,0.3)" rx={1} style={{ filter: 'blur(3px)' }} />}
              {isLabelled && (
                <text x={4} y={top + 4} textAnchor="end" fontSize={compact ? 7 : 8} fill="#6b7280" fontFamily="monospace">
                  {bp >= 1000 ? `${bp / 1000}k` : bp}
                </text>
              )}
            </g>
          );
        })}

        {/* --- Sample lanes --- */}
        {lanes.map((lane, li) => {
          const lx = ladderWidth + li * (laneWidth + 16);
          return (
            <g key={li}>
              <text x={lx + laneWidth / 2} y={12} textAnchor="middle" fontSize={compact ? 8 : 9} fill={lane.color} fontWeight="600">
                {lane.label.length > 10 ? lane.label.substring(0, 9) + '…' : lane.label}
              </text>
              <rect x={lx + 4} y={labelOffset} width={laneWidth - 8} height={height} fill="rgba(0,0,0,0.35)" rx={3} />
              {lane.bands.map((band, bi) => {
                if (!band.size || band.size <= 0) return null;
                const top = labelOffset + (getLogPos(band.size) / 100) * height;
                const bandColor = band.highlight ? lane.color : 'rgba(156,163,175,0.5)';
                return (
                  <g key={bi}>
                    <rect
                      x={lx + 10} y={top - 2}
                      width={laneWidth - 20} height={4}
                      fill={bandColor} rx={2}
                    />
                    {band.highlight && (
                      <rect
                        x={lx + 10} y={top - 2}
                        width={laneWidth - 20} height={4}
                        fill={bandColor} rx={2}
                        style={{ filter: `blur(4px)`, opacity: 0.6 }}
                      />
                    )}
                    <text
                      x={lx + laneWidth + 4} y={top + 4}
                      fontSize={compact ? 7 : 8} fill={band.highlight ? lane.color : '#6b7280'}
                      fontFamily="monospace" fontWeight={band.highlight ? '700' : '400'}
                    >
                      {band.label ? band.label : `${band.size}bp`}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
