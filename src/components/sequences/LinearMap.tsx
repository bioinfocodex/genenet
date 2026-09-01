import React, { useState, useMemo } from 'react';
import type { SequenceFeature } from '../SequenceViewer';

import { chooseMapEnzymes, countCuts, siteLabel, siteTitle, type ChooseOptions } from '@/lib/map-enzymes';
import { bindingTitle, type PlacedPrimer } from '@/lib/primer-binding';

export interface ReSite {
  enzyme: string;
  cutPos: number;
  recognitionStart: number;
  recognitionLen: number;
  overhang: string;
  overhangType: string;
  color: string;
}

interface LinearMapProps {
  sequence: string;
  features: SequenceFeature[];
  reSites: ReSite[];
  /** How to choose which sites are worth drawing. Defaults are SnapGene's. */
  enzymeDisplay?: ChooseOptions;
  /** Primers already located on this sequence. */
  primers?: PlacedPrimer[];
  isCircular: boolean;
  selection?: { start: number; end: number } | null;
  onSelect?: (s: { start: number; end: number }) => void;
  onFeatureClick?: (f: SequenceFeature) => void;
}

function assignRows(features: SequenceFeature[]): Map<string, number> {
  const sorted = [...features].sort((a, b) => a.start - b.start);
  const rowEnds: number[] = [];
  const map = new Map<string, number>();
  for (const f of sorted) {
    let row = rowEnds.findIndex(e => e < f.start);
    if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = f.end;
    map.set(f.id, row);
  }
  return map;
}

export default function LinearMap({ sequence, features, reSites, isCircular, selection, onSelect, onFeatureClick, enzymeDisplay, primers = [] }: LinearMapProps) {
  const len = sequence.length;
  const W = 800;
  const padL = 20; const padR = 40;
  const mapW = W - padL - padR;
  const toX = (pos: number) => padL + (pos / len) * mapW;
  const toBp = (x: number) => Math.max(1, Math.min(len, Math.round(((x - padL) / mapW) * len)));

  const featureRows = assignRows(features);
  const maxRow = features.length > 0 ? Math.max(...featureRows.values()) + 1 : 0;

  // Layout Y positions
  const reAreaH = 40;
  const fwdY = reAreaH + 4;
  const revY = fwdY + 8;
  /*
   * Primers get a band between the strands and the features. Rows are worked
   * out here rather than while drawing, because everything below has to be
   * pushed down by however many rows they need.
   */
  const primerRows = useMemo(() => {
    const edges: number[] = [];
    const rowOf = new Map<string, number>();
    for (const p of primers) {
      let row = edges.findIndex(edge => p.start > edge + 40);
      if (row === -1) { row = edges.length; edges.push(0); }
      edges[row] = p.end;
      rowOf.set(`${p.id}:${p.start}`, row);
    }
    return { rowOf, count: edges.length };
  }, [primers]);

  const primerY = revY + 14;
  const primerH = primerRows.count * 13;
  const featStartY = primerY + primerH + (primerRows.count ? 8 : 2);
  const featH = maxRow * 24;
  const rulerY = featStartY + featH + 12;
  const svgH = rulerY + 30;

  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [hoveredRE, setHoveredRE] = useState<{ name: string; pos: number; overhang: string; overhangType: string; x: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const bp = toBp(x);
    setDragStart(bp); setDragEnd(bp);
  };
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragStart === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const curr = toBp(e.clientX - rect.left);
    setDragEnd(curr);
  };
  const handleMouseUp = () => {
    if (dragStart !== null && dragEnd !== null && onSelect) {
      const s = Math.min(dragStart, dragEnd);
      const e2 = Math.max(dragStart, dragEnd);
      if (s !== e2) onSelect({ start: s, end: e2 });
    }
    setDragStart(null); setDragEnd(null);
  };

  const mapSites = useMemo(
    () => chooseMapEnzymes(reSites, countCuts(reSites), enzymeDisplay),
    [reSites, enzymeDisplay],
  );

  const reSitesByEnzyme = new Map<string, ReSite[]>();
  reSites.forEach(s => {
    if (!reSitesByEnzyme.has(s.enzyme)) reSitesByEnzyme.set(s.enzyme, []);
    reSitesByEnzyme.get(s.enzyme)!.push(s);
  });

  const selX1 = selection ? toX(selection.start - 1) : 0;
  const selX2 = selection ? toX(selection.end) : 0;
  const dragSelX1 = (dragStart && dragEnd) ? toX(Math.min(dragStart, dragEnd) - 1) : 0;
  const dragSelX2 = (dragStart && dragEnd) ? toX(Math.max(dragStart, dragEnd)) : 0;

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '1rem', border: '1px solid var(--glass-border)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.02)' }}>
      <div style={{ overflowX: 'auto', marginBottom: '0.5rem' }}>
        <svg
          width="100%" height={svgH} viewBox={`0 0 ${W} ${svgH}`} preserveAspectRatio="xMinYMin meet"
          style={{ display: 'block', minWidth: W, cursor: dragStart !== null ? 'ew-resize' : 'crosshair', userSelect: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid lines */}
          {Array.from({ length: 11 }, (_, i) => {
            const pos = Math.round((i / 10) * len);
            const x = toX(pos);
            return <line key={`grid-${i}`} x1={x} y1={0} x2={x} y2={svgH} stroke="rgba(0,0,0,0.03)" strokeWidth={1} />;
          })}

          {/* Primers */}
          {primers.map((p, i) => {
            /*
             * Only the annealing region is drawn. A 5' tail is not on this
             * molecule, and an arrow covering bases the primer does not bind
             * would be a map telling a lie about where the product starts.
             */
            const row = primerRows.rowOf.get(`${p.id}:${p.start}`) ?? 0;
            const y = primerY + row * 13;
            const colour = p.directionMismatch ? '#b91c1c' : '#7c3aed';

            /*
             * A primer through the origin becomes two pieces on a linear axis.
             *
             * Drawing it as one span from start to end gives a negative width,
             * which came out as a three-pixel stub at the far right — the
             * primer present, its extent a lie. The arrowhead goes on whichever
             * piece carries the 3' end, since that is the end that extends.
             */
            const pieces = p.wrapsOrigin
              ? [
                  { from: p.start, to: len - 1, head: p.strand === 'reverse' },
                  { from: 0, to: p.end, head: p.strand === 'forward' },
                ]
              : [{ from: p.start, to: p.end, head: true }];

            const x1 = toX(p.start);
            const w = Math.max(3, toX(p.wrapsOrigin ? len : p.end + 1) - x1);

            return (
              <g key={`${p.id}-${i}`} style={{ cursor: 'help' }}>
                <title>{bindingTitle(p)}</title>
                {pieces.map((seg, k) => {
                  const sx = toX(seg.from);
                  const sw = Math.max(3, toX(seg.to + 1) - sx);
                  const head = seg.head ? Math.min(6, sw * 0.4) : 0;
                  const shape = p.strand === 'forward'
                    ? `${sx},${y - 3} ${sx + sw - head},${y - 3} ${sx + sw},${y} ${sx + sw - head},${y + 3} ${sx},${y + 3}`
                    : `${sx + sw},${y - 3} ${sx + head},${y - 3} ${sx},${y} ${sx + head},${y + 3} ${sx + sw},${y + 3}`;
                  return <polygon key={k} points={shape} fill={colour} opacity={0.85} />;
                })}
                {/*
                  * Labelled by the room available, not by the primer's own
                  * width. A 24 nt primer on a 3.7 kb plasmid is five pixels
                  * wide, so gating on that drew every arrow nameless — and an
                  * unlabelled arrow is half a feature. What matters is whether
                  * the name fits before the next primer on this row.
                  */}
                {(() => {
                  const nameW = p.name.length * 4.4;
                  const next = primers.find(o =>
                    o !== p &&
                    (primerRows.rowOf.get(`${o.id}:${o.start}`) ?? 0) === row &&
                    o.start > p.start);
                  const room = next ? toX(next.start) - (x1 + w / 2) - 4 : W - (x1 + w / 2) - 4;
                  return room > nameW / 2
                    ? <text x={x1 + w / 2} y={y - 5} textAnchor="middle" fontSize={8}
                            fill={colour} fontWeight="700">{p.name}</text>
                    : null;
                })()}
              </g>
            );
          })}

          {/* RE sites */}
          {(() => {
            /*
             * The same selection the circular map uses, for the same reason: a
             * 450-enzyme scan produces thousands of cuts, and drawing a line
             * for each one is both unreadable and thousands of SVG nodes.
             *
             * Labels are then stacked into rows by actual width. Staggering
             * them by index modulo three, as this did, spreads them evenly
             * whether or not they collide — so it separates labels that were
             * never going to touch and leaves touching ones on the same row.
             */
            const rows: number[] = [];       // right-hand edge used so far, per row
            return mapSites.map((s, i) => {
              const x = toX(s.cutPos);
              const label = siteLabel(s);
              const halfWidth = label.length * 2.8 + 4;

              let row = rows.findIndex(edge => x - halfWidth > edge);
              if (row === -1) { row = rows.length; rows.push(0); }
              rows[row] = x + halfWidth;

              const labelY = reAreaH - row * 11 - 6;
              return (
                <g key={`${s.enzyme}-${i}`}
                  onMouseEnter={() => setHoveredRE({ name: s.enzyme, pos: s.cutPos, overhang: '', overhangType: '', x })}
                  onMouseLeave={() => setHoveredRE(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{siteTitle(s)}</title>
                  <line x1={x} y1={fwdY - 4} x2={x} y2={revY + 4} stroke={s.color} strokeWidth={2} />
                  <line x1={x} y1={fwdY - 4} x2={x} y2={labelY + 3} stroke={s.color} strokeWidth={1} opacity={0.55} strokeDasharray="2,2" />
                  <text x={x} y={labelY} textAnchor="middle" fontSize={9} fill={s.color} fontWeight="700" fontFamily="monospace">
                    {label}
                  </text>
                </g>
              );
            });
          })()}

          {/* Hover tooltip for RE */}
          {hoveredRE && (() => {
            const tx = Math.min(Math.max(hoveredRE.x, 60), W - 60);
            const ty = fwdY - 6;
            return (
              <g pointerEvents="none" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.2))' }}>
                <rect x={tx - 50} y={ty - 40} width={100} height={36} rx={6} fill="#0f172a" opacity={0.95} />
                <text x={tx} y={ty - 26} textAnchor="middle" fontSize={11} fill="white" fontWeight="800">{hoveredRE.name}</text>
                <text x={tx} y={ty - 14} textAnchor="middle" fontSize={9} fill="#94a3b8">Cut: {hoveredRE.pos} ({hoveredRE.overhangType})</text>
              </g>
            );
          })()}

          {/* Selection highlight */}
          {selection && selX2 > selX1 && (
            <rect x={selX1} y={fwdY - 6} width={selX2 - selX1} height={revY + 6 - (fwdY - 6)} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth={1.5} rx={2} />
          )}
          {dragStart !== null && dragEnd !== null && dragSelX2 > dragSelX1 && (
            <rect x={dragSelX1} y={fwdY - 6} width={dragSelX2 - dragSelX1} height={revY + 6 - (fwdY - 6)} fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4,2" rx={2} />
          )}

          {/* Backbone */}
          <text x={padL - 6} y={fwdY + 3} textAnchor="end" fontSize={10} fill="#1f2937" fontWeight="700">5′</text>
          <text x={padL + mapW + 6} y={fwdY + 3} fontSize={10} fill="#1f2937" fontWeight="700">3′</text>
          <text x={padL - 6} y={revY + 3} textAnchor="end" fontSize={10} fill="#6b7280" fontWeight="600">3′</text>
          <text x={padL + mapW + 6} y={revY + 3} fontSize={10} fill="#6b7280" fontWeight="600">5′</text>

          <line x1={padL} y1={fwdY} x2={padL + mapW} y2={fwdY} stroke="#1f2937" strokeWidth={3} strokeLinecap="round" />
          <line x1={padL} y1={revY} x2={padL + mapW} y2={revY} stroke="#9ca3af" strokeWidth={3} strokeLinecap="round" />
          
          {Array.from({ length: Math.floor(mapW / 8) + 1 }, (_, i) => {
            const x = padL + i * 8;
            if (x > padL + mapW) return null;
            return <line key={i} x1={x} y1={fwdY + 1.5} x2={x} y2={revY - 1.5} stroke="#d1d5db" strokeWidth={1.5} />;
          })}

          {isCircular && <text x={padL + mapW + 20} y={fwdY + 6} fontSize={16} fill="#64748b" fontWeight="800">↻</text>}

          {/* Features */}
          {features.map(feat => {
            const row = featureRows.get(feat.id) ?? 0;
            const y = featStartY + row * 24;
            const x1 = toX(feat.start - 1);
            const x2 = toX(feat.end);
            const w = Math.max(x2 - x1, 4);
            const arrowW = Math.min(10, w * 0.3);
            
            return (
              <g key={feat.id} style={{ cursor: 'pointer', transition: 'all 0.2s' }} onClick={(e) => { e.stopPropagation(); onFeatureClick?.(feat); }}>
                {feat.segments ? (
                  // Spliced: a block per exon, joined by a line across the
                  // introns. Drawing one bar from first to last base would
                  // claim the introns are coding.
                  <>
                    <line x1={x1} y1={y + 9} x2={x2} y2={y + 9} stroke={feat.color} strokeWidth={1.5} opacity={0.65} />
                    {feat.segments.map((seg, si) => {
                      const sx1 = toX(seg.start - 1);
                      const sx2 = toX(seg.end);
                      const sw = Math.max(sx2 - sx1, 2);
                      // The arrow goes on the terminal exon, pointing the way
                      // the feature is transcribed.
                      const terminal = feat.strand === 1 ? si === feat.segments!.length - 1 : si === 0;
                      const aw = terminal ? Math.min(10, sw * 0.5) : 0;
                      const d = feat.strand === 1
                        ? `M${sx1},${y} L${sx2 - aw},${y} L${sx2},${y + 9} L${sx2 - aw},${y + 18} L${sx1},${y + 18} Z`
                        : `M${sx1 + aw},${y} L${sx2},${y} L${sx2},${y + 18} L${sx1 + aw},${y + 18} L${sx1},${y + 9} Z`;
                      return (
                        <path key={si} d={d} fill={feat.color} opacity={0.85} stroke={feat.color} strokeWidth={1.5} strokeLinejoin="round" />
                      );
                    })}
                  </>
                ) : feat.strand === 1 ? (
                  <path d={`M${x1},${y} L${x2 - arrowW},${y} L${x2},${y + 9} L${x2 - arrowW},${y + 18} L${x1},${y + 18} Z`} fill={feat.color} opacity={0.85} stroke={feat.color} strokeWidth={1.5} strokeLinejoin="round" />
                ) : (
                  <path d={`M${x1 + arrowW},${y} L${x2},${y} L${x2},${y + 18} L${x1 + arrowW},${y + 18} L${x1},${y + 9} Z`} fill={feat.color} opacity={0.85} stroke={feat.color} strokeWidth={1.5} strokeLinejoin="round" />
                )}
                {w > 30 && (
                  <text x={x1 + w / 2} y={y + 11} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#fff" fontWeight="700" style={{ pointerEvents: 'none' }}>
                    {feat.name.length > Math.floor(w / 6) ? feat.name.slice(0, Math.floor(w / 6) - 1) + '…' : feat.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Ruler */}
          {Array.from({ length: 11 }, (_, i) => {
            const pos = Math.round((i / 10) * len);
            const x = toX(pos);
            return (
              <g key={i}>
                <line x1={x} y1={rulerY} x2={x} y2={rulerY + 6} stroke="#64748b" strokeWidth={1.5} />
                <text x={x} y={rulerY + 20} textAnchor="middle" fontSize={10} fill="#64748b" fontFamily="monospace" fontWeight="600">
                  {pos >= 1000 ? `${(pos / 1000).toFixed(1)}k` : pos}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
