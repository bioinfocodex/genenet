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
import type { MapSite } from '@/lib/map-enzymes';
import { siteTitle } from '@/lib/map-enzymes';
import { frameColour, orfTitle, type MapOrf } from '@/lib/map-orfs';

interface MolbuilderRendererProps {
  sequence: string;
  features: SequenceFeature[];
  /**
   * The sites already chosen for display.
   *
   * This was narrowed to a name and a cut position, to stop callers handing
   * over the raw 5,000-cut scan. MapSite is the list that has already been
   * chosen, so it closes that door just as firmly, and it carries what
   * drawing a cut actually needs: the recognition span to highlight, and the
   * bottom-strand cut, without which a digest looks blunt whatever it leaves.
   */
  enzymes?: MapSite[];
  primers?: DrawablePrimer[];
  /** Reading frames worth drawing, already chosen — not the raw six-frame scan. */
  orfs?: MapOrf[];
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

    /*
     * 1. Layer: Enzymes
     *
     * cutPos is a 0-indexed base index and the cut falls immediately before
     * that base, so a cut belongs to this block when it lands anywhere from
     * its first base to just past its last. This used to compare against the
     * 1-indexed block bounds and position at `cutPos - i1`, which drew every
     * name and every tick one base to the left of the cut it was pointing at.
     *
     * Labels are stacked into rows by where they would actually land. Every
     * one of these is absolutely positioned at its cut, and two cuts a few
     * bases apart put two names in the same place — which on a real plasmid
     * produced a run of "AccIIBsePIBsh1236IBspFNIBssHII…" above the sequence,
     * every name correct and not one of them readable.
     *
     * The caller decides *which* enzymes arrive here; this decides where they
     * sit once they have.
     */
    const cutsHere = layers.enz
      ? enzymes.filter(e => e.cutPos >= i && e.cutPos <= i + chunkLen)
      : [];
    // A site can be highlighted in a block its cut does not fall in, when the
    // recognition sequence straddles the line break.
    const sitesHere = layers.enz
      ? enzymes.filter(e => e.recognitionStart < i + chunkLen && e.recognitionStart + e.recognitionLen > i)
      : [];

    const enzRows: { e: MapSite; row: number }[] = [];
    const rowEnds: number[] = [];
    for (const e of [...cutsHere].sort((a, b) => a.cutPos - b.cutPos)) {
      const col = e.cutPos - i;
      // A label is about 0.62ch per character and centred on its cut.
      const halfWidth = e.enzyme.length * 0.31 + 0.5;
      let row = rowEnds.findIndex(end => col - halfWidth > end);
      if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = col + halfWidth;
      enzRows.push({ e, row });
    }
    const enzHeight = Math.max(1, rowEnds.length) * 13 + 8;

    const enzRow = cutsHere.length > 0 && (
      <div key={`enz-${i}`} style={{ height: `${enzHeight}px`, position: 'relative', borderLeft: '60px solid transparent', fontFamily: 'var(--font-mono)' }}>
        {enzRows.map(({ e, row }, idx) => (
          <div key={`${e.enzyme}-${idx}`} title={siteTitle(e)} style={{ position: 'absolute', bottom: 0, left: `${e.cutPos - i}ch`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: e.color, whiteSpace: 'nowrap', paddingRight: '2px', lineHeight: 1.35 }}>{e.enzyme}</span>
            {/* The tick reaches from the label down to the bases it cuts. */}
            <div style={{ width: '1px', height: `${(rowEnds.length - row - 1) * 13 + 6}px`, background: e.color }} />
          </div>
        ))}
      </div>
    );

    /*
     * Which bases each site recognises, so they can be tinted under the
     * letters. Naming an enzyme and being shown only a tick above the line
     * leaves the actual question — which bases is it reading — to be counted
     * off by hand.
     */
    const siteInk: (string | null)[] = new Array(chunkLen).fill(null);
    for (const e of sitesHere) {
      for (let c = e.recognitionStart - i; c < e.recognitionStart + e.recognitionLen - i; c++) {
        if (c >= 0 && c < chunkLen) siteInk[c] ??= e.color;
      }
    }

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

    /*
     * 3b. ORFs — the ones already chosen, not the whole six-frame scan.
     *
     * This layer used to be handed every ORF over 100 nt in all six frames,
     * including every one lying under a CDS the feature track above already
     * names. Turning it on filled the page with bars restating the
     * annotation. The map answers the narrower question — is there coding
     * sequence I have *not* annotated — and now so does this.
     *
     * A row per frame rather than packed by position: two ORFs on one row
     * being in the same frame is information, and packing by whatever fits
     * would throw it away.
     */
    const orfBand = (dir: '+' | '-', margin: React.CSSProperties) => {
      const here = layers.orf
        ? orfs.filter(o => o.strand === dir && o.start <= i + chunkLen - 1 && o.end >= i)
        : [];
      if (here.length === 0) return false;
      const frames = [...new Set(here.map(o => o.frame))].sort((a, b) => (dir === '+' ? a - b : b - a));
      return (
        <div key={`orf-${dir}-${i}`} style={{ height: `${frames.length * 9}px`, position: 'relative', borderLeft: '60px solid transparent', fontFamily: 'var(--font-mono)', ...margin }}>
          {here.map((o, idx) => {
            // MapOrf reports `end` inclusive, unlike the raw scan this used to take.
            const start = Math.max(0, o.start - i);
            const end = Math.min(chunkLen, o.end - i + 1);
            return (
              <div
                key={`${o.frame}-${o.start}-${idx}`}
                title={orfTitle(o)}
                style={{
                  position: 'absolute', top: `${frames.indexOf(o.frame) * 9}px`,
                  left: `${start}ch`, width: `${end - start}ch`, height: '6px',
                  background: frameColour(o.frame),
                  // Already annotated: present because someone asked, never
                  // competing with the one that is news.
                  opacity: o.coveredBy ? 0.35 : 0.8,
                  borderRadius: '3px', cursor: 'help',
                }}
              />
            );
          })}
        </div>
      );
    };
    const orfFwdRow = orfBand('+', { marginBottom: '2px' });
    const orfRevRow = orfBand('-', { marginTop: '2px' });

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
    // A spliced feature is drawn as its exons. Painting one bar from first to
    // last base would colour the introns as though they were coding.
    const featBlocks = activeFeats.flatMap((f, idx) =>
      (f.segments ?? [{ start: f.start, end: f.end }])
        .filter(seg => seg.start <= iEnd1 && seg.end >= i1)
        .map((seg, si) => ({ f, seg, key: `${f.id}-${idx}-${si}` })),
    );
    const featRow = featBlocks.length > 0 && (
      <div key={`feat-${i}`} style={{ height: '18px', position: 'relative', marginBottom: '4px', paddingLeft: '60px', fontFamily: 'var(--font-mono)' }}>
        {/* Intron lines, behind the exon blocks. */}
        {activeFeats.filter(f => f.segments).map((f, idx) => {
          const s = Math.max(0, f.start - i1);
          const e = Math.min(chunkLen, f.end - i + 1);
          return (
            <div
              key={`intron-${f.id}-${idx}`}
              title={`${f.name} — intron`}
              style={{
                position: 'absolute', left: `${s}ch`, width: `${Math.max(0.5, e - s)}ch`,
                top: '6px', height: '2px', background: f.color || '#94a3b8',
                opacity: 0.45, zIndex: 9,
              }}
            />
          );
        })}
        {featBlocks.map(({ f, seg, key }) => {
          const start = Math.max(0, seg.start - i1);
          const end = Math.min(chunkLen, seg.end - i + 1);
          const width = Math.max(0.5, end - start);
          return (
            <div 
              key={key}
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
              title={f.segments ? `${f.name} (exon)` : f.name}
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
            const ink = siteInk[j];
            return (
              <span 
                key={j} 
                className={`seq-char nt-${c} ${isSelected ? 'selected' : ''}`}
                onMouseDown={() => handleMouseDown(pos)}
                onMouseMove={() => handleMouseMove(pos)}
                onMouseUp={handleMouseUp}
                style={{
                  fontWeight: ink ? 800 : 600,
                  color: NT_COL[c] || '#475569',
                  // Selection is set by a class, so leaving the inline
                  // background off is what lets it win where the two meet.
                  ...(ink && !isSelected ? { background: `${ink}2e` } : {}),
                  ...(ink ? { boxShadow: `inset 0 -2px 0 ${ink}` } : {}),
                }}
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
            const ink = siteInk[j];
            return (
              <span 
                key={j} 
                className={`seq-char ${isSelected ? 'selected' : ''}`}
                style={{
                  color: ink ? NT_COL[c] || '#475569' : NT_BOT[c] || '#94a3b8',
                  ...(ink && !isSelected ? { background: `${ink}2e` } : {}),
                }}
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

    /*
     * The cut itself, drawn where it actually falls: down through the top
     * strand at cutPos, along the gap between the strands, and down through
     * the bottom strand at cutBottom.
     *
     * The offset between the two is the overhang. Drawing one line through
     * both strands would show every digest as blunt — EcoRI and SmaI
     * identical on screen, when which of the two you reach for is decided by
     * exactly that difference.
     */
    const cutMarks = cutsHere.length > 0 && (
      <div key={`cuts-${i}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {cutsHere.map((e, idx) => {
          const top = e.cutPos - i;
          const bottom = e.cutBottom - i;
          const lo = Math.max(0, Math.min(top, bottom));
          const hi = Math.min(chunkLen, Math.max(top, bottom));
          const bar = (left: number, from: string, height: string) => (
            <div style={{
              position: 'absolute', left: `calc(60px + ${left}ch)`, marginLeft: -1,
              top: from, height, width: 2, background: e.color, borderRadius: 1,
            }} />
          );
          return (
            <React.Fragment key={`${e.enzyme}-${idx}`}>
              {bar(top, '0', '50%')}
              {hi > lo && (
                <div style={{
                  position: 'absolute', left: `calc(60px + ${lo}ch)`, width: `${hi - lo}ch`,
                  top: 'calc(50% - 1px)', height: 2, background: e.color,
                }} />
              )}
              {bottom >= 0 && bottom <= chunkLen && bar(bottom, '50%', '50%')}
            </React.Fragment>
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
        <div style={{ position: 'relative' }}>
          {topStrand}
          {strandSeparator}
          {botStrand}
          {cutMarks}
        </div>
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
