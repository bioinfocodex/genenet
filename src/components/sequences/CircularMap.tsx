import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { SequenceFeature } from '../SequenceViewer';
import type { ReSite } from './LinearMap'; // reused type
import { chooseMapEnzymes, countCuts, siteLabel, siteTitle, type ChooseOptions } from '@/lib/map-enzymes';
import { bindingTitle, type PlacedPrimer } from '@/lib/primer-binding';
import { frameColour, orfTitle, type MapOrf } from '@/lib/map-orfs';
import { shapeFor, isSolid, labelInk, estimateTextWidth, outlineFor } from '@/lib/map-style';

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
  /** Reading frames worth drawing, already chosen. */
  orfs?: MapOrf[];
}

// Fixed layout. Outside the component because none of it varies per render.
const SVG = 800;
const CX = SVG / 2, CY = SVG / 2;
const R_OUT = 220;
const R_IN = 210;
const TRACK_W = 18;

/** Feature names, and the enzyme labels they share a column with. */
const LABEL_FS = 9;
const SITE_FS = 10;

const MIN_ZOOM = 0.5, MAX_ZOOM = 8;

/** A point on the circle, as SVG path coordinates. */
const p = (r: number, a: number) => `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`;

/** SVG's large-arc flag for a sweep from a1 to a2 going forwards. */
const large = (a1: number, a2: number) => (((a2 - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) > Math.PI ? 1 : 0;

/**
 * A label that did not fit inside the thing it names, and so has to be written
 * outside the drawing with a line back to it.
 *
 * Feature names and restriction sites share one list because they share one
 * column: laying them out separately puts "AmpR" and "EcoRI" at the same height
 * on the same side, each correctly placed with respect to its own kind.
 */
interface OutsideLabel {
  key: string;
  /** Where on the circle the thing being named sits. */
  angle: number;
  /** Radius the leader line starts at -- the outer edge of the glyph. */
  anchorR: number;
  text: string;
  colour: string;
  title: string;
  mono: boolean;
  fontSize: number;
  /** Bold. For a site it means a unique cutter; feature names are always bold. */
  strong: boolean;
  /** A tick drawn across the backbone, for a cut that lands on it. */
  tick?: boolean;
  feature?: SequenceFeature;
}

export default function CircularMap({ sequence, features, reSites, selection, onSelect, onFeatureClick, name, onAddFeature, enzymeDisplay, primers = [], orfs = [] }: CircularMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /*
   * Zoom and pan are one piece of state, not two.
   *
   * Zooming about the cursor changes both together, and as two states that
   * meant calling setPan from inside the setZoom updater -- a side effect in a
   * reducer, which React runs twice in development, so every zoom shifted the
   * view by twice what it should and the map wandered off its own canvas.
   */
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const { zoom } = view;
  const pan = view;
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
    for (const pr of primers) {
      let row = edges.findIndex(edge => pr.start > edge);
      if (row === -1) { row = edges.length; edges.push(0); }
      edges[row] = pr.wrapsOrigin ? Infinity : pr.end;
      rowOf.set(`${pr.id}:${pr.start}`, row);
    }
    return { rowOf, count: edges.length };
  }, [primers]);

  const R_PRIMER = R_OUT + (fwdTracks.numTracks * TRACK_W) + 10;
  const R_PRIMER_TOP = R_PRIMER + Math.max(0, primerRows.count - 1) * 9;

  /*
   * ORFs sit outside the primers on their own rows. Reading frames overlap
   * each other constantly — that is what six-frame translation means — so they
   * are stacked rather than drawn on one line, and the stack height has to be
   * known before the enzyme labels choose a radius.
   */
  const orfRows = useMemo(() => {
    const edges: number[] = [];
    const rowOf = new Map<string, number>();
    for (const o of orfs) {
      let row = edges.findIndex(edge => o.start > edge);
      if (row === -1) { row = edges.length; edges.push(0); }
      edges[row] = o.end;
      rowOf.set(`${o.frame}:${o.start}`, row);
    }
    return { rowOf, count: edges.length };
  }, [orfs]);

  const R_ORF = R_PRIMER_TOP + (primerRows.count ? 12 : 4);
  const R_ORF_TOP = R_ORF + Math.max(0, orfRows.count - 1) * 8;
  const R_RULER = R_IN - (revTracks.numTracks * TRACK_W) - 12;
  const R_GC_OUT = R_RULER - 14;
  const R_GC_IN = R_GC_OUT - 40;

  /** Outside everything drawn on rings, whatever height they turned out to need. */
  const R_LBL = R_ORF_TOP + 22;

  // Stable for a given sequence length, so the GC memo can depend on it.
  const toAngle = useCallback((pos: number) => (pos / len) * 2 * Math.PI - Math.PI / 2, [len]);

  /**
   * The two edges of a feature's track: `near` faces the backbone, `far` faces
   * away from it. Forward features sit outside the ring and reverse ones
   * inside, so "away from the backbone" is outward for one and inward for the
   * other — which is what decides where a promoter's arm goes.
   */
  const radii = useCallback((trackIdx: number, strand: 1 | -1) => {
    if (strand === 1) {
      const near = R_OUT + 5 + trackIdx * TRACK_W;
      return { near, far: near + TRACK_W - 4, ri: near, ro: near + TRACK_W - 4 };
    }
    const near = R_IN - 5 - trackIdx * TRACK_W;
    return { near, far: near - TRACK_W + 4, ri: near - TRACK_W + 4, ro: near };
  }, []);

  /** Where a feature ends, unwrapped, so arithmetic on it stays monotonic. */
  const spanOf = useCallback((f: { start: number; end: number }) => {
    const end = f.end < f.start ? f.end + len : f.end;
    return { a1: toAngle(f.start - 1), a2: toAngle(end), bases: end - (f.start - 1) };
  }, [toAngle, len]);

  /** The line an intron is drawn as: a thin arc across the feature's whole span. */
  function intronArcPath(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1): string {
    const adjustedEnd = featEnd < featStart ? featEnd + len : featEnd;
    const a1 = toAngle(featStart - 1);
    const a2 = toAngle(adjustedEnd);
    const { ri, ro } = radii(trackIdx, strand);
    const rm = (ri + ro) / 2;
    const q = (a: number) => `${CX + rm * Math.cos(a)},${CY + rm * Math.sin(a)}`;
    return `M${q(a1)} A${rm},${rm} 0 ${large(a1, a2)} 1 ${q(a2)}`;
  }

  /** A block with a point on its 3' end: coding sequences and anything transcribed. */
  function featureArcPath(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1): string {
    const adjustedEnd = featEnd < featStart ? featEnd + len : featEnd;
    const frac = (adjustedEnd - featStart) / len;
    const a1 = toAngle(featStart - 1);
    const a2 = toAngle(adjustedEnd);
    const { ri, ro } = radii(trackIdx, strand);

    const arrowAngle = Math.min(18, (frac * 2 * Math.PI * ro) * 0.4) / ro;
    const rm = (ro + ri) / 2;

    if (strand === 1) {
      const bodyEnd = a2 - arrowAngle;
      const bLarge = large(a1, bodyEnd);
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
      const bLarge = large(bodyStart, a2);
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

  /**
   * A plain band with square ends. What a feature is when it has extent but no
   * direction — a tag, a UTR, an MCS, anything whose type the file did not say.
   * An arrowhead on one of those is an assertion nobody made.
   */
  function blockArcPath(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1): string {
    const adjustedEnd = featEnd < featStart ? featEnd + len : featEnd;
    const a1 = toAngle(featStart - 1);
    const a2 = toAngle(adjustedEnd);
    const { ri, ro } = radii(trackIdx, strand);
    const f = large(a1, a2);
    return [
      `M${p(ro, a1)}`,
      `A${ro},${ro} 0 ${f},1 ${p(ro, a2)}`,
      `L${p(ri, a2)}`,
      `A${ri},${ri} 0 ${f},0 ${p(ri, a1)}`,
      'Z',
    ].join(' ');
  }

  /**
   * A bent arrow: a stem standing on the backbone at the transcription start
   * site, an arm along the track, a head pointing downstream. The stem is the
   * informative part — it marks the base transcription actually begins at,
   * which a filled block spanning the whole annotation does not.
   */
  function promoterGlyph(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1) {
    const { a1, a2 } = spanOf({ start: featStart, end: featEnd });
    const { near, far } = radii(trackIdx, strand);
    const span = Math.abs(a2 - a1);

    const start = strand === 1 ? a1 : a2;   // 5' end: where the stem stands
    const stop = strand === 1 ? a2 : a1;    // 3' end: where the head points
    const headA = Math.min(0.07, span * 0.45);
    const armEnd = strand === 1 ? stop - headA : stop + headA;
    const sweep = strand === 1 ? 1 : 0;
    const arcLarge = strand === 1 ? large(start, armEnd) : large(armEnd, start);

    const arm = `M${p(near, start)} L${p(far, start)} A${far},${far} 0 ${arcLarge},${sweep} ${p(far, armEnd)}`;
    const head = [
      p(far, stop),
      `${CX + (far - 4) * Math.cos(armEnd)},${CY + (far - 4) * Math.sin(armEnd)}`,
      `${CX + (far + 4) * Math.cos(armEnd)},${CY + (far + 4) * Math.sin(armEnd)}`,
    ].join(' ');

    return { arm, head };
  }

  /**
   * A stem with a crossbar. Termination has a position but no direction, so
   * the glyph has no head — and a terminator annotated over 30 bases still
   * gets a bar wide enough to see, because what matters is that it is there.
   */
  function terminatorGlyph(featStart: number, featEnd: number, trackIdx: number, strand: 1 | -1) {
    const { a1, a2 } = spanOf({ start: featStart, end: featEnd });
    const { near, far } = radii(trackIdx, strand);
    const mid = (a1 + a2) / 2;
    const minHalf = 5 / far;
    const half = Math.max(minHalf, (a2 - a1) / 2);
    const b1 = mid - half, b2 = mid + half;
    return {
      stem: `M${p(near, mid)} L${p(far, mid)}`,
      bar: `M${p(far, b1)} A${far},${far} 0 ${large(b1, b2)},1 ${p(far, b2)}`,
    };
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

  /*
   * Which feature names fit inside their own glyph, and which have to be
   * written outside on a leader line.
   *
   * The old test was `end - start > 60` — a length in bases, deciding a
   * question about pixels. Sixty bases is a third of a millimetre of arc on a
   * 10 kb plasmid, so the name was drawn anyway and ran over its neighbours;
   * below sixty the feature got no name at all, which is how a 27 bp His-tag
   * ended up as an unlabelled sliver. Measuring the name against the arc it
   * has to sit in answers the question that was actually being asked, and
   * everything that fails it gets a label outside rather than nothing.
   */
  const featureLabels = useMemo(() => {
    const inside = new Map<string, { x: number; y: number; ink: string; deg: number }>();
    const outside: OutsideLabel[] = [];

    for (const feat of features) {
      const trackIdx = (feat.strand === 1 ? fwdTracks.map : revTracks.map).get(feat.id) ?? 0;
      const { a1, a2 } = spanOf(feat);
      const { ri, ro, far } = radii(trackIdx, feat.strand);
      const rMid = (ri + ro) / 2;
      const midA = (a1 + a2) / 2;

      const shape = shapeFor(feat.type);
      const width = estimateTextWidth(feat.name, LABEL_FS, true);
      const arcLen = Math.abs(a2 - a1) * rMid;

      /*
       * A promoter or a terminator is a line, not a band: there is no inside
       * to write in, however long the feature is. Nor is a spliced feature —
       * its span is mostly intron, and a name written across it falls in the
       * gaps between exons, where white-on-white left "spliced reporter"
       * showing as "repo".
       */
      if (isSolid(shape) && !feat.segments && arcLen >= width + 8) {
        /*
         * Turned to lie along the arc, then flipped where that would leave it
         * upside down.
         *
         * Written horizontally it only fits where the ring happens to run
         * horizontally — at three o'clock a name crosses a band fourteen
         * pixels wide, so "EGFP" sat half on the feature and half on the page
         * behind it. Along the arc the only room that matters is the arc's,
         * which is the room the test above measures.
         */
        let deg = ((midA * 180) / Math.PI + 90) % 360;
        if (deg < 0) deg += 360;
        if (deg > 90 && deg < 270) deg -= 180;
        inside.set(feat.id, {
          x: CX + rMid * Math.cos(midA),
          y: CY + rMid * Math.sin(midA),
          ink: labelInk(feat.color),
          deg,
        });
      } else {
        outside.push({
          key: `feat-${feat.id}`,
          angle: midA,
          anchorR: feat.strand === 1 ? far : ro,
          text: feat.name,
          /*
           * A darker cast of the fill, not the fill.
           *
           * Feature colours are pastels now -- that is what makes a dozen of
           * them legible side by side on the ring -- and #d4d4d4 written on
           * white is a name nobody can read. Inside the glyph the fill is the
           * background and the ink is chosen against it; out here the page is
           * the background, so the fill has to become the ink.
           */
          colour: outlineFor(feat.color, 0.4),
          title: `${feat.name} — ${feat.type}, ${feat.start}–${feat.end} (${feat.strand === 1 ? '+' : '−'})`,
          mono: false,
          fontSize: LABEL_FS,
          strong: true,
          feature: feat,
        });
      }
    }
    return { inside, outside };
  }, [features, fwdTracks.map, revTracks.map, spanOf, radii]);

  /*
   * One column for every label that did not fit where it belongs.
   *
   * `chooseMapEnzymes` decides which *sites* are worth a label; the feature
   * pass above decides which *names* need one out here. Both then land in the
   * same two columns, so they are pushed apart together — laying them out
   * separately is how "AmpR" and "EcoRI" ended up at the same height.
   *
   * An earlier version sorted the labels by Y and then never used the
   * ordering, so the sort looked like deconfliction and did nothing: 109
   * labels landed at 32 positions.
   */
  const laidOut = useMemo(() => {
    const all: OutsideLabel[] = [
      ...featureLabels.outside,
      ...mapSites.map((s, i) => ({
        key: `site-${s.enzyme}-${i}`,
        angle: toAngle(s.cutPos),
        anchorR: R_OUT,
        text: siteLabel(s),
        colour: s.color,
        title: siteTitle(s),
        mono: true,
        fontSize: SITE_FS,
        // Bold means it cuts once: a cloning site rather than a fact.
        strong: s.cuts === 1,
        tick: true,
      })),
    ];

    const placed = all.map(l => {
      const cos = Math.cos(l.angle), sin = Math.sin(l.angle);
      return {
        l, cos, sin,
        y: CY + R_LBL * sin,
        side: cos > 0 ? 1 : -1,
        width: estimateTextWidth(l.text, l.fontSize, l.strong),
      };
    });

    const MIN_GAP = 12;
    let reach = 0;
    for (const side of [1, -1]) {
      const column = placed.filter(x => x.side === side).sort((a, b) => a.y - b.y);
      // Walk down the column pushing each label clear of the one above.
      for (let i = 1; i < column.length; i++) {
        const gap = column[i].y - column[i - 1].y;
        if (gap < MIN_GAP) column[i].y = column[i - 1].y + MIN_GAP;
      }
      /*
       * A column taller than the drawing is centred on it rather than left
       * hanging off the bottom. Shoving the overflow back up on its own put
       * the top of a long column above the canvas instead, so both ends are
       * checked and the shift is whatever brings the column back inside.
       */
      if (column.length) {
        const top = column[0].y, bottom = column[column.length - 1].y;
        const limitTop = CY - R_LBL - 6, limitBottom = CY + R_LBL + 6;
        const shift = bottom > limitBottom ? limitBottom - bottom
          : top < limitTop ? limitTop - top
          : 0;
        if (shift) for (const c of column) c.y += shift;
      }
      for (const c of column) reach = Math.max(reach, R_LBL + 12 + c.width);
    }

    /*
     * How far the drawing actually reaches, so the viewBox can be set from it.
     *
     * The box used to be a fixed 800 square. Four feature tracks plus primers
     * plus ORFs push the label column past x=760 on its own, and a name like
     * "CMV enhancer" then runs off the edge — present in the DOM, absent from
     * the picture, and absent from the exported SVG too.
     */
    const extent = Math.max(SVG / 2, reach + 8);
    return { placed, extent };
  }, [featureLabels.outside, mapSites, toAngle, R_LBL]);

  const EXTENT = laidOut.extent;

  // ─── View: zoom about the cursor, and pan ─────────────────────────────────

  const viewSize = (2 * EXTENT) / zoom;
  const viewX = CX + pan.x - viewSize / 2;
  const viewY = CY + pan.y - viewSize / 2;

  /** Screen coordinates to the drawing's own, whatever the element's size. */
  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: CX, y: CY };
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    }
    // No CTM (jsdom, a detached node): fall back to the box and the viewBox,
    // which is exact as long as preserveAspectRatio is letterboxing a square.
    const rect = svg.getBoundingClientRect();
    const scale = viewSize / Math.min(rect.width, rect.height);
    return {
      x: viewX + (clientX - rect.left - (rect.width - Math.min(rect.width, rect.height)) / 2) * scale,
      y: viewY + (clientY - rect.top - (rect.height - Math.min(rect.width, rect.height)) / 2) * scale,
    };
  }, [viewSize, viewX, viewY]);

  const zoomAbout = useCallback((factor: number, at?: { x: number; y: number }) => {
    setView(v => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      if (next === v.zoom) return v;
      if (!at) return { ...v, zoom: next };
      /*
       * Keep the point under the cursor under the cursor. Zooming about the
       * fixed centre is what the +/− buttons used to do alone, and at 3x it
       * magnifies the middle of the plasmid — which is empty — while the
       * feature ring leaves the frame entirely.
       */
      const centreX = CX + v.x, centreY = CY + v.y;
      const k = 1 - v.zoom / next;
      return {
        zoom: next,
        x: centreX + (at.x - centreX) * k - CX,
        y: centreY + (at.y - centreY) * k - CY,
      };
    });
  }, []);

  /*
   * Pinch, or ctrl/cmd and the wheel — never the wheel on its own.
   *
   * A map that zooms on a bare wheel event takes the page's scrolling away
   * from anyone whose cursor happens to be over it, which on a page this tall
   * is most of the time. macOS reports a trackpad pinch as a wheel event with
   * ctrlKey set, so the gesture people already use arrives here for free.
   *
   * Attached by hand because React registers its own wheel listener as
   * passive, and a passive listener cannot preventDefault.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;   // a plain wheel is the page's
      e.preventDefault();
      zoomAbout(Math.exp(-e.deltaY * 0.003), toUser(e.clientX, e.clientY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAbout, toUser]);

  const resetView = () => setView({ zoom: 1, x: 0, y: 0 });
  const moved = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  // ─── Interaction ──────────────────────────────────────────────────────────

  const [dragStart, setDragStart] = useState<number | null>(null);
  const panFrom = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  /**
   * The annulus the molecule is drawn in, from the GC ring out to the
   * outermost track. A drag that starts on the molecule selects bases; a drag
   * that starts on the empty middle or out among the labels moves the view.
   * Everything a drag could mean is on the ring, and everything else is canvas.
   */
  const onMolecule = (x: number, y: number) => {
    const r = Math.hypot(x - CX, y - CY);
    return r >= R_GC_IN && r <= R_ORF_TOP + 10;
  };

  const bpAt = (x: number, y: number) => {
    let angle = Math.atan2(y - CY, x - CX) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const bp = Math.round((angle / (2 * Math.PI)) * len);
    return bp === 0 ? 1 : bp;
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const at = toUser(e.clientX, e.clientY);
    if (onMolecule(at.x, at.y)) {
      const bp = bpAt(at.x, at.y);
      setDragStart(bp);
      onSelect?.({ start: bp, end: bp });
    } else {
      panFrom.current = { x: e.clientX, y: e.clientY, pan: { x: view.x, y: view.y } };
      setGrabbing(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (panFrom.current) {
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      const scale = rect ? viewSize / Math.min(rect.width, rect.height) : 1;
      const from = panFrom.current;
      setView(v => ({
        zoom: v.zoom,
        x: from.pan.x - (e.clientX - from.x) * scale,
        y: from.pan.y - (e.clientY - from.y) * scale,
      }));
      return;
    }
    if (dragStart === null) return;
    const at = toUser(e.clientX, e.clientY);
    const curr = bpAt(at.x, at.y);
    let s = dragStart, end = curr;
    // Basic circular wrap handling for selection display (always assumes forward selection for now)
    if (s > end && s - end > len / 2) { end += len; }
    else if (end > s && end - s > len / 2) { s += len; }
    onSelect?.({ start: Math.min(s, end) > len ? Math.min(s, end) % len || len : Math.min(s, end), end: Math.max(s, end) > len ? Math.max(s, end) % len || len : Math.max(s, end) });
  };

  const handleMouseUp = () => {
    setDragStart(null);
    panFrom.current = null;
    setGrabbing(false);
  };

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 30, minWidth: 30, padding: '0 0.4rem', background: 'white',
    border: '1px solid var(--glass-border)', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit', color: 'var(--text-muted)',
  };

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '1rem', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ alignSelf: 'flex-end', marginBottom: '-2rem', zIndex: 10, display: 'flex' }}>
         <button onClick={() => zoomAbout(1.25)} title="Zoom in — or pinch / ctrl-scroll on the map" style={{ ...btn, borderRadius: '8px 0 0 8px' }}>+</button>
         <button onClick={() => zoomAbout(1 / 1.25)} title="Zoom out" style={{ ...btn, borderRadius: 0, borderLeft: 'none' }}>−</button>
         <button
           onClick={resetView}
           disabled={!moved}
           title={moved ? 'Back to the whole molecule' : 'Already showing the whole molecule'}
           style={{ ...btn, borderRadius: '0 8px 8px 0', borderLeft: 'none', fontWeight: 600, fontSize: '0.7rem', opacity: moved ? 1 : 0.45, cursor: moved ? 'pointer' : 'default' }}
         >
           Fit
         </button>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`${viewX} ${viewY} ${viewSize} ${viewSize}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          display: 'block', maxWidth: SVG, aspectRatio: '1 / 1', touchAction: 'none',
          cursor: grabbing ? 'grabbing' : dragStart !== null ? 'crosshair' : 'default',
        }}
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
           // GenBank counts from 1, and so does everything else on this page.
           const shown = pos === 0 ? 1 : pos;
           return (
             <g key={i}>
               <line x1={CX + R_IN * cos} y1={CY + R_IN * sin} x2={CX + R_OUT * cos} y2={CY + R_OUT * sin} stroke="#9ca3af" strokeWidth={1.5} />
               <text x={CX + R_RULER * cos} y={CY + R_RULER * sin} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#6b7280" fontFamily="monospace" fontWeight="600">{shown >= 1000 ? `${(shown / 1000).toFixed(1)}k` : shown}</text>
             </g>
           );
        })}

        {/* Features */}
        {features.map((feat) => {
          const isFwd = feat.strand === 1;
          const map = isFwd ? fwdTracks.map : revTracks.map;
          const trackIdx = map.get(feat.id) ?? 0;
          const isHovered = hoveredId === feat.id;
          const shape = shapeFor(feat.type);
          const inside = featureLabels.inside.get(feat.id);

          /*
           * The glyph says what kind of thing this is before the name is read.
           * Everything used to be a block arrow, which claims a promoter is
           * transcribed and an origin has a direction — neither is true, and
           * both are what makes a map of a real plasmid hard to scan.
           */
          const body = (() => {
            if (feat.segments) {
              return (
                <>
                  {/* Introns first, so the exon blocks sit on top of the line. */}
                  <path d={intronArcPath(feat.start, feat.end, trackIdx, feat.strand)} fill="none" stroke={feat.color} strokeWidth={1.25} opacity={0.65} />
                  {feat.segments.map((seg, si) => {
                    // The arrowhead goes on the terminal exon only; the rest
                    // are blocks, because an intron is not a 3' end.
                    const terminal = feat.strand === 1 ? si === feat.segments!.length - 1 : si === 0;
                    const d = terminal && shape === 'arrow'
                      ? featureArcPath(seg.start, seg.end, trackIdx, feat.strand)
                      : blockArcPath(seg.start, seg.end, trackIdx, feat.strand);
                    return (
                      <path key={si} d={d} fill={feat.color} opacity={isHovered ? 1 : 0.85}
                            stroke={isHovered ? '#fff' : feat.color} strokeWidth={isHovered ? 2 : 1} strokeLinejoin="round" />
                    );
                  })}
                </>
              );
            }

            if (shape === 'promoter') {
              const { arm, head } = promoterGlyph(feat.start, feat.end, trackIdx, feat.strand);
              return (
                <>
                  <path d={arm} fill="none" stroke={feat.color} strokeWidth={isHovered ? 3 : 2.25} strokeLinecap="round" strokeLinejoin="round" opacity={isHovered ? 1 : 0.9} />
                  <polygon points={head} fill={feat.color} opacity={isHovered ? 1 : 0.9} />
                </>
              );
            }

            if (shape === 'terminator') {
              const { stem, bar } = terminatorGlyph(feat.start, feat.end, trackIdx, feat.strand);
              return (
                <>
                  <path d={stem} fill="none" stroke={feat.color} strokeWidth={isHovered ? 3 : 2.25} strokeLinecap="round" opacity={isHovered ? 1 : 0.9} />
                  <path d={bar} fill="none" stroke={feat.color} strokeWidth={isHovered ? 4 : 3.25} strokeLinecap="round" opacity={isHovered ? 1 : 0.9} />
                </>
              );
            }

            if (shape === 'origin') {
              // Outlined rather than filled: replication starts here, it is
              // not a stretch of sequence doing something along its length.
              return (
                <path d={blockArcPath(feat.start, feat.end, trackIdx, feat.strand)}
                      fill={feat.color} fillOpacity={isHovered ? 0.35 : 0.2}
                      stroke={feat.color} strokeWidth={isHovered ? 2.5 : 1.75} strokeLinejoin="round" />
              );
            }

            const d = shape === 'arrow'
              ? featureArcPath(feat.start, feat.end, trackIdx, feat.strand)
              : blockArcPath(feat.start, feat.end, trackIdx, feat.strand);
            return <path d={d} fill={feat.color} opacity={isHovered ? 1 : 0.85} stroke={isHovered ? '#fff' : feat.color} strokeWidth={isHovered ? 2 : 1} strokeLinejoin="round" />;
          })();

          return (
             <g key={feat.id}
               onMouseDown={(e) => e.stopPropagation()}
               onClick={(e) => { e.stopPropagation(); onFeatureClick?.(feat); }}
               onMouseEnter={() => setHoveredId(feat.id)}
               onMouseLeave={() => setHoveredId(null)}
               style={{ cursor: 'pointer', transition: 'all 0.2s' }}
               filter={isHovered ? 'url(#shadow)' : 'none'}
             >
               {body}
               {/*
                 * Written in whichever of white and near-black can be read
                 * against this feature's own colour. It was always white,
                 * which on the palette's amber and lime is a name you cannot
                 * make out at all.
                 */}
               {inside && (
                 <text x={inside.x} y={inside.y} textAnchor="middle" dominantBaseline="central"
                       transform={`rotate(${inside.deg} ${inside.x} ${inside.y})`}
                       fontSize={LABEL_FS} fill={inside.ink} fontWeight="700" style={{ pointerEvents: 'none' }}>
                   {feat.name}
                 </text>
               )}
             </g>
          );
        })}

        {/* Open reading frames */}
        {orfs.map((o, i) => {
          /*
           * Thin arcs, coloured by frame. Only the frames chosen upstream get
           * here — by default the ones with no annotated CDS over them, since
           * an ORF under a gene someone already drew is not news.
           */
          const row = orfRows.rowOf.get(`${o.frame}:${o.start}`) ?? 0;
          const r = R_ORF + row * 8;
          const a1 = toAngle(o.start);
          const a2 = toAngle(o.end + 1);
          const sweep = o.strand === '+' ? 1 : 0;
          const from = o.strand === '+' ? a1 : a2;
          const to = o.strand === '+' ? a2 : a1;
          const colour = frameColour(o.frame);

          return (
            <g key={`orf-${o.frame}-${o.start}-${i}`} style={{ cursor: 'help' }}>
              <title>{orfTitle(o)}</title>
              <path
                d={`M ${CX + r * Math.cos(from)} ${CY + r * Math.sin(from)} A ${r} ${r} 0 ${large(a1, a2)} ${sweep} ${CX + r * Math.cos(to)} ${CY + r * Math.sin(to)}`}
                fill="none"
                stroke={colour}
                strokeWidth={o.coveredBy ? 2 : 3.5}
                // An ORF already annotated is drawn faintly: present if someone
                // asked for it, never competing with the one that is news.
                opacity={o.coveredBy ? 0.3 : 0.85}
                strokeLinecap="round"
              />
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

          return primers.map((pr, i) => {
            // Wrapped primers are drawn from start round to end.
            const a1 = toAngle(pr.start);
            const a2 = toAngle(pr.wrapsOrigin ? pr.end + len : pr.end + 1);

            // Stacked outward so two overlapping primers do not sit on one line.
            const row = primerRows.rowOf.get(`${pr.id}:${pr.start}`) ?? 0;
            const r = R_PRIMER + row * 9;
            const headA = pr.strand === 'forward' ? a2 : a1;
            const bodyEnd = pr.strand === 'forward'
              ? a2 - Math.min(0.05, (a2 - a1) * 0.35)
              : a1 + Math.min(0.05, (a2 - a1) * 0.35);

            const arc = pr.strand === 'forward'
              ? `M ${CX + r * Math.cos(a1)} ${CY + r * Math.sin(a1)} A ${r} ${r} 0 ${large(a1, bodyEnd)} 1 ${CX + r * Math.cos(bodyEnd)} ${CY + r * Math.sin(bodyEnd)}`
              : `M ${CX + r * Math.cos(a2)} ${CY + r * Math.sin(a2)} A ${r} ${r} 0 ${large(bodyEnd, a2)} 0 ${CX + r * Math.cos(bodyEnd)} ${CY + r * Math.sin(bodyEnd)}`;

            // A little triangle at the 3' end.
            const hx = CX + r * Math.cos(headA), hy = CY + r * Math.sin(headA);
            const back = pr.strand === 'forward' ? headA - 0.045 : headA + 0.045;
            const head = [
              `${hx},${hy}`,
              `${CX + (r - 3.5) * Math.cos(back)},${CY + (r - 3.5) * Math.sin(back)}`,
              `${CX + (r + 3.5) * Math.cos(back)},${CY + (r + 3.5) * Math.sin(back)}`,
            ].join(' ');

            const colour = pr.directionMismatch ? '#b91c1c' : '#7c3aed';
            return (
              <g key={`${pr.id}-${i}`} style={{ cursor: 'help' }}>
                <title>{bindingTitle(pr)}</title>
                {/* Dashed where the primer anneals with mismatches. */}
                <path d={arc} fill="none" stroke={colour} strokeWidth={2} opacity={0.9} strokeDasharray={pr.mismatches?.length ? '3,2' : undefined} />
                <polygon points={head} fill={colour} />
                {/* The tail, dashed and outside the arc, so it reads as not annealed. */}
                {pr.tailLength > 0 && (
                  <path d={arc} fill="none" stroke={colour} strokeWidth={5} opacity={0.15} />
                )}
              </g>
            );
          });
        })()}

        {/* Everything that had to be written outside what it names */}
        {laidOut.placed.map(({ l, cos, sin, y }) => {
          const isRight = cos > 0;
          const elbowX = CX + (R_LBL - 20) * cos;
          const textX = CX + R_LBL * cos + (isRight ? 10 : -10);
          const anchorX = CX + l.anchorR * cos, anchorY = CY + l.anchorR * sin;

          return (
            <g key={l.key}
               onMouseDown={(e) => e.stopPropagation()}
               onClick={l.feature ? (e) => { e.stopPropagation(); onFeatureClick?.(l.feature!); } : undefined}
               onMouseEnter={l.feature ? () => setHoveredId(l.feature!.id) : undefined}
               onMouseLeave={l.feature ? () => setHoveredId(null) : undefined}
               style={{ cursor: l.feature ? 'pointer' : 'help' }}>
              <title>{l.title}</title>
              {/* A cut lands on the backbone, so its mark is drawn across it. */}
              {l.tick && (
                <line x1={CX + R_IN * cos} y1={CY + R_IN * sin} x2={anchorX} y2={anchorY}
                      stroke={l.colour} strokeWidth={2} />
              )}
              {/* Leader from the glyph out to the label's own row. */}
              <polyline
                points={`${anchorX},${anchorY} ${elbowX},${y} ${textX - (isRight ? 4 : -4)},${y}`}
                fill="none" stroke={l.colour} strokeWidth={1} opacity={0.45}
              />
              <text x={textX} y={y + 3} textAnchor={isRight ? 'start' : 'end'}
                    fill={l.colour} fontSize={l.fontSize} fontWeight={l.strong ? 800 : 400}
                    fontFamily={l.mono ? 'monospace' : undefined}>
                {l.text}
              </text>
            </g>
          );
        })}

      </svg>
    </div>
  );
}
