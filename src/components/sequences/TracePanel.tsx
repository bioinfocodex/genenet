'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isAb1, parseAb1 } from '@/lib/formats/ab1';
import {
  verifyTrace, peakWindow,
  type TraceVerification, type TraceDiscrepancy, type OrientedTrace,
} from '@/lib/trace-alignment';

/**
 * Sanger traces against this sequence: load the .ab1 files a facility sends
 * back, see which reads confirm the construct, and look at the peaks under
 * anything that does not.
 */

const BASE_COLOUR: Record<string, string> = { A: '#16a34a', C: '#2563eb', G: '#111827', T: '#dc2626' };
const KIND_LABEL: Record<TraceDiscrepancy['kind'], string> = {
  match: 'match', mismatch: 'mismatch', insertion: 'insertion', deletion: 'deletion', mixed: 'mixed peak',
};

interface LoadedRead {
  file: string;
  sampleName: string;
  runDate: string;
  result: TraceVerification | null;
  error?: string;
}

export default function TracePanel({ reference, circular }: { reference: string; circular: boolean }) {
  const [reads, setReads] = useState<LoadedRead[]>([]);
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLow, setShowLow] = useState(false);

  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const loaded: LoadedRead[] = [];
    for (const f of Array.from(files)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!isAb1(bytes)) {
        loaded.push({ file: f.name, sampleName: '', runDate: '', result: null, error: 'Not an ABI trace file' });
        continue;
      }
      const t = parseAb1(bytes, { includeTraces: true });
      if (!t) {
        loaded.push({ file: f.name, sampleName: '', runDate: '', result: null, error: 'The trace file could not be read' });
        continue;
      }
      // Let the browser paint between reads; each alignment is a few hundred ms.
      await new Promise(r => setTimeout(r, 0));
      try {
        const result = verifyTrace(reference, circular, {
          name: t.sampleName || f.name, sequence: t.sequence, quality: t.quality,
          baseOrder: t.baseOrder, traces: t.traces, peakLocations: t.peakLocations,
        });
        loaded.push({ file: f.name, sampleName: t.sampleName, runDate: t.runDate, result });
      } catch (e) {
        loaded.push({ file: f.name, sampleName: t.sampleName, runDate: t.runDate, result: null, error: (e as Error).message });
      }
    }
    setReads(prev => [...prev, ...loaded]);
    setSelected(reads.length);
    setFocus(null);
    setBusy(false);
  };

  const current = reads[selected]?.result ?? null;
  const shown = useMemo(
    () => current?.discrepancies.filter(d => showLow || d.confidence === 'high') ?? [],
    [current, showLow],
  );

  const step = (dir: 1 | -1) => {
    if (!shown.length) return;
    const cols = shown.map(d => d.column);
    const from = focus ?? (dir === 1 ? -1 : Infinity);
    const next = dir === 1 ? cols.find(c => c > from) ?? cols[0] : [...cols].reverse().find(c => c < from) ?? cols.at(-1)!;
    setFocus(next);
  };

  return (
    <div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label className="btn btn-primary" style={{ fontSize: '0.82rem', cursor: 'pointer', display: 'inline-block' }}>
          {busy ? 'Aligning…' : 'Load .ab1 trace files'}
          <input type="file" accept=".ab1,.abi,.ab!" multiple hidden disabled={busy} onChange={e => { load(e.target.files); e.target.value = ''; }} />
        </label>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
          Ends below Q20 are trimmed. A difference counts when its call is Q30 or better.
        </span>
      </div>

      {reads.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
          {reads.map((r, i) => {
            const v = r.result;
            const high = v?.discrepancies.filter(d => d.confidence === 'high').length ?? 0;
            const chip = r.error ? ['error', '#dc2626'] : v!.verdict === 'confirmed' ? ['confirmed', '#16a34a'] : v!.verdict === 'differs' ? [`${high} difference${high === 1 ? '' : 's'}`, '#ea580c'] : ['unusable', '#64748b'];
            return (
              <button
                key={i}
                onClick={() => { setSelected(i); setFocus(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0.7rem', textAlign: 'left',
                  border: `1px solid ${i === selected ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                  background: i === selected ? 'var(--accent-blue-15)' : 'white', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v?.name ?? r.file}</span>
                {v && v.verdict !== 'unusable' && (
                  <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {v.reversed ? '◀' : '▶'} {v.coverageStart.toLocaleString()}–{v.coverageEnd.toLocaleString()} · Q{v.meanQuality ?? '?'}
                  </span>
                )}
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: chip[1], background: `${chip[1]}18`, padding: '0.1rem 0.45rem', borderRadius: 4 }}>{chip[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {reads[selected]?.error && (
        <div style={{ padding: '0.6rem 0.9rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, fontSize: '0.82rem', color: '#dc2626' }}>
          {reads[selected].file}: {reads[selected].error}
        </div>
      )}

      {current && current.verdict === 'unusable' && (
        <div style={{ padding: '0.6rem 0.9rem', background: '#f8fafc', border: '1px solid var(--glass-border)', borderRadius: 7, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Too little of this read is above Q20 to judge it. A failed reaction, or a trace from a different template.
        </div>
      )}

      {current && current.verdict !== 'unusable' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {(current.identity * 100).toFixed(1)}% identity over the usable {current.usableEnd - current.usableStart} bp
              {reads[selected].runDate ? ` · run ${reads[selected].runDate}` : ''}
            </span>
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={showLow} onChange={e => setShowLow(e.target.checked)} /> include low-quality calls
            </label>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => step(-1)} disabled={!shown.length}>◀ Prev</button>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => step(1)} disabled={!shown.length}>Next ▶</button>
          </div>

          {/* Keyed by read, so picking another starts it at its own beginning. */}
          <TraceViewer key={selected} verification={current} focus={focus} onFocus={setFocus} />

          {shown.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', marginTop: '0.75rem' }}>
              <thead>
                <tr>{['Position', 'Kind', 'Ref → read', 'Quality', 'Second peak', 'Evidence'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.3rem 0.4rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--glass-border)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {shown.map(d => (
                  <tr
                    key={d.column}
                    onClick={() => setFocus(d.column)}
                    style={{ cursor: 'pointer', background: d.column === focus ? 'var(--accent-blue-15)' : undefined }}
                  >
                    <td style={cell}>{d.position.toLocaleString()}</td>
                    <td style={cell}>{KIND_LABEL[d.kind]}</td>
                    <td style={{ ...cell, fontFamily: 'monospace' }}>{d.reference} → {d.read}</td>
                    <td style={cell}>{d.quality ?? '—'}</td>
                    <td style={cell}>{d.secondaryRatio != null ? `${Math.round(d.secondaryRatio * 100)}%` : '—'}</td>
                    <td style={{ ...cell, color: d.confidence === 'high' ? '#ea580c' : 'var(--text-muted)' }}>
                      {d.confidence === 'high' ? 'well supported' : 'weak call'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: '0.82rem', color: '#16a34a', marginTop: '0.75rem' }}>
              ✓ No well-supported difference from the reference across {current.coverageStart.toLocaleString()}–{current.coverageEnd.toLocaleString()}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: '0.3rem 0.4rem', borderBottom: '1px solid var(--glass-border)' };

// ─── Chromatogram ─────────────────────────────────────────────────────────────

const COL = 12;
const ROW = { ruler: 14, ref: 16, read: 16, quality: 18, trace: 120 };
const HEIGHT = ROW.ruler + ROW.ref + ROW.read + ROW.quality + ROW.trace + 6;

/**
 * Reference, read and trace in aligned columns, drawn to a canvas the width of
 * the view and redrawn on scroll -- an 800-base read is 9,600 px of trace, and
 * only what is on screen is worth drawing.
 */
function TraceViewer({ verification, focus, onFocus }: {
  verification: TraceVerification;
  focus: number | null;
  onFocus: (c: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [width, setWidth] = useState(800);
  const { columns, trace, discrepancies } = verification;

  const marks = useMemo(() => {
    const m = new Map<number, TraceDiscrepancy>();
    for (const d of discrepancies) m.set(d.column, d);
    return m;
  }, [discrepancies]);

  // Scale to the typical primary peak in the aligned region, so one huge dye
  // blob does not flatten the rest of the read.
  const scale = useMemo(() => primaryPeakScale(trace, columns.map(c => c.readIndex)), [trace, columns]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (focus == null || !scroller.current) return;
    const el = scroller.current;
    el.scrollTo({ left: Math.max(0, focus * COL - el.clientWidth / 2), behavior: 'smooth' });
  }, [focus]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = HEIGHT * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${HEIGHT}px`;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, HEIGHT);

    const first = Math.max(0, Math.floor(scrollLeft / COL) - 1);
    const last = Math.min(columns.length, Math.ceil((scrollLeft + width) / COL) + 1);
    const yRef = ROW.ruler;
    const yRead = yRef + ROW.ref;
    const yQual = yRead + ROW.read;
    const yTrace = yQual + ROW.quality;
    const traceBase = HEIGHT - 4;

    g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    for (let k = first; k < last; k++) {
      const col = columns[k];
      const x = k * COL - scrollLeft;
      const mark = marks.get(k);

      if (mark) {
        g.fillStyle = mark.kind === 'mixed'
          ? 'rgba(124,58,237,0.12)'
          : mark.confidence === 'high' ? 'rgba(220,38,38,0.14)' : 'rgba(217,119,6,0.12)';
        g.fillRect(x, yRef, COL, HEIGHT - yRef);
      }
      if (k === focus) {
        g.strokeStyle = '#2563eb';
        g.lineWidth = 1.5;
        g.strokeRect(x + 0.75, yRef + 0.75, COL - 1.5, HEIGHT - yRef - 1.5);
      }

      if (col.kind !== 'insertion' && col.refPos % 10 === 0) {
        g.fillStyle = '#94a3b8';
        g.font = '10px ui-monospace, Menlo, monospace';
        g.fillText(String(col.refPos), x + COL / 2, ROW.ruler / 2);
        g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      }

      g.fillStyle = col.ref === '-' ? '#cbd5e1' : '#334155';
      g.fillText(col.ref, x + COL / 2, yRef + ROW.ref / 2);
      g.fillStyle = col.kind === 'match' ? '#64748b' : col.read === '-' ? '#cbd5e1' : '#dc2626';
      g.fillText(col.read, x + COL / 2, yRead + ROW.read / 2);

      if (col.quality != null) {
        const h = Math.min(1, col.quality / 60) * (ROW.quality - 3);
        g.fillStyle = col.quality >= 30 ? '#93c5fd' : col.quality >= 20 ? '#cbd5e1' : '#fda4af';
        g.fillRect(x + 2, yQual + ROW.quality - 1 - h, COL - 4, h);
      }

      if (col.readIndex != null) drawPeaks(g, trace, col.readIndex, x, yTrace, traceBase, scale);
    }
  }, [columns, trace, marks, focus, scrollLeft, width, scale]);

  useEffect(draw, [draw]);

  return (
    <div>
      <div
        ref={scroller}
        onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const k = Math.floor((e.clientX - rect.left + e.currentTarget.scrollLeft) / COL);
          if (k >= 0 && k < columns.length) onFocus(k);
        }}
        style={{ overflowX: 'auto', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'white', cursor: 'crosshair' }}
      >
        <div style={{ width: columns.length * COL, height: HEIGHT, position: 'relative' }}>
          <canvas ref={canvas} style={{ position: 'sticky', left: 0, top: 0, display: 'block' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.9rem', marginTop: '0.35rem', fontSize: '0.68rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        {Object.entries(BASE_COLOUR).map(([b, c]) => <span key={b}><span style={{ color: c, fontWeight: 800 }}>━</span> {b}</span>)}
        <span>Rows: reference · read · quality · trace</span>
        <span><span style={{ color: 'rgba(220,38,38,0.6)' }}>■</span> difference</span>
        <span><span style={{ color: 'rgba(217,119,6,0.6)' }}>■</span> weak call</span>
        <span><span style={{ color: 'rgba(124,58,237,0.6)' }}>■</span> mixed peak</span>
        <span>{verification.reversed ? 'Reverse read, shown as its complement' : 'Forward read'}</span>
      </div>
    </div>
  );
}

function drawPeaks(
  g: CanvasRenderingContext2D, trace: OrientedTrace, readIndex: number,
  x: number, top: number, bottom: number, scale: number,
) {
  const w = peakWindow(trace, readIndex);
  if (!w) return;
  const [from, to] = w;
  const span = Math.max(1, to - from);
  const height = bottom - top;
  g.lineWidth = 1.2;
  for (const base of ['A', 'C', 'G', 'T'] as const) {
    const data = trace.channels[base];
    if (!data.length) continue;
    g.strokeStyle = BASE_COLOUR[base];
    g.beginPath();
    // One point past the window joins this column's curve to the next one.
    for (let t = from; t <= Math.min(to, data.length - 1); t++) {
      const px = x + ((t - from) / span) * COL;
      const py = bottom - Math.min(1.15, (data[t] ?? 0) / scale) * height;
      if (t === from) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
}

function primaryPeakScale(trace: OrientedTrace, readIndices: (number | null)[]): number {
  const heights: number[] = [];
  for (const i of readIndices) {
    if (i == null) continue;
    const p = trace.peaks[i];
    if (p === undefined) continue;
    heights.push(Math.max(...(['A', 'C', 'G', 'T'] as const).map(b => trace.channels[b][p] ?? 0)));
  }
  if (!heights.length) return 1;
  heights.sort((a, b) => a - b);
  return Math.max(1, heights[Math.floor(heights.length * 0.9)]);
}
