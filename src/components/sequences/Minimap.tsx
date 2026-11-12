'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SequenceFeature } from '@/lib/features';
import {
  bands, hitMarks, ticks, windowRect, topBaseFor, baseToX,
} from '@/lib/minimap';

const STRIP_H = 14;
const TICK_ROW_H = 11;

interface MinimapProps {
  length: number;
  features: SequenceFeature[];
  /** Every place the current search matched, so the strip answers "where else". */
  hits?: { start: number; end: number }[];
  /** First and last base on screen, 1-based inclusive. */
  first: number;
  last: number;
  selection?: { start: number; end: number } | null;
  /** Asked for when somebody points at the strip: put this base at the top. */
  onGoTo: (topBase: number) => void;
}

/**
 * The whole molecule as one strip, with the screenful marked on it.
 *
 * Only the drawing lives here. Where a base lands, which feature wins a
 * crowded pixel and where a click should take the view are all in
 * `lib/minimap`, under test -- a picture that is one pixel out looks exactly
 * like one that is not.
 */
export default function Minimap({
  length, features, hits = [], first, last, selection, onGoTo,
}: MinimapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const span = Math.max(1, last - first + 1);

  const goFromEvent = useCallback((clientX: number) => {
    const el = boxRef.current;
    if (!el || width <= 0) return;
    const x = clientX - el.getBoundingClientRect().left;
    onGoTo(topBaseFor(x, length, width, span));
  }, [length, width, span, onGoTo]);

  /*
   * The drag is followed on the window rather than on the strip. Tracking it
   * on the element loses the molecule the moment the pointer leaves the 14px
   * band, which on a fast drag is immediately.
   */
  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) goFromEvent(e.clientX); };
    const up = () => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [goFromEvent]);

  const featureBands = useMemo(() => bands(features, length, width), [features, length, width]);
  const marks = useMemo(() => hitMarks(hits, length, width), [hits, length, width]);
  const labels = useMemo(() => ticks(length, width), [length, width]);
  const win = windowRect(first, last, length, width);
  const sel = selection && selection.end >= selection.start
    ? windowRect(selection.start, selection.end, length, width)
    : null;

  return (
    <div
      ref={boxRef}
      style={{
        width: '100%', userSelect: 'none', cursor: 'pointer',
        background: 'var(--seq-bg, #fff)',
        borderBottom: '1px solid var(--seq-border, #e5e7eb)',
        padding: '0.3rem 0 0.15rem',
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        goFromEvent(e.clientX);
      }}
      title="The whole molecule. Click or drag to move the view."
    >
      {width > 0 && (
        <svg width={width} height={STRIP_H + TICK_ROW_H} style={{ display: 'block' }}>
          {/* The molecule itself. */}
          <rect x={0} y={0} width={width} height={STRIP_H} rx={2}
                fill="var(--seq-rail, #eef1f5)" />

          {featureBands.map(b => (
            <rect key={`${b.id}-${b.x}`} x={b.x} y={2} width={b.w} height={STRIP_H - 4}
                  fill={b.color} opacity={0.85}>
              <title>{b.name}</title>
            </rect>
          ))}

          {/* Search hits sit above the features, being the thing just asked for. */}
          {marks.map(x => (
            <rect key={`hit-${x}`} x={x} y={0} width={1.5} height={STRIP_H}
                  fill="#f59e0b" />
          ))}

          {sel && (
            <rect x={sel.x} y={0} width={sel.w} height={STRIP_H}
                  fill="var(--accent-blue, #3b82f6)" opacity={0.35} />
          )}

          {/*
            * The screenful. Outlined rather than filled: it sits on top of the
            * features, and filling it would hide the part of the molecule
            * somebody is actually looking at.
            */}
          <rect x={win.x} y={-0.5} width={win.w} height={STRIP_H + 1} rx={2}
                fill="var(--accent-blue, #3b82f6)" fillOpacity={0.14}
                stroke="var(--accent-blue, #3b82f6)" strokeWidth={1.5} />

          {labels.map(t => (
            <g key={`t-${t}`}>
              <line x1={baseToX(t, length, width)} y1={STRIP_H} x2={baseToX(t, length, width)}
                    y2={STRIP_H + 3} stroke="var(--text-muted, #9ca3af)" strokeWidth={1} />
              <text x={baseToX(t, length, width)} y={STRIP_H + TICK_ROW_H - 1}
                    textAnchor="middle" fontSize={8.5} fill="var(--text-muted, #9ca3af)"
                    fontFamily="var(--font-mono, monospace)">
                {t >= 1000 ? `${Math.round(t / 1000)}k` : t}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
