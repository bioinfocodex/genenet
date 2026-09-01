import React, { useState, useMemo, useRef, useCallback } from 'react';
import type { SequenceFeature } from '../SequenceViewer';
import type { ReSite } from './LinearMap'; // reused type
import { chooseMapEnzymes, countCuts, siteLabel, siteTitle, type ChooseOptions } from '@/lib/map-enzymes';
import { bindingTitle, type PlacedPrimer } from '@/lib/primer-binding';

interface CircularMapProps {
  sequence: string;
  features: SequenceFeature[];
  reSites: ReSite[];
  selection?: { start: number; end: number } | null;
  onSelect?: (s: { start: number; end: number }) => void;
  onFeatureClick?: (f: SequenceFeature) => void;
  name?: string;
  onAddFeature?: (sel: { start: number; end: number }) => void;
  /** How to choose which sites are worth drawing. Defaults are SnapGene's. */
  enzymeDisplay?: ChooseOptions;
  /** Primers already located on this sequence. */
  primers?: PlacedPrimer[];
}

// Fixed layout. Outside the component because none of it varies per render.
const SVG = 800;
const CX = SVG / 2, CY = SVG / 2;
const R_OUT = 220;
const R_IN = 210;
const R_BB = (R_OUT + R_IN) / 2;
const TRACK_W = 18;

export default function CircularMap({ sequence, features, reSites, selection, onSelect, onFeatureClick, name, onAddFeature, enzymeDisplay, primers = [] }: CircularMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const len = sequence.length || 1;

  // Scanning 450 enzymes over a plasmid finds thousands of cuts; almost none
  // of them belong on a picture. Recomputed only when the sites or the display
  // rules change, because it walks every hit.
  const mapSites = useMemo(
    () => chooseMapEnzymes(reSites, countCuts(reSites), enzymeDisplay),
    [reSites, enzymeDisplay],
  );

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

  // Depends on how many reverse tracks were needed, so it stays in the body.
  /*
   * The ruler's own ring, inside the innermost reverse-strand feature track.
   *
   * It used to sit at R_IN - 12, which is the same radius as the label on a
   * track-0 reverse feature — so "922" was drawn straight through "AmpR
   * promoter". Positions and feature names are both worth reading, so they get
   * separate rings rather than a tie-break.
   */
  /*
   * Primer rows are assigned here rather than at draw time because the
   * restriction-site labels have to sit outside them. Working it out during
   * the render put the labels at a radius chosen before the primers knew how
   * much room they needed, and the two rings overlapped.
   */
  const primerRows = useMemo(() => {
    const edges: number[] = [];
    const rowOf = new Map<string, number>();
    for (const p of primers) {
      let row = edges.findIndex(edge => p.start > edge);
      if (row === -1) { row = edges.length; edges.push(0); }
      edges[row] = p.wrapsOrigin ? Infinity : p.end;
      rowOf.set(`${p.id}:${p.start}`, row);
    }
    return { rowOf, count: edges.length };
  }, [primers]);

  const R_PRIMER = R_OUT + (fwdTracks.numTracks * TRACK_W) + 10;
  const R_PRIMER_TOP = R_PRIMER + Math.max(0, primerRows.count - 1) * 9;
  const R_RULER = R_IN - (revTracks.numTracks * TRACK_W) - 12;
  const R_GC_OUT = R_RULER - 14;
  const R_GC_IN = R_GC_OUT - 40;

  // Stable for a given sequence length, so the GC memo can depend on it.
  const toAngle = useCallback((pos: number) => (pos / len) * 2 * Math.PI - Math.PI / 2, [len]);

  /** The line an intron is drawn as: a thin arc across the feature's whole span. */
  function intronArcPath(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1): string {
    const adjustedEnd = featEnd < featStart ? featEnd + len : featEnd;
    const a1 = toAngle(featStart - 1);
    const a2 = toAngle(adjustedEnd);
    const rm = strand === 1
      ? R_OUT + 5 + trackIdx * TRACK_W + (TRACK_W - 4) / 2
      : R_IN - 5 - trackIdx * TRACK_W - (TRACK_W - 4) / 2;
    const large = ((a2 - a1 + 2 * Math.PI) % (2 * Math.PI)) > Math.PI ? 1 : 0;
    const p = (a: number) => `${CX + rm * Math.cos(a)},${CY + rm * Math.sin(a)}`;
    return `M${p(a1)} A${rm},${rm} 0 ${large} 1 ${p(a2)}`;
  }

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
  }, [gcData, R_GC_OUT, R_GC_IN, toAngle]);
  
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
  // Outside the primer ring, whatever height that turned out to need.
  const R_RE_LBL = R_PRIMER_TOP + 22;

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
        {(() => {
          /*
           * Round positions, not twelve equal divisions.
           *
           * Dividing the length by twelve labels a 3,686 bp plasmid at 307,
           * 614, 922 — numbers that mean nothing and are hard to read against.
           * A step of 250, 500 or 1,000 puts the marks where someone would
           * look for them, and puts fewer of them on a small plasmid.
           */
          const target = 10;
          const step = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000]
            .find(x => len / x <= target) ?? Math.ceil(len / target);
          const count = Math.ceil(len / step);
          return Array.from({ length: count }, (_, i) => i * step);
        })().map((pos, i) => {
           const a = (pos / len) * 2 * Math.PI - Math.PI / 2;
           const cos = Math.cos(a), sin = Math.sin(a);
           return (
             <g key={i}>
               <line x1={CX + R_IN * cos} y1={CY + R_IN * sin} x2={CX + R_OUT * cos} y2={CY + R_OUT * sin} stroke="#9ca3af" strokeWidth={1.5} />
               <text x={CX + R_RULER * cos} y={CY + R_RULER * sin} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#6b7280" fontFamily="monospace" fontWeight="600">{pos >= 1000 ? `${(pos / 1000).toFixed(1)}k` : pos}</text>
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
               {feat.segments ? (
                 <>
                   {/* Introns first, so the exon blocks sit on top of the line. */}
                   <path d={intronArcPath(feat.start, feat.end, trackIdx, feat.strand)} fill="none" stroke={feat.color} strokeWidth={1.25} opacity={0.65} />
                   {feat.segments.map((seg, si) => (
                     <path
                       key={si}
                       d={featureArcPath(seg.start, seg.end, trackIdx, feat.strand)}
                       fill={feat.color}
                       opacity={isHovered ? 1 : 0.85}
                       stroke={isHovered ? '#fff' : feat.color}
                       strokeWidth={isHovered ? 2 : 1}
                       strokeLinejoin="round"
                     />
                   ))}
                 </>
               ) : (
               <path d={path} fill={feat.color} opacity={isHovered ? 1 : 0.85} stroke={isHovered ? '#fff' : feat.color} strokeWidth={isHovered ? 2 : 1} strokeLinejoin="round" />
               )}
               {/* Show feature name if long enough */}
               {adjustedEnd - feat.start > 60 && (
                 <text x={CX + lblR * Math.cos(midA)} y={CY + lblR * Math.sin(midA) + 3} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="700" style={{ pointerEvents: 'none' }}>
                   {feat.name}
                 </text>
               )}
             </g>
          );
        })}

        {/* Primers */}
        {(() => {
          /*
           * Primers ride just outside the forward feature tracks, on their own
           * ring, drawn as a thin arc with a head at the 3' end — the end that
           * gets extended, and the only end whose position decides what the
           * product is.
           *
           * The annealing region is what is drawn. A primer's 5' tail is not on
           * this molecule at all: drawing the whole oligo would put an arrow
           * over bases the primer does not bind, which is the one thing a map
           * must not do.
           */
          if (primers.length === 0) return null;

          return primers.map((p, i) => {
            // Wrapped primers are drawn from start round to end.
            const a1 = toAngle(p.start);
            const a2 = toAngle(p.wrapsOrigin ? p.end + len : p.end + 1);

            // Stacked outward so two overlapping primers do not sit on one line.
            const row = primerRows.rowOf.get(`${p.id}:${p.start}`) ?? 0;
            const r = R_PRIMER + row * 9;
            const large = (a2 - a1) > Math.PI ? 1 : 0;
            const headA = p.strand === 'forward' ? a2 : a1;
            const bodyEnd = p.strand === 'forward'
              ? a2 - Math.min(0.05, (a2 - a1) * 0.35)
              : a1 + Math.min(0.05, (a2 - a1) * 0.35);

            const arc = p.strand === 'forward'
              ? `M ${CX + r * Math.cos(a1)} ${CY + r * Math.sin(a1)} A ${r} ${r} 0 ${large} 1 ${CX + r * Math.cos(bodyEnd)} ${CY + r * Math.sin(bodyEnd)}`
              : `M ${CX + r * Math.cos(a2)} ${CY + r * Math.sin(a2)} A ${r} ${r} 0 ${large} 0 ${CX + r * Math.cos(bodyEnd)} ${CY + r * Math.sin(bodyEnd)}`;

            // A little triangle at the 3' end.
            const hx = CX + r * Math.cos(headA), hy = CY + r * Math.sin(headA);
            const back = p.strand === 'forward' ? headA - 0.045 : headA + 0.045;
            const head = [
              `${hx},${hy}`,
              `${CX + (r - 3.5) * Math.cos(back)},${CY + (r - 3.5) * Math.sin(back)}`,
              `${CX + (r + 3.5) * Math.cos(back)},${CY + (r + 3.5) * Math.sin(back)}`,
            ].join(' ');

            const colour = p.directionMismatch ? '#b91c1c' : '#7c3aed';
            return (
              <g key={`${p.id}-${i}`} style={{ cursor: 'help' }}>
                <title>{bindingTitle(p)}</title>
                <path d={arc} fill="none" stroke={colour} strokeWidth={2} opacity={0.9} />
                <polygon points={head} fill={colour} />
                {/* The tail, dashed and outside the arc, so it reads as not annealed. */}
                {p.tailLength > 0 && (
                  <path d={arc} fill="none" stroke={colour} strokeWidth={5} opacity={0.15} />
                )}
              </g>
            );
          });
        })()}

        {/* Restriction sites worth drawing */}
        {(() => {
          /*
           * Two passes. `chooseMapEnzymes` decides *which* sites belong on a
           * map — one label per site rather than one per enzyme, six-cutters
           * and up, unique cutters only. Then the labels are pushed apart
           * vertically, because deciding what to draw does not stop two sites
           * a few degrees apart from writing over each other.
           *
           * The previous version sorted the labels by Y and then never used
           * the ordering, so the sort looked like deconfliction and did
           * nothing: 109 labels landed at 32 positions.
           */
          const labels = mapSites.map(s => {
            const a = toAngle(s.cutPos);
            const cos = Math.cos(a), sin = Math.sin(a);
            return { s, a, cos, sin, y: CY + R_RE_LBL * sin, side: cos > 0 ? 1 : -1 };
          });

          const MIN_GAP = 12;
          for (const side of [1, -1]) {
            const column = labels.filter(l => l.side === side).sort((a, b) => a.y - b.y);
            // Walk down the column pushing each label clear of the one above.
            for (let i = 1; i < column.length; i++) {
              const gap = column[i].y - column[i - 1].y;
              if (gap < MIN_GAP) column[i].y = column[i - 1].y + MIN_GAP;
            }
            // Anything shoved past the bottom is pushed back up, so a crowded
            // column spreads either side of where it started rather than
            // running off the picture.
            const overflow = column.length ? column[column.length - 1].y - (SVG - 14) : 0;
            if (overflow > 0) for (const l of column) l.y -= overflow;
          }

          return labels.map((lbl, i) => {
            const { cos, sin } = lbl;
            const lx1 = CX + R_OUT * cos;
            const ly1 = CY + R_OUT * sin;
            const elbowX = CX + (R_RE_LBL - 20) * cos;
            const isRight = cos > 0;
            const textX = CX + R_RE_LBL * cos + (isRight ? 10 : -10);

            return (
              <g key={`${lbl.s.enzyme}-${i}`}>
                <title>{siteTitle(lbl.s)}</title>
                {/* Leader from the backbone out to the label's own row. */}
                <line x1={CX + R_IN * cos} y1={CY + R_IN * sin} x2={lx1} y2={ly1}
                      stroke={lbl.s.color} strokeWidth={2} />
                <polyline
                  points={`${lx1},${ly1} ${elbowX},${lbl.y} ${textX - (isRight ? 4 : -4)},${lbl.y}`}
                  fill="none" stroke={lbl.s.color} strokeWidth={1} opacity={0.45}
                />
                <text x={textX} y={lbl.y + 3} textAnchor={isRight ? 'start' : 'end'}
                      fill={lbl.s.color} fontSize={10} fontWeight="700" fontFamily="monospace">
                  {siteLabel(lbl.s)}
                </text>
              </g>
            );
          });
        })()}

      </svg>
    </div>
  );
}
