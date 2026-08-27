'use client';
import React, { useMemo, useRef, useEffect } from 'react';
import { 
  NT_COL, 
  NT_BOT, 
  AA_COL_SEQ, 
  AA_BG_SEQ, 
  COMP_MAP, 
  AA3, 
  AA3BG, 
  AA3FG,
  translateSeq,
  getAAStyle
} from '@/lib/molbuilder-logic';
// Type-only: erased at compile time, so this does not create a runtime cycle
// back into SequenceViewer, which renders this component.
import type { SequenceFeature, SavedPrimer } from '@/components/SequenceViewer';

/**
 * A primer with its position on the template.
 *
 * SavedPrimer carries no coordinates -- a primer is an oligo, not a feature of
 * any one sequence -- so the caller resolves where it anneals (see
 * lib/primers.ts) and passes the result in. The same primer may appear more
 * than once if it anneals in more than one place.
 */
export type DrawablePrimer = SavedPrimer & { start: number; end: number };
import type { ReSite } from '@/components/sequences/LinearMap';
import type { ORF } from '@/lib/simulation';

interface MolbuilderRendererProps {
  sequence: string;
  features: SequenceFeature[];
  enzymes?: ReSite[];
  primers?: DrawablePrimer[];
  orfs?: ORF[];
  lineLen: number;
  layers: {
    feat: boolean;
    enz: boolean;
    primer: boolean;
    orf: boolean;
  };
  frames: Set<number>;
  selection?: { start: number; end: number } | null;
  onSelect: (sel: { start: number; end: number } | null) => void;
  onFeatureClick?: (feat: SequenceFeature) => void;
}

export default function MolbuilderRenderer({
  sequence,
  features,
  enzymes = [],
  primers = [],
  orfs = [],
  lineLen = 60,
  layers,
  frames,
  selection,
  onSelect,
  onFeatureClick
}: MolbuilderRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);

  const seq = useMemo(() => sequence.toUpperCase(), [sequence]);
  const len = seq.length;

  // ─── Rendering Helpers ───────────────────────────────────────────────────────

  const handleMouseDown = (pos: number) => {
    dragStartRef.current = pos;
    onSelect({ start: pos + 1, end: pos + 1 });
  };

  const handleMouseMove = (pos: number) => {
    if (dragStartRef.current === null) return;
    const start = Math.min(dragStartRef.current, pos);
    const end = Math.max(dragStartRef.current, pos);
    onSelect({ start: start + 1, end: end + 1 });
  };

  const handleMouseUp = () => {
    dragStartRef.current = null;
  };

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // ─── Render Blocks ──────────────────────────────────────────────────────────

  const blocks = [];
  for (let i = 0; i < len; i += lineLen) {
    const chunk = seq.slice(i, i + lineLen);
    const chunkLen = chunk.length;
    const i1 = i + 1; // 1-indexed block start
    const iEnd1 = i + chunkLen; // 1-indexed block end

    // 1. Layer: Enzymes (1-indexed cutPos)
    const activeEnz = layers.enz ? enzymes.filter(e => e.cutPos >= i1 && e.cutPos <= iEnd1) : [];
    const enzRow = activeEnz.length > 0 && (
      <div key={`enz-${i}`} style={{ height: '32px', position: 'relative', borderLeft: '60px solid transparent', fontFamily: 'var(--font-mono)' }}>
        {activeEnz.map((e, idx) => (
          <div key={`${e.enzyme}-${idx}`} style={{ position: 'absolute', left: `${e.cutPos - i1}ch`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap', borderRight: '1px solid #ef4444', paddingRight: '2px', lineHeight: 1 }}>{e.enzyme}</span>
            <div style={{ width: '1px', height: '6px', background: '#ef4444' }} />
          </div>
        ))}
      </div>
    );

    // 2. Layer: Primers (1-indexed start/end)
    const activePrimesFwd = layers.primer ? primers.filter(p => p.direction === 'forward' && p.start <= iEnd1 && p.end >= i1) : [];
    const primerFwdRow = activePrimesFwd.length > 0 && (
      <div key={`prim-fwd-${i}`} style={{ height: '14px', position: 'relative', borderLeft: '60px solid transparent', marginBottom: '2px', fontFamily: 'var(--font-mono)' }}>
        {activePrimesFwd.map((p, idx) => {
          const start = Math.max(0, p.start - i1);
          const end = Math.min(chunkLen, p.end - i);
          const width = end - start;
          return (
            <div key={`${p.id}-${idx}`} title={`${p.name} (${p.direction}, ${p.start}–${p.end})`} style={{ position: 'absolute', left: `${start}ch`, width: `${width}ch`, height: '6px', background: '#ec4899', borderRadius: '0 3px 3px 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '8px', color: 'white', paddingRight: '2px' }}>
              ▶
            </div>
          );
        })}
      </div>
    );

    // 3. Translations (Forward: +1, +2, +3)
    const fwdFrames = [1, 2, 3].filter(f => frames.has(f));
    const transFwdRows = fwdFrames.map(f => {
      const aaArray = translateSeq(seq, f);
      return (
        <div key={`trans-${f}-${i}`} className="seq-row" style={{ height: '18px' }}>
          <div className="seq-label" style={{ color: '#9333ea' }}>+{f}</div>
          <div className="seq-chars">
            {chunk.split('').map((_, j) => {
              const aa = aaArray[i + j];
              if (!aa) return <span key={j} className="seq-char" />;
              const style = getAAStyle(aa);
              return (
                <span key={j} className="seq-char" style={{ background: style.bg, color: style.fg, fontSize: '10px', fontWeight: 700 }}>
                  {aa}
                </span>
              );
            })}
          </div>
        </div>
      );
    });

    // 3b. ORFs (Forward - 0-indexed start/end from logic)
    const activeOrfsFwd = layers.orf ? orfs.filter(o => o.strand === '+' && o.start < iEnd1 && o.end > i) : [];
    const orfFwdRow = activeOrfsFwd.length > 0 && (
      <div key={`orf-fwd-${i}`} style={{ height: '10px', position: 'relative', borderLeft: '60px solid transparent', marginBottom: '2px', fontFamily: 'var(--font-mono)' }}>
        {activeOrfsFwd.map((o, idx) => {
          const start = Math.max(0, o.start - i);
          const end = Math.min(chunkLen, o.end - i);
          return (
            <div key={`${o.frame}-${idx}`} style={{ position: 'absolute', left: `${start}ch`, width: `${end - start}ch`, height: '6px', background: '#22c55e', opacity: 0.6, borderRadius: '3px' }} />
          );
        })}
      </div>
    );

    // 4. Ruler
    const ruler = (
      <div key={`ruler-${i}`} className="seq-line-header" style={{ position: 'relative', height: '24px', display: 'flex', alignItems: 'flex-end', paddingLeft: '60px' }}>
        {Array.from({ length: Math.ceil(chunkLen / 10) }).map((_, j) => {
          const pos = i + j * 10;
          if (pos >= len) return null;
          return (
            <div key={pos} style={{ position: 'absolute', left: `calc(60px + ${j * 10}ch)`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 600, marginBottom: '2px' }}>{pos + 1}</span>
              <div style={{ width: '1px', height: '4px', background: '#cbd5e1' }} />
            </div>
          );
        })}
      </div>
    );

    // 5. Features (1-indexed start/end)
    const activeFeats = layers.feat ? features.filter(f => f.start <= iEnd1 && f.end >= i1) : [];
    const featRow = activeFeats.length > 0 && (
      <div key={`feat-${i}`} style={{ height: '18px', position: 'relative', marginBottom: '4px', paddingLeft: '60px', fontFamily: 'var(--font-mono)' }}>
        {activeFeats.map((f, idx) => {
          const start = Math.max(0, f.start - i1);
          const end = Math.min(chunkLen, f.end - i + 1);
          const width = Math.max(0.5, end - start);
          return (
            <div 
              key={`${f.id}-${idx}`}
              onClick={() => onFeatureClick?.(f)}
              style={{
                position: 'absolute',
                left: `${start}ch`,
                width: `${width}ch`,
                height: '14px',
                background: f.color || '#94a3b8',
                borderRadius: '2px',
                cursor: 'pointer',
                opacity: 0.8,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
              title={f.name}
            >
              <span style={{ fontSize: '8px', color: 'white', fontWeight: 700, pointerEvents: 'none' }}>{width > 4 ? f.name : ''}</span>
            </div>
          );
        })}
      </div>
    );

    // 6. Sequence Rows (Top/Bottom)
    const topStrand = (
      <div key={`top-${i}`} className="seq-row">
        <div className="seq-label">5′</div>
        <div className="seq-chars">
          {chunk.split('').map((c, j) => {
            const pos = i + j;
            const isSelected = selection && pos + 1 >= selection.start && pos + 1 <= selection.end;
            return (
              <span 
                key={j} 
                className={`seq-char nt-${c} ${isSelected ? 'selected' : ''}`}
                onMouseDown={() => handleMouseDown(pos)}
                onMouseMove={() => handleMouseMove(pos)}
                onMouseUp={handleMouseUp}
                style={{ fontWeight: 600, color: NT_COL[c] || '#475569' }}
              >
                {c}
              </span>
            );
          })}
        </div>
      </div>
    );

    const strandSeparator = (
      <div key={`sep-${i}`} style={{ height: '1px', borderLeft: '60px solid transparent', padding: '0 4px', background: 'none' }}>
        <div style={{ height: '1px', background: 'var(--seq-border)', opacity: 0.8 }} />
      </div>
    );

    const botStrand = (
      <div key={`bot-${i}`} className="seq-row" style={{ marginTop: '0px' }}>
        <div className="seq-label">3′</div>
        <div className="seq-chars">
          {chunk.split('').map((c, j) => {
            const pos = i + j;
            const b = COMP_MAP[c] || 'N';
            const isSelected = selection && pos + 1 >= selection.start && pos + 1 <= selection.end;
            return (
              <span 
                key={j} 
                className={`seq-char ${isSelected ? 'selected' : ''}`}
                style={{ color: NT_BOT[c] || '#94a3b8' }}
              >
                {b}
              </span>
            );
          })}
        </div>
      </div>
    );

    // 7. Translations (Reverse: -1, -2, -3)
    const revFrames = [-1, -2, -3].filter(f => frames.has(f));
    const transRevRows = revFrames.map(f => {
      const aaArray = translateSeq(seq, f);
      return (
        <div key={`trans-${f}-${i}`} className="seq-row" style={{ height: '18px', marginTop: '2px' }}>
          <div className="seq-label" style={{ color: '#7c3aed' }}>{f}</div>
          <div className="seq-chars">
            {chunk.split('').map((_, j) => {
              const aa = aaArray[i + j];
              if (!aa) return <span key={j} className="seq-char" />;
              const style = getAAStyle(aa);
              return (
                <span key={j} className="seq-char" style={{ background: style.bg, color: style.fg, fontSize: '10px', fontWeight: 700 }}>
                  {aa}
                </span>
              );
            })}
          </div>
        </div>
      );
    });

    // 7b. ORFs (Reverse)
    const activeOrfsRev = layers.orf ? orfs.filter(o => o.strand === '-' && o.start < iEnd1 && o.end > i) : [];
    const orfRevRow = activeOrfsRev.length > 0 && (
      <div key={`orf-rev-${i}`} style={{ height: '10px', position: 'relative', borderLeft: '60px solid transparent', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
        {activeOrfsRev.map((o, idx) => {
          const start = Math.max(0, o.start - i);
          const end = Math.min(chunkLen, o.end - i);
          return (
            <div key={`${o.frame}-${idx}`} style={{ position: 'absolute', left: `${start}ch`, width: `${end - start}ch`, height: '6px', background: '#9333ea', opacity: 0.6, borderRadius: '3px' }} />
          );
        })}
      </div>
    );

    // 7c. Primers (Reverse: 1-indexed)
    const activePrimesRev = layers.primer ? primers.filter(p => p.direction === 'reverse' && p.start <= iEnd1 && p.end >= i1) : [];
    const primerRevRow = activePrimesRev.length > 0 && (
      <div key={`prim-rev-${i}`} style={{ height: '14px', position: 'relative', borderLeft: '60px solid transparent', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
        {activePrimesRev.map((p, idx) => {
          const start = Math.max(0, p.start - i1);
          const end = Math.min(chunkLen, p.end - i);
          const width = end - start;
          return (
            <div key={`${p.id}-${idx}`} title={`${p.name} (${p.direction}, ${p.start}–${p.end})`} style={{ position: 'absolute', left: `${start}ch`, width: `${width}ch`, height: '6px', background: '#db2777', borderRadius: '3px 0 0 3px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', fontSize: '8px', color: 'white', paddingLeft: '2px' }}>
              ◀
            </div>
          );
        })}
      </div>
    );

    blocks.push(
      <div key={`block-${i}`} className="seq-block">
        {enzRow}
        {primerFwdRow}
        {orfFwdRow}
        {transFwdRows}
        {ruler}
        {featRow}
        {topStrand}
        {strandSeparator}
        {botStrand}
        {transRevRows}
        {orfRevRow}
        {primerRevRow}
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className="seq-viewport"
      onMouseLeave={handleMouseUp}
      style={{ userSelect: 'none' }}
    >
      {blocks}
    </div>
  );
}
