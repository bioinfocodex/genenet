import React, { useState, useMemo, useRef } from 'react';
import type { SequenceFeature } from '../SequenceViewer';
import type { ReSite } from './LinearMap'; // reused type

interface CircularMapProps {
  sequence: string;
  features: SequenceFeature[];
  reSites: ReSite[];
  selection?: { start: number; end: number } | null;
  onSelect?: (s: { start: number; end: number }) => void;
  onFeatureClick?: (f: SequenceFeature) => void;
  name?: string;
  onAddFeature?: (sel: { start: number; end: number }) => void;
}

export default function CircularMap({ sequence, features, reSites, selection, onSelect, onFeatureClick, name, onAddFeature }: CircularMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const len = sequence.length || 1;

  // Track system to prevent feature collision
  const assignTracks = (feats: SequenceFeature[], direction: 1 | -1) => {
    const sorted = feats.filter(f => f.strand === direction).sort((a, b) => a.start - b.start);
    const tracks: number[] = [];
    const map = new Map<string, number>();
    for (const f of sorted) {
      let t = tracks.findIndex(endAngle => {
        // Simple angular collision check (approximate)
        if (f.start > f.end) return false; // wrap around always goes to new track for simplicity
        return endAngle < f.start;
      });
      if (t === -1) { t = tracks.length; tracks.push(0); }
      tracks[t] = f.end < f.start ? f.end + len : f.end;
      map.set(f.id, t);
    }
    return { map, numTracks: tracks.length };
  };

  const fwdTracks = assignTracks(features, 1);
  const revTracks = assignTracks(features, -1);

  // Layout constants
  const SVG = 800;
  const CX = SVG / 2, CY = SVG / 2;

  // Calculate backbone radius based on tracks
  const R_OUT = 220;
  const R_IN = 210;
  const R_BB = (R_OUT + R_IN) / 2;
  const TRACK_W = 18;

  // GC Content Plot
  const R_GC_OUT = R_IN - (revTracks.numTracks * TRACK_W) - 15;
  const R_GC_IN = R_GC_OUT - 40;

  const toAngle = (pos: number) => (pos / len) * 2 * Math.PI - Math.PI / 2;

  function featureArcPath(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1): string {
    const adjustedEnd = featEnd < featStart ? featEnd + len : featEnd;
    const frac = (adjustedEnd - featStart) / len;
    const a1 = toAngle(featStart - 1);
    const a2 = toAngle(adjustedEnd);

    // Radii
    let ro, ri;
    if (strand === 1) {
      ri = R_OUT + 5 + trackIdx * TRACK_W;
      ro = ri + TRACK_W - 4;
    } else {
      ro = R_IN - 5 - trackIdx * TRACK_W;
      ri = ro - TRACK_W + 4;
    }

    const arrowAngle = Math.min(18, (frac * 2 * Math.PI * ro) * 0.4) / ro;
    const rm = (ro + ri) / 2;

    if (strand === 1) {
      const bodyEnd = a2 - arrowAngle;
      const bLarge = ((bodyEnd - a1 + 2 * Math.PI) % (2 * Math.PI)) > Math.PI ? 1 : 0;
      const p = (r: number, a: number) => `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`;
      const tx = CX + rm * Math.cos(a2), ty = CY + rm * Math.sin(a2);
      const roW = ro + 3, riW = ri - 3;
      return [
        `M${p(ro, a1)}`,
        `A${ro},${ro} 0 ${bLarge},1 ${p(ro, bodyEnd)}`,
        `L${CX + roW * Math.cos(bodyEnd)},${CY + roW * Math.sin(bodyEnd)}`,
        `L${tx},${ty}`,
        `L${CX + riW * Math.cos(bodyEnd)},${CY + riW * Math.sin(bodyEnd)}`,
        `L${p(ri, bodyEnd)}`,
        `A${ri},${ri} 0 ${bLarge},0 ${p(ri, a1)}`,
        'Z',
      ].join(' ');
    } else {
      const bodyStart = a1 + arrowAngle;
      const bLarge = ((a2 - bodyStart + 2 * Math.PI) % (2 * Math.PI)) > Math.PI ? 1 : 0;
      const p = (r: number, a: number) => `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`;
      const tx = CX + rm * Math.cos(a1), ty = CY + rm * Math.sin(a1);
      const roW = ro + 3, riW = ri - 3;
      return [
        `M${tx},${ty}`,
        `L${CX + roW * Math.cos(bodyStart)},${CY + roW * Math.sin(bodyStart)}`,
        `L${p(ro, bodyStart)}`,
        `A${ro},${ro} 0 ${bLarge},1 ${p(ro, a2)}`,
        `L${p(ri, a2)}`,
        `A${ri},${ri} 0 ${bLarge},0 ${p(ri, bodyStart)}`,
        `L${CX + riW * Math.cos(bodyStart)},${CY + riW * Math.sin(bodyStart)}`,
        `L${tx},${ty}`,
        'Z',
      ].join(' ');
    }
  }

  // GC Content calculation
  const gcData = useMemo(() => {
    if (len < 100) return [];
    const windowSize = Math.max(20, Math.floor(len / 100));
    const step = Math.max(10, Math.floor(len / 200));
    const data = [];
    const seq = sequence.toUpperCase();
    for (let i = 0; i < len; i += step) {
      let gc = 0;
      for (let w = 0; w < windowSize; w++) {
        const char = seq[(i + w) % len];
        if (char === 'G' || char === 'C') gc++;
      }
      data.push({ pos: i, val: gc / windowSize });
    }
    return data;
  }, [sequence, len]);

  const gcPath = useMemo(() => {
    if (gcData.length === 0) return '';
    const origin = gcData.reduce((acc, d) => acc + d.val, 0) / Math.max(1, gcData.length); // mean GC
    const pts = gcData.map(d => {
      const angle = toAngle(d.pos);
      // Diff from mean
      const dr = (d.val - origin) * (R_GC_OUT - R_GC_IN) * 2;
      const r = (R_GC_OUT + R_GC_IN) / 2 + dr;
      return `${CX + Math.min(R_GC_OUT, Math.max(R_GC_IN, r)) * Math.cos(angle)},${CY + Math.min(R_GC_OUT, Math.max(R_GC_IN, r)) * Math.sin(angle)}`;
    });
    return `M${pts.join(' L')} Z`;
  }, [gcData, R_GC_OUT, R_GC_IN]);
  
  const gcBaselineRadius = (R_GC_OUT + R_GC_IN) / 2;

  // Interaction
  const [dragStart, setDragStart] = useState<number | null>(null);

  const getBpFromEvent = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / zoom + (CX - SVG / 2 / zoom);
    const sy = (e.clientY - rect.top) / zoom + (CY - SVG / 2 / zoom);
    let angle = Math.atan2(sy - CY, sx - CX) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const bp = Math.round((angle / (2 * Math.PI)) * len);
    return bp === 0 ? 1 : bp;
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const bp = getBpFromEvent(e);
    setDragStart(bp);
    onSelect?.({ start: bp, end: bp });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragStart === null) return;
    const curr = getBpFromEvent(e);
    let s = dragStart, end = curr;
    // Basic circular wrap handling for selection display (always assumes forward selection for now)
    if (s > end && s - end > len / 2) { end += len; }
    else if (end > s && end - s > len / 2) { s += len; }
    onSelect?.({ start: Math.min(s, end) > len ? Math.min(s, end) % len || len : Math.min(s, end), end: Math.max(s, end) > len ? Math.max(s, end) % len || len : Math.max(s, end) });
  };

  const handleMouseUp = () => setDragStart(null);

  // Label positions for enzymes
  const R_RE_LBL = R_OUT + fwdTracks.numTracks * TRACK_W + 20;

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '1rem', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ alignSelf: 'flex-end', marginBottom: '-2rem', zIndex: 10 }}>
         <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px 0 0 8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>+</button>
         <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'white', border: '1px solid var(--glass-border)', borderRadius: '0 8px 8px 0', borderLeft: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>−</button>
      </div>

      <svg
        ref={svgRef}
        width={SVG} height={SVG}
        viewBox={`${SVG / 2 - SVG / 2 / zoom} ${SVG / 2 - SVG / 2 / zoom} ${SVG / zoom} ${SVG / zoom}`}
        style={{ cursor: dragStart !== null ? 'pointer' : 'default', transition: 'viewBox 0.3s cubic-bezier(0.2, 0, 0, 1)' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* GC Track */}
        {gcData.length > 0 && (
          <g>
            <circle cx={CX} cy={CY} r={gcBaselineRadius} fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth={1} />
            <path d={gcPath} fill="var(--accent-purple)" opacity={0.15} stroke="var(--accent-purple)" strokeWidth={1} />
            <text x={CX} y={CY - R_GC_IN + 14} textAnchor="middle" fontSize={8} fill="var(--text-muted)" letterSpacing={2}>GC Content</text>
          </g>
        )}

        {/* Backbone */}
        <circle cx={CX} cy={CY} r={R_OUT} fill="none" stroke="#e5e7eb" strokeWidth={2} />
        <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke="#e5e7eb" strokeWidth={2} />
        <path d={`M${CX},${CY - R_OUT} A${R_OUT},${R_OUT} 0 1,1 ${CX - 0.1},${CY - R_OUT}`} fill="none" stroke="var(--accent-blue)" strokeWidth={6} opacity={0.1} />

        {/* Name and Size */}
        <text x={CX} y={CY - 5} textAnchor="middle" fontSize={22} fontWeight="800" fill="var(--text-primary)">{name}</text>
        <text x={CX} y={CY + 18} textAnchor="middle" fontSize={14} fill="var(--text-secondary)">{len.toLocaleString()} bp</text>

        {/* Selection Sector */}
        {selection && selection.start !== selection.end && (() => {
           const startAngle = toAngle(selection.start - 1);
           let endAngle = toAngle(selection.end);
           if (endAngle < startAngle) endAngle += 2 * Math.PI;
           const sX = CX + R_IN * Math.cos(startAngle);
           const sY = CY + R_IN * Math.sin(startAngle);
           const eX = CX + R_IN * Math.cos(endAngle);
           const eY = CY + R_IN * Math.sin(endAngle);
           const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
           return (
             <path d={`M${CX},${CY} L${sX},${sY} A${R_IN},${R_IN} 0 ${largeArc},1 ${eX},${eY} Z`} fill="rgba(59,130,246,0.1)" />
           );
        })()}

        {/* Ticks */}
        {Array.from({ length: 12 }, (_, i) => {
           const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
           const pos = Math.round((i / 12) * len);
           const cos = Math.cos(a), sin = Math.sin(a);
           return (
             <g key={i}>
               <line x1={CX + R_IN * cos} y1={CY + R_IN * sin} x2={CX + R_OUT * cos} y2={CY + R_OUT * sin} stroke="#9ca3af" strokeWidth={1.5} />
               <text x={CX + (R_IN - 12) * cos} y={CY + (R_IN - 12) * sin} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#6b7280" fontFamily="monospace" fontWeight="600">{pos >= 1000 ? `${(pos / 1000).toFixed(1)}k` : pos}</text>
             </g>
           );
        })}

        {/* Features */}
        {features.map((feat) => {
          const isFwd = feat.strand === 1;
          const map = isFwd ? fwdTracks.map : revTracks.map;
          const trackIdx = map.get(feat.id) ?? 0;
          const path = featureArcPath(feat.start, feat.end, trackIdx, feat.strand);
          const isHovered = hoveredId === feat.id;

          // Approx mid point for label
          const adjustedEnd = feat.end < feat.start ? feat.end + len : feat.end;
          const midA = toAngle((feat.start + adjustedEnd) / 2);
          const lblR = isFwd ? R_OUT + 5 + trackIdx * TRACK_W + TRACK_W / 2 : R_IN - 5 - trackIdx * TRACK_W - TRACK_W / 2;

          return (
             <g key={feat.id}
               onClick={(e) => { e.stopPropagation(); onFeatureClick?.(feat); }}
               onMouseEnter={() => setHoveredId(feat.id)}
               onMouseLeave={() => setHoveredId(null)}
               style={{ cursor: 'pointer', transition: 'all 0.2s' }}
               filter={isHovered ? 'url(#shadow)' : 'none'}
             >
               <path d={path} fill={feat.color} opacity={isHovered ? 1 : 0.85} stroke={isHovered ? '#fff' : feat.color} strokeWidth={isHovered ? 2 : 1} strokeLinejoin="round" />
               {/* Show feature name if long enough */}
               {adjustedEnd - feat.start > 60 && (
                 <text x={CX + lblR * Math.cos(midA)} y={CY + lblR * Math.sin(midA) + 3} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="700" style={{ pointerEvents: 'none' }}>
                   {feat.name}
                 </text>
               )}
             </g>
          );
        })}

        {/* Unique Restriction Enzymes */}
        {(() => {
          // Deconflict logic for RE text
          const uniqueSites = reSites.filter(s => {
             return reSites.filter(rs => rs.enzyme === s.enzyme).length === 1;
          });
          const labels = uniqueSites.map(s => {
            const a = toAngle(s.cutPos);
            return { s, a, textY: CY + R_RE_LBL * Math.sin(a) };
          });
          // Sort basically by Y to space them out (simplified deconfliction)
          labels.sort((a, b) => a.textY - b.textY);

          return labels.map((lbl, i) => {
            const cos = Math.cos(lbl.a), sin = Math.sin(lbl.a);
            const lx1 = CX + R_OUT * cos;
            const ly1 = CY + R_OUT * sin;
            const lx2 = CX + (R_RE_LBL - 20) * cos;
            const ly2 = CY + (R_RE_LBL - 20) * sin;
            const isRight = cos > 0;
            const textX = CX + R_RE_LBL * cos + (isRight ? 10 : -10);

            return (
              <g key={i}>
                <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke={lbl.s.color} strokeWidth={1} opacity={0.5} />
                <line x1={CX + R_IN * cos} y1={CY + R_IN * sin} x2={lx1} y2={ly1} stroke={lbl.s.color} strokeWidth={2} />
                <text x={textX} y={ly2 + 4} textAnchor={isRight ? 'start' : 'end'} fill={lbl.s.color} fontSize={10} fontWeight="700" fontFamily="monospace">{lbl.s.enzyme}</text>
              </g>
            );
          });
        })()}

      </svg>
    </div>
  );
}
