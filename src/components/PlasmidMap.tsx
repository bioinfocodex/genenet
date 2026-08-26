import React from 'react';

interface CutSite {
  enzyme: string;
  position: number;
}

export interface PlasmidFeature {
  label: string;
  startBp: number;
  endBp: number;
  color: string;
}

interface Props {
  name: string;
  totalBp: number;
  cuts: CutSite[];
  features?: PlasmidFeature[];
  title?: string;
  selection?: { start: number; end: number } | null;
  onSelect?: (s: { start: number; end: number } | null) => void;
}

export default function PlasmidMap({ name, totalBp, cuts, features = [], title = 'Expected Construct Vector', selection, onSelect }: Props) {
  const radius = 100;
  const cx = 160;
  const cy = 160;
  const [dragStart, setDragStart] = React.useState<number | null>(null);

  const getCoords = (bp: number, r = radius) => {
    const angle = (bp / totalBp) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  const fromCoords = (x: number, y: number) => {
    let angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    return Math.round((angle / (2 * Math.PI)) * totalBp);
  };

  const getArcPath = (startBp: number, endBp: number, r: number) => {
    const s = getCoords(startBp, r);
    const e = getCoords(endBp, r);
    let sweep = (endBp - startBp);
    if (sweep < 0) sweep += totalBp;
    const largeArc = (sweep / totalBp) > 0.5 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const bp = fromCoords(e.clientX - rect.left, e.clientY - rect.top);
    setDragStart(bp);
    onSelect?.({ start: bp, end: bp });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStart === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const bp = fromCoords(e.clientX - rect.left, e.clientY - rect.top);
    onSelect?.({ start: Math.min(dragStart, bp), end: Math.max(dragStart, bp) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', margin: '0', width: 'fit-content' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{title}</div>
      <svg 
        width={320} height={320} 
        style={{ overflow: 'visible', cursor: 'pointer', userSelect: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragStart(null)}
        onMouseLeave={() => setDragStart(null)}
      >
        {/* Backbone */}
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--accent-blue-15)" strokeWidth={12} />
        
        {/* Selection Highlight Arc */}
        {selection && selection.start !== selection.end && (
          <path
            d={getArcPath(selection.start, selection.end, radius)}
            fill="none"
            stroke="var(--accent-blue-40)"
            strokeWidth={14}
            opacity={0.4}
          />
        )}

        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--accent-blue)" strokeWidth={2} />

        {/* Feature arcs (e.g. inserted gene) */}
        {features.map((feat, i) => (
          <g key={i}>
            <path
              d={getArcPath(feat.startBp, feat.endBp, radius)}
              fill="none"
              stroke={feat.color}
              strokeWidth={10}
              strokeLinecap="round"
              opacity={0.85}
            />
            {/* Feature label at midpoint */}
            {(() => {
              const midBp = feat.startBp < feat.endBp ? (feat.startBp + feat.endBp) / 2 : ((feat.startBp + feat.endBp + totalBp) / 2) % totalBp;
              const pos = getCoords(midBp, radius + 28);
              return (
                <text
                  x={pos.x} y={pos.y}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="10" fontWeight="700" fill={feat.color}
                >
                  {feat.label}
                </text>
              );
            })()}
          </g>
        ))}

        {/* Name + size */}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="13" fontWeight="bold" fill="var(--text-primary)">{name}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">{totalBp} bp</text>
        
        {selection && (
          <text x={cx} y={cy + 26} textAnchor="middle" fontSize="10" fill="var(--accent-blue)" fontWeight="600">
            {selection.start} – {selection.end} ({selection.end - selection.start + 1} bp)
          </text>
        )}

        {/* Cut sites */}
        {cuts.map((cut, i) => {
          const inner = getCoords(cut.position, radius - 6);
          const outer = getCoords(cut.position, radius + 15);
          const textPos = getCoords(cut.position, radius + 24);
          return (
            <g key={i}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--accent-red)" strokeWidth={1.5} />
              <text
                x={textPos.x} y={textPos.y}
                fontSize="10" fill="var(--accent-red)" fontWeight="600"
                textAnchor={textPos.x > cx ? 'start' : 'end'}
                dominantBaseline="middle"
              >
                {cut.enzyme}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
