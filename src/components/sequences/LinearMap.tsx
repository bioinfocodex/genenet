import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { SequenceFeature } from '../SequenceViewer';

import { chooseMapEnzymes, countCuts, siteLabel, siteTitle, type ChooseOptions } from '@/lib/map-enzymes';
import { bindingTitle, type PlacedPrimer } from '@/lib/primer-binding';
import { frameColour, orfTitle, type MapOrf } from '@/lib/map-orfs';
import { shapeFor, isSolid, labelInk, estimateTextWidth, outlineFor } from '@/lib/map-style';

export interface ReSite {
  enzyme: string;
  cutPos: number;
  /** Bottom-strand cut, same coordinates. Equal to `cutPos` for a blunt cutter. */
  cutBottom: number;
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
  /** Reading frames worth drawing, already chosen. */
  orfs?: MapOrf[];
  isCircular: boolean;
  selection?: { start: number; end: number } | null;
  onSelect?: (s: { start: number; end: number }) => void;
  onFeatureClick?: (f: SequenceFeature) => void;
}

const PAD_L = 20, PAD_R = 40;
/** Only a floor for a pane too narrow to be worth fitting to at all. */
const MIN_BOX_W = 240;
const MIN_ZOOM = 1;
/** Nothing is learned past about fourteen pixels a base, and a drawing wider
 *  than this stops being something a browser lays out quickly. */
const MAX_PX_PER_BASE = 14, MAX_DRAWING_PX = 60000;
const FEAT_H = 18;
const LABEL_FS = 10;

/** Steps a person would actually count in. */
const NICE_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

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

export default function LinearMap({ sequence, features, reSites, isCircular, selection, onSelect, onFeatureClick, enzymeDisplay, primers = [], orfs = [] }: LinearMapProps) {
  const len = sequence.length;

  /*
   * Zoom is width. The drawing is laid out at whatever width the pane gives
   * it, multiplied by the zoom, and the pane scrolls — so panning is the
   * scrollbar and the trackpad rather than a drag that would have to fight
   * with selecting bases. It also means every position stays in one
   * coordinate system: one SVG unit is one pixel at every zoom level.
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 0 until measured. Nothing is drawn at a width nobody has measured. */
  const [boxW, setBoxW] = useState(0);
  const [zoom, setZoom] = useState(1);

  /*
   * The drawing is exactly as wide as the pane, so at zoom 1 there is nothing
   * to scroll sideways to.
   *
   * Three things were stopping that. There was a 600px floor, so any pane
   * narrower than that got a drawing wider than itself. The initial width was
   * a guessed 800, which is what the first paint used whatever the pane
   * actually was. And the measurement came from `contentRect`, which does not
   * discount a scrollbar -- so once one appeared it kept the width that had
   * caused it.
   *
   * clientWidth does discount it, which makes this settle rather than
   * oscillate: at zoom 1 the content exactly fits, the scrollbar goes, the
   * pane measures ~15px wider, and the next pass fills it. The floor is now
   * low enough to be a genuine last resort -- below it a phone would get a
   * drawing it has to scroll, which is better than one squeezed past reading.
   */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBoxW(Math.max(MIN_BOX_W, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /*
   * The floor also stands in for "not measured yet". The layout effect above
   * runs before the browser paints, so this value is never seen -- it only
   * has to keep the first render's arithmetic from going negative.
   */
  const box = boxW || MIN_BOX_W;

  /*
   * How far in it is worth going. Both limits matter: a short sequence hits
   * the pixels-per-base ceiling long before the width one, and a chromosome
   * hits the width ceiling while still showing a hundred bases to the pixel.
   */
  const maxZoom = Math.max(2, Math.min(MAX_DRAWING_PX / box, (MAX_PX_PER_BASE * len) / box));

  const W = box * zoom;
  const mapW = W - PAD_L - PAD_R;
  const toX = useCallback((pos: number) => PAD_L + (pos / len) * mapW, [len, mapW]);
  const toBp = (x: number) => Math.max(1, Math.min(len, Math.round(((x - PAD_L) / mapW) * len)));

  /*
   * Zooming keeps the base under the cursor under the cursor, which means the
   * scroll position has to be set from the new width — after the browser has
   * laid it out, not before.
   */
  const anchor = useRef<{ bp: number; offset: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const el = wrapRef.current;
    if (!a || !el) return;
    const xAtNewZoom = PAD_L + (a.bp / len) * (box * zoom - PAD_L - PAD_R);
    el.scrollLeft = xAtNewZoom - a.offset;
  }, [zoom, boxW, len]);

  const zoomBy = useCallback((factor: number, at?: { bp: number; offset: number }) => {
    // The anchor is recorded here rather than inside the updater: a state
    // updater has to be pure, and React runs it twice in development.
    const next = Math.min(maxZoom, Math.max(MIN_ZOOM, zoom * factor));
    if (next === zoom) return;
    if (at) anchor.current = at;
    setZoom(next);
  }, [zoom, maxZoom]);

  /*
   * Pinch, or ctrl/cmd and the wheel — never the wheel on its own, which
   * belongs to the page. A plain sideways wheel still scrolls the map, which
   * is what panning is here.
   *
   * Attached by hand because React's own wheel listener is passive, and a
   * passive listener cannot preventDefault.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      const bp = ((el.scrollLeft + offset - PAD_L) / (box * zoom - PAD_L - PAD_R)) * len;
      zoomBy(Math.exp(-e.deltaY * 0.003), { bp: Math.max(0, Math.min(len, bp)), offset });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, boxW, zoom, len]);

  /*
   * The x range actually on screen.
   *
   * The ruler, the grid and the rungs between the strands are drawn one per
   * so-many pixels, which was harmless when the drawing was always 800px
   * wide. Zoom made those loops unbounded: at 60x a 5 kb plasmid wanted
   * twelve thousand rungs and a thousand ruler ticks, all but a screenful of
   * them scrolled out of sight. Only the visible span is built, with a margin
   * so scrolling does not show a bare edge before the next render.
   */
  const [span, setSpan] = useState({ x0: 0, x1: Infinity });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSpan({ x0: el.scrollLeft - 300, x1: el.scrollLeft + el.clientWidth + 300 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [zoom, boxW]);

  const onScreen = useCallback((x: number) => x >= span.x0 && x <= span.x1, [span]);

  const featureRows = assignRows(features);
  const maxRow = features.length > 0 ? Math.max(...featureRows.values()) + 1 : 0;

  /*
   * Which names fit inside their own glyph and which have to be written above
   * it. A promoter and a terminator are lines rather than blocks, so there is
   * no inside to write in whatever the zoom; everything else is a question of
   * whether the name is narrower than the arrow at this width.
   *
   * The old rule drew a name only when the arrow was over 30px wide and cut
   * it short at roughly one character per 6px. On a 5 kb plasmid at fit width
   * that silently renamed "AmpR promoter" to "AmpR pr…" and left a 27 bp tag
   * with no name at all.
   */
  const featureLabels = useMemo(() => {
    const inside = new Map<string, string>();
    const above: { f: SequenceFeature; row: number; x: number; width: number; anchorX: number }[] = [];

    for (const f of features) {
      const shape = shapeFor(f.type);
      const x1 = toX(f.start - 1), x2 = toX(f.end);
      const w = Math.max(x2 - x1, 4);
      const width = estimateTextWidth(f.name, LABEL_FS, true);
      // Spliced features are excluded for the same reason as promoters: the
      // span is mostly intron, so a name across it sits in the gaps.
      if (isSolid(shape) && !f.segments && w >= width + 10) {
        inside.set(f.id, labelInk(f.color));
      } else {
        const centre = x1 + w / 2;
        above.push({ f, row: featureRows.get(f.id) ?? 0, x: centre, width, anchorX: centre });
      }
    }

    /*
     * Two narrow features side by side put two names in the same place, so
     * within a row the labels are walked left to right and pushed clear of
     * each other. A label that had to move gets a tick back down to the
     * feature it names, because a name that is no longer over its own arrow
     * is only useful if it says which arrow it belongs to.
     */
    const byRow = new Map<number, typeof above>();
    for (const a of above) {
      if (!byRow.has(a.row)) byRow.set(a.row, []);
      byRow.get(a.row)!.push(a);
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.x - b.x);
      let edge = 2;
      for (const a of row) {
        if (a.x - a.width / 2 < edge) a.x = edge + a.width / 2;
        edge = a.x + a.width / 2 + 6;
      }
      /*
       * Then back the other way, because pushing right compounds: by the time
       * the pass reaches the last feature on a crowded row the label is off
       * the end of the drawing, which is how "spliced reporter" disappeared
       * and "ori" came out as "or". The reverse pass pulls the overflow back
       * inside and lets the shortfall land on the labels with room to give.
       */
      let limit = W - 2;
      for (let i = row.length - 1; i >= 0; i--) {
        const a = row[i];
        if (a.x + a.width / 2 > limit) a.x = limit - a.width / 2;
        limit = a.x - a.width / 2 - 6;
      }
      /*
       * A row that genuinely cannot hold all its names is a real situation --
       * this one holds twelve at fit width -- and the reverse pass propagates
       * the shortfall until something falls off the left edge. Better every
       * name present and two of them touching than one silently gone; zoom is
       * what actually resolves it.
       */
      for (const a of row) {
        a.x = Math.max(a.width / 2 + 2, Math.min(W - a.width / 2 - 2, a.x));
      }
    }

    return { inside, above, hasAbove: above.length > 0 };
  }, [features, featureRows, toX, W]);

  const mapSites = useMemo(
    () => chooseMapEnzymes(reSites, countCuts(reSites), enzymeDisplay),
    [reSites, enzymeDisplay],
  );

  /*
   * Where each site's label goes, worked out before the drawing has a height.
   *
   * Labels stack upward from the strands, and the band they stack into was a
   * fixed 40px -- room for three rows. A fourth landed at y = 1 and a fifth at
   * y = -10, off the top of the SVG entirely: the site was found, chosen,
   * counted in "23 sites drawn", and then clipped out of the picture with
   * nothing to say it had been. The band is now however tall the stack turns
   * out to need.
   */
  const siteLabels = useMemo(() => {
    const rows: number[] = [];       // right-hand edge used so far, per row
    const placed = mapSites.map(s => {
      const x = toX(s.cutPos);
      const label = siteLabel(s);
      const halfWidth = estimateTextWidth(label, 9, s.cuts === 1) / 2 + 4;
      let row = rows.findIndex(edge => x - halfWidth > edge);
      if (row === -1) { row = rows.length; rows.push(0); }
      rows[row] = x + halfWidth;
      return { s, x, label, row };
    });
    return { placed, rowCount: rows.length };
  }, [mapSites, toX]);

  // Layout Y positions
  const reAreaH = Math.max(40, siteLabels.rowCount * 11 + 14);
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
  // Rows are taller when a name has to sit above a glyph rather than in it.
  const rowH = featureLabels.hasAbove ? 30 : 24;
  const featStartY = primerY + primerH + (primerRows.count ? 8 : 2) + (featureLabels.hasAbove ? 8 : 0);
  const featH = maxRow * rowH;

  /*
   * ORFs get a band under the features. Grouped by frame rather than packed by
   * position: on a linear map the row a reading frame sits in is information —
   * two ORFs on one row are in the same frame — and packing them by whatever
   * fits would throw that away.
   */
  const orfFrames = useMemo(() => {
    const present = [...new Set(orfs.map(o => o.frame))].sort((a, b) => b - a);
    return { order: present, rowOf: new Map(present.map((f, i) => [f, i])) };
  }, [orfs]);

  const orfY = featStartY + featH + (orfs.length ? 10 : 0);
  const orfH = orfFrames.order.length * 12;
  const rulerY = orfY + orfH + 12;
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

  const selX1 = selection ? toX(selection.start - 1) : 0;
  const selX2 = selection ? toX(selection.end) : 0;
  const dragSelX1 = (dragStart && dragEnd) ? toX(Math.min(dragStart, dragEnd) - 1) : 0;
  const dragSelX2 = (dragStart && dragEnd) ? toX(Math.max(dragStart, dragEnd)) : 0;

  /*
   * Ruler marks at round positions, spaced by how much room there is.
   *
   * Eleven equal divisions of the length labels a 3,686 bp plasmid at 0.4k,
   * 0.7k, 1.1k — numbers nobody is looking for, at a precision that hides
   * which base they are. The circular map fixed this; the linear one is where
   * people read positions off, and it never got the same treatment.
   */
  const ticks = useMemo(() => {
    const target = Math.max(2, Math.round(mapW / 90));
    const step = NICE_STEPS.find(x => len / x <= target) ?? Math.ceil(len / target);
    const out: number[] = [];
    for (let pos = 0; pos < len; pos += step) out.push(pos);
    // The end of the molecule is a position worth marking whatever the step.
    if (len - out[out.length - 1] > step * 0.35) out.push(len);
    return { positions: out, step };
  }, [len, mapW]);

  const tickLabel = (pos: number) => {
    // Position 0 does not exist: GenBank, the sequence view and the feature
    // table all count from 1.
    const shown = pos === 0 ? 1 : pos;
    return ticks.step >= 1000 && shown % 1000 === 0 ? `${shown / 1000}k` : shown.toLocaleString();
  };

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 26, minWidth: 26, padding: '0 0.4rem', background: 'white',
    border: '1px solid var(--glass-border)', cursor: 'pointer',
    fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit', color: 'var(--text-muted)',
  };

  /** The glyph for one feature, at one row, in its own colour. */
  function featureBody(f: SequenceFeature, y: number) {
    const shape = shapeFor(f.type);
    const x1 = toX(f.start - 1);
    const x2 = toX(f.end);
    const w = Math.max(x2 - x1, 4);
    const mid = y + FEAT_H / 2;

    if (f.segments) {
      // Spliced: a block per exon, joined by a line across the introns.
      // Drawing one bar from first to last base would claim the introns are
      // coding.
      return (
        <>
          <line x1={x1} y1={mid} x2={x2} y2={mid} stroke={f.color} strokeWidth={1.5} opacity={0.65} />
          {f.segments.map((seg, si) => {
            const sx1 = toX(seg.start - 1);
            const sx2 = toX(seg.end);
            const sw = Math.max(sx2 - sx1, 2);
            // The arrow goes on the terminal exon, pointing the way the
            // feature is transcribed.
            const terminal = f.strand === 1 ? si === f.segments!.length - 1 : si === 0;
            const aw = terminal && shape === 'arrow' ? Math.min(10, sw * 0.5) : 0;
            const d = f.strand === 1
              ? `M${sx1},${y} L${sx2 - aw},${y} L${sx2},${mid} L${sx2 - aw},${y + FEAT_H} L${sx1},${y + FEAT_H} Z`
              : `M${sx1 + aw},${y} L${sx2},${y} L${sx2},${y + FEAT_H} L${sx1 + aw},${y + FEAT_H} L${sx1},${mid} Z`;
            return <path key={si} d={d} fill={f.color} opacity={0.85} stroke={f.color} strokeWidth={1.5} strokeLinejoin="round" />;
          })}
        </>
      );
    }

    if (shape === 'promoter') {
      /*
       * A bent arrow standing on the transcription start site. The stem is
       * the informative half: it marks the base transcription begins at,
       * which a filled block over the whole annotation does not.
       */
      const head = Math.min(8, Math.max(4, w * 0.4));
      const armY = y + 2;
      const stemX = f.strand === 1 ? x1 : x2;
      const tipX = f.strand === 1 ? x2 : x1;
      const armEnd = f.strand === 1 ? tipX - head : tipX + head;
      return (
        <>
          <path d={`M${stemX},${y + FEAT_H} L${stemX},${armY} L${armEnd},${armY}`}
                fill="none" stroke={f.color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
          <polygon points={`${tipX},${armY} ${armEnd},${armY - 4} ${armEnd},${armY + 4}`} fill={f.color} />
        </>
      );
    }

    if (shape === 'terminator') {
      // A stem with a crossbar: termination has a position but no direction,
      // so the glyph has no head. A 30 bp terminator still gets a bar wide
      // enough to see, because what matters is that it is there.
      const cx = x1 + w / 2;
      const half = Math.max(5, w / 2);
      return (
        <>
          <path d={`M${cx},${y + FEAT_H} L${cx},${y + 3}`} fill="none" stroke={f.color} strokeWidth={2.25} strokeLinecap="round" />
          <path d={`M${cx - half},${y + 3} L${cx + half},${y + 3}`} fill="none" stroke={f.color} strokeWidth={3.25} strokeLinecap="round" />
        </>
      );
    }

    if (shape === 'origin') {
      // Outlined rather than filled: replication starts here, it is not a
      // stretch of sequence doing something along its length.
      return (
        <rect x={x1} y={y + 2} width={w} height={FEAT_H - 4} rx={(FEAT_H - 4) / 2}
              fill={f.color} fillOpacity={0.2} stroke={f.color} strokeWidth={1.75} />
      );
    }

    if (shape === 'block') {
      // Extent without direction: a tag, a UTR, an MCS, anything unclassified.
      // An arrowhead on one of those is an assertion nobody made.
      return <rect x={x1} y={y} width={w} height={FEAT_H} rx={2} fill={f.color} opacity={0.85} stroke={f.color} strokeWidth={1.5} />;
    }

    const arrowW = Math.min(10, w * 0.3);
    const d = f.strand === 1
      ? `M${x1},${y} L${x2 - arrowW},${y} L${x2},${mid} L${x2 - arrowW},${y + FEAT_H} L${x1},${y + FEAT_H} Z`
      : `M${x1 + arrowW},${y} L${x2},${y} L${x2},${y + FEAT_H} L${x1 + arrowW},${y + FEAT_H} L${x1},${mid} Z`;
    return <path d={d} fill={f.color} opacity={0.85} stroke={f.color} strokeWidth={1.5} strokeLinejoin="round" />;
  }

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '1rem', border: '1px solid var(--glass-border)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex' }}>
          <button onClick={() => zoomBy(1.6)} title="Zoom in — or pinch / ctrl-scroll on the map" style={{ ...btn, borderRadius: '6px 0 0 6px' }}>+</button>
          <button onClick={() => zoomBy(1 / 1.6)} title="Zoom out" style={{ ...btn, borderRadius: 0, borderLeft: 'none' }}>−</button>
          <button
            onClick={() => { setZoom(1); if (wrapRef.current) wrapRef.current.scrollLeft = 0; }}
            disabled={zoom === 1}
            title={zoom === 1 ? 'Already showing the whole molecule' : 'Back to the whole molecule'}
            style={{ ...btn, borderRadius: '0 6px 6px 0', borderLeft: 'none', fontWeight: 600, fontSize: '0.7rem', opacity: zoom === 1 ? 0.45 : 1, cursor: zoom === 1 ? 'default' : 'pointer' }}
          >
            Fit
          </button>
        </div>
        {zoom !== 1 && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}× · {Math.round(len / zoom).toLocaleString()} bp across
          </span>
        )}
      </div>

      <div ref={wrapRef} style={{ overflowX: 'auto', marginBottom: '0.5rem', overscrollBehaviorX: 'contain' }}>
        <svg
          width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`}
          style={{ display: 'block', cursor: dragStart !== null ? 'ew-resize' : 'crosshair', userSelect: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid lines, on the same round positions the ruler is labelled at */}
          {ticks.positions.filter(pos => onScreen(toX(pos))).map((pos, i) => (
            <line key={`grid-${i}`} x1={toX(pos)} y1={0} x2={toX(pos)} y2={svgH} stroke="rgba(0,0,0,0.03)" strokeWidth={1} />
          ))}

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
                  const nameW = estimateTextWidth(p.name, 8, true);
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

          {/* Open reading frames */}
          {orfs.map((o, i) => {
            const row = orfFrames.rowOf.get(o.frame) ?? 0;
            const y = orfY + row * 12;
            const x1 = toX(o.start), x2 = toX(o.end + 1);
            const w = Math.max(2, x2 - x1);
            const head = Math.min(7, w * 0.25);
            const colour = frameColour(o.frame);
            const shape = o.strand === '+'
              ? `${x1},${y - 3.5} ${x1 + w - head},${y - 3.5} ${x1 + w},${y} ${x1 + w - head},${y + 3.5} ${x1},${y + 3.5}`
              : `${x1 + w},${y - 3.5} ${x1 + head},${y - 3.5} ${x1},${y} ${x1 + head},${y + 3.5} ${x1 + w},${y + 3.5}`;
            return (
              <g key={`orf-${i}`} style={{ cursor: 'help' }}>
                <title>{orfTitle(o)}</title>
                <polygon points={shape} fill={colour} opacity={o.coveredBy ? 0.3 : 0.8} />
              </g>
            );
          })}
          {/* Frame labels, so a row means something */}
          {orfFrames.order.map((f, i) => (
            <text key={`fl-${f}`} x={2} y={orfY + i * 12 + 3} fontSize={7.5}
                  fill={frameColour(f)} fontWeight="700" fontFamily="monospace">
              {f > 0 ? `+${f}` : f}
            </text>
          ))}

          {/* RE sites */}
          {(() => {
            /*
             * The same selection the circular map uses, for the same reason: a
             * 450-enzyme scan produces thousands of cuts, and drawing a line
             * for each one is both unreadable and thousands of SVG nodes.
             *
             * The stacking itself happens above, where the height needed it.
             */
            return siteLabels.placed.map(({ s, x, label, row }, i) => {
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
                  {/* Bold means it cuts once: a cloning site rather than a fact. */}
                  <text x={x} y={labelY} textAnchor="middle" fontSize={9} fill={s.color} fontWeight={s.cuts === 1 ? 800 : 400} fontFamily="monospace">
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
                <text x={tx} y={ty - 14} textAnchor="middle" fontSize={9} fill="#94a3b8">Cut: {hoveredRE.pos.toLocaleString()}{hoveredRE.overhangType ? ` (${hoveredRE.overhangType})` : ''}</text>
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
          <text x={PAD_L - 6} y={fwdY + 3} textAnchor="end" fontSize={10} fill="#1f2937" fontWeight="700">5′</text>
          <text x={PAD_L + mapW + 6} y={fwdY + 3} fontSize={10} fill="#1f2937" fontWeight="700">3′</text>
          <text x={PAD_L - 6} y={revY + 3} textAnchor="end" fontSize={10} fill="#6b7280" fontWeight="600">3′</text>
          <text x={PAD_L + mapW + 6} y={revY + 3} fontSize={10} fill="#6b7280" fontWeight="600">5′</text>

          <line x1={PAD_L} y1={fwdY} x2={PAD_L + mapW} y2={fwdY} stroke="#1f2937" strokeWidth={3} strokeLinecap="round" />
          <line x1={PAD_L} y1={revY} x2={PAD_L + mapW} y2={revY} stroke="#9ca3af" strokeWidth={3} strokeLinecap="round" />

          {(() => {
            // The rungs between the strands, every 8px of whatever is on screen.
            const from = Math.max(PAD_L, Math.floor((span.x0 - PAD_L) / 8) * 8 + PAD_L);
            const to = Math.min(PAD_L + mapW, span.x1);
            const out = [];
            for (let x = from; x <= to; x += 8) {
              out.push(<line key={x} x1={x} y1={fwdY + 1.5} x2={x} y2={revY - 1.5} stroke="#d1d5db" strokeWidth={1.5} />);
            }
            return out;
          })()}

          {isCircular && <text x={PAD_L + mapW + 20} y={fwdY + 6} fontSize={16} fill="#64748b" fontWeight="800">↻</text>}

          {/* Features */}
          {features.map(feat => {
            const row = featureRows.get(feat.id) ?? 0;
            const y = featStartY + row * rowH;
            const x1 = toX(feat.start - 1);
            const x2 = toX(feat.end);
            const w = Math.max(x2 - x1, 4);
            const ink = featureLabels.inside.get(feat.id);

            return (
              <g key={feat.id} style={{ cursor: 'pointer', transition: 'all 0.2s' }} onClick={(e) => { e.stopPropagation(); onFeatureClick?.(feat); }}>
                <title>{`${feat.name} — ${feat.type}, ${feat.start}–${feat.end} (${feat.strand === 1 ? '+' : '−'})`}</title>
                {featureBody(feat, y)}
                {/*
                  * Written in whichever of white and near-black can be read
                  * against this feature's own colour. It was always white,
                  * which on the palette's amber and lime is a name you cannot
                  * make out at all.
                  */}
                {ink && (
                  <text x={x1 + w / 2} y={y + FEAT_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={LABEL_FS} fill={ink} fontWeight="700" style={{ pointerEvents: 'none' }}>
                    {feat.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Names that did not fit inside their glyph */}
          {featureLabels.above.map(({ f, row, x, anchorX }) => {
            const y = featStartY + row * rowH;
            const moved = Math.abs(x - anchorX) > 1;
            // Darker than the fill: out here the page is the background, and
            // the pastels that make the blocks legible are invisible on white.
            const ink = outlineFor(f.color, 0.4);
            return (
              <g key={`lbl-${f.id}`} onClick={(e) => { e.stopPropagation(); onFeatureClick?.(f); }} style={{ cursor: 'pointer' }}>
                <title>{`${f.name} — ${f.type}, ${f.start}–${f.end} (${f.strand === 1 ? '+' : '−'})`}</title>
                {moved && <line x1={anchorX} y1={y - 1} x2={x} y2={y - 7} stroke={ink} strokeWidth={0.75} opacity={0.5} />}
                <text x={x} y={y - 4} textAnchor="middle" fontSize={LABEL_FS - 1} fill={ink} fontWeight="700">
                  {f.name}
                </text>
              </g>
            );
          })}

          {/* Ruler */}
          {ticks.positions.filter(pos => onScreen(toX(pos))).map((pos, i) => {
            const x = toX(pos);
            return (
              <g key={i}>
                <line x1={x} y1={rulerY} x2={x} y2={rulerY + 6} stroke="#64748b" strokeWidth={1.5} />
                <text x={x} y={rulerY + 20} textAnchor="middle" fontSize={10} fill="#64748b" fontFamily="monospace" fontWeight="600">
                  {tickLabel(pos)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
