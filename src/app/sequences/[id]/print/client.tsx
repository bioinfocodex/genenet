'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import LinearMap from '@/components/sequences/LinearMap';
import CircularMap from '@/components/sequences/CircularMap';
import type { SequenceFeature } from '@/lib/features';
import { allSitesFor } from '@/lib/map-sites';
import { chooseMapEnzymes, countCuts } from '@/lib/map-enzymes';
import { parseStyle, applyStyle, hiddenCount, enzymeOptions } from '@/lib/map-display';
import { translateDNA } from '@/lib/simulation';

/**
 * A sequence laid out for paper.
 *
 * Maps could be saved as SVG or PNG; a figure for a paper or a thesis is more
 * than the drawing. It wants a title, the facts that identify the molecule, a
 * legend naming what is on it, and a caption -- and it wants them on a page,
 * at a size that does not change with the browser window.
 *
 * Printing is the browser's own, so the map stays vector all the way into the
 * PDF: text stays selectable and lines stay sharp at any zoom, which a
 * screenshot or a rasterised PNG cannot give. Everything that is not the
 * figure is hidden at print time rather than drawn differently, so what is on
 * paper is what was on screen.
 */

export interface PrintSequence {
  id: string;
  name: string;
  type: string;
  sequence: string;
  description: string | null;
  features: SequenceFeature[];
  host: string | null;
  strain: string | null;
  /** How the map of this sequence is drawn, as stored. */
  mapStyle: string | null;
}

type Shape = 'circular' | 'linear';

export default function PrintClient({ seq, workspace }: { seq: PrintSequence; workspace: string }) {
  const circularByDefault = seq.type === 'plasmid';
  const [shape, setShape] = useState<Shape>(circularByDefault ? 'circular' : 'linear');
  /*
   * The figure starts from the map.
   *
   * It did not. This view drew every feature and the unique cutters, so a map
   * set up on screen -- the imported clutter left out, a working set of
   * enzymes chosen -- printed as a different map, and the person doing the
   * setting up had to do it twice. The style is the sequence's, and this view
   * reads the same one; it is held in state here because a figure is also
   * something you adjust while looking at it, and those adjustments are the
   * figure's rather than the sequence's.
   */
  const [style, setStyle] = useState(() => parseStyle(seq.mapStyle));
  const [showLegend, setShowLegend] = useState(true);
  const [showTable, setShowTable] = useState(true);
  const [showSequence, setShowSequence] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [caption, setCaption] = useState('');

  const allSites = useMemo(() => allSitesFor(seq.sequence), [seq.sequence]);
  /**
   * The same question the map asks, so the two drawings agree.
   *
   * Handed to the renderers as the whole list plus the choice, not as a list
   * already narrowed. The renderers do their own choosing from `enzymeDisplay`
   * and default to unique six-base cutters when not told otherwise -- so a
   * pre-filtered list was being filtered a second time against defaults, and a
   * figure asking for EcoRII, a five-base enzyme cutting 22 times, drew none
   * of its sites. This view previously passed unique cutters, which survived
   * the second filter by coincidence.
   */
  const siteChoice = useMemo(() => enzymeOptions(style), [style]);
  const drawnSites = useMemo(
    () => (style.sites ? chooseMapEnzymes(allSites, countCuts(allSites), siteChoice) : []),
    [style.sites, siteChoice, allSites],
  );

  const drawn = useMemo(
    () => applyStyle(seq.features, style, seq.sequence.length),
    [seq.features, style, seq.sequence.length],
  );
  const notDrawn = hiddenCount(seq.features, style, seq.sequence.length);

  const gc = useMemo(() => {
    const s = seq.sequence.toUpperCase();
    const n = (s.match(/[GC]/g) ?? []).length;
    return s.length ? ((n / s.length) * 100).toFixed(1) : '0';
  }, [seq.sequence]);

  // 60 bases a line, numbered every line: the convention every journal uses.
  const lines = useMemo(() => {
    if (!showSequence) return [];
    const s = seq.sequence.toUpperCase();
    const out: { at: number; bases: string; aa?: string }[] = [];
    for (let i = 0; i < s.length; i += 60) {
      const bases = s.slice(i, i + 60);
      out.push({
        at: i + 1,
        bases,
        // Translated in the molecule's own first frame, spaced so each residue
        // sits under the middle base of its codon.
        aa: showTranslation
          ? translateDNA(s.slice(i - (i % 3), i + 60), false).split('').map(c => ` ${c} `).join('').slice(i % 3 ? 3 - (i % 3) : 0, 60)
          : undefined,
      });
    }
    return out;
  }, [showSequence, showTranslation, seq.sequence]);

  const byType = useMemo(() => {
    const m = new Map<string, SequenceFeature[]>();
    // Of the drawn features only: a legend naming a colour that is not on the
    // figure misleads as much as a figure missing one that is.
    for (const f of drawn) {
      if (!m.has(f.type)) m.set(f.type, []);
      m.get(f.type)!.push(f);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [drawn]);

  return (
    <>
      {/* Everything in here is for setting the figure up, and none of it prints. */}
      <div className="no-print" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.25rem', padding: '0.9rem 1.1rem', border: '1px solid var(--glass-border)', borderRadius: 10, background: 'white' }}>
        <Field label="Map">
          <select value={shape} onChange={e => setShape(e.target.value as Shape)} className="input-control" style={input}>
            <option value="circular">Circular</option>
            <option value="linear">Linear</option>
          </select>
        </Field>
        <Field label="Enzyme sites">
          {/*
            Named enzymes are not one of these choices, so the select must not
            claim to be making it. It read "Unique cutters" while the figure
            drew a 22-cutter somebody had asked for by name on the map -- the
            control saying one thing and the drawing another.
          */}
          <select
            value={style.enzymes.length ? 'named' : style.sites ? String(style.maxCuts) : 'none'}
            onChange={e => {
              const v = e.target.value;
              if (v === 'named') return;
              // Choosing a filter drops the named enzymes: they are the thing
              // the filters were overriding, and keeping both would leave this
              // choice with no effect.
              setStyle(s => v === 'none'
                ? { ...s, sites: false, enzymes: [] }
                : { ...s, sites: true, enzymes: [], maxCuts: Number(v) });
            }}
            className="input-control"
            style={input}
            title={style.enzymes.length
              ? 'Named on the map. Choosing a filter here drops them.'
              : 'Which of the sites found are worth labelling'}
          >
            {style.enzymes.length > 0 && (
              <option value="named">{style.enzymes.join(', ')}</option>
            )}
            <option value="1">Unique cutters</option>
            <option value="2">Cutting up to twice</option>
            <option value="3">Cutting up to 3 times</option>
            <option value="99">All sites</option>
            <option value="none">None</option>
          </select>
        </Field>
        <Field label="Caption">
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Figure 1. …" className="input-control" style={{ ...input, width: 300 }} />
        </Field>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem', alignItems: 'center' }}>
          <Check checked={showLegend} onChange={setShowLegend}>legend</Check>
          <Check checked={showTable} onChange={setShowTable}>feature table</Check>
          <Check checked={showSequence} onChange={setShowSequence}>sequence</Check>
          <Check checked={showTranslation} onChange={setShowTranslation} disabled={!showSequence}>translation</Check>
        </div>
        <span style={{ flex: 1 }} />
        <Link href={`/sequences/${seq.id}`} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>← Back</Link>
        <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: '0.82rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <Printer size={14} /> Print or save as PDF
        </button>
      </div>

      <div className="printable">
        <header className="figure-head" style={{ borderBottom: '1px solid #cbd5e1', paddingBottom: '0.5rem', marginBottom: '0.9rem' }}>
          <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{seq.name}</h1>
          <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.2rem' }}>
            {seq.sequence.length.toLocaleString()} bp · {seq.type === 'plasmid' ? 'circular' : 'linear'} · GC {gc}%
            {drawn.length > 0 && ` · ${drawn.length} features`}
            {seq.host && ` · host ${seq.host}`}
            {seq.strain && ` · strain ${seq.strain}`}
          </div>
          {seq.description && <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.2rem' }}>{seq.description}</div>}
        </header>

        <figure style={{ margin: 0 }}>
          <div style={{ maxWidth: shape === 'circular' ? 560 : '100%', margin: '0 auto' }}>
            {shape === 'circular'
              ? <CircularMap sequence={seq.sequence} features={drawn} reSites={style.sites ? allSites : []}
                             enzymeDisplay={siteChoice} name={seq.name} />
              : <LinearMap sequence={seq.sequence} features={drawn} reSites={style.sites ? allSites : []}
                           enzymeDisplay={siteChoice} isCircular={seq.type === 'plasmid'} />}
          </div>
          {caption.trim() && (
            <figcaption style={{ fontSize: '0.82rem', color: '#334155', marginTop: '0.6rem', lineHeight: 1.5 }}>{caption}</figcaption>
          )}
        </figure>

        {showLegend && drawn.length > 0 && (
          <section style={{ marginTop: '1rem' }}>
            <h2 style={heading}>Legend</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', fontSize: '0.78rem' }}>
              {byType.map(([type, list]) => (
                <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: list[0].color, display: 'inline-block' }} />
                  {type} ({list.length})
                </span>
              ))}
            </div>
          </section>
        )}

        {showTable && drawn.length > 0 && (
          <section style={{ marginTop: '1rem' }}>
            <h2 style={heading}>Features</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
              <thead>
                <tr>{['Name', 'Type', 'Start', 'End', 'Length', 'Strand'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.2rem 0.4rem', borderBottom: '1px solid #cbd5e1', fontWeight: 600 }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[...drawn].sort((a, b) => a.start - b.start).map(f => (
                  <tr key={f.id} style={{ breakInside: 'avoid' }}>
                    <td style={td}>{f.name}</td>
                    <td style={td}>{f.type}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{f.start.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{f.end.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{(f.end >= f.start ? f.end - f.start + 1 : seq.sequence.length - f.start + 1 + f.end).toLocaleString()} bp</td>
                    <td style={td}>{f.strand === -1 ? '−' : '+'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {showSequence && (
          <section style={{ marginTop: '1rem' }}>
            <h2 style={heading}>Sequence</h2>
            <pre style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.7rem', lineHeight: 1.45, margin: 0, whiteSpace: 'pre-wrap' }}>
              {lines.map(l => (
                `${String(l.at).padStart(6, ' ')}  ${l.bases.replace(/(.{10})/g, '$1 ').trimEnd()}\n`
                + (l.aa ? `${' '.repeat(8)}${l.aa.replace(/(.{10})/g, '$1 ').trimEnd()}\n` : '')
              )).join('')}
            </pre>
          </section>
        )}

        <footer style={{ marginTop: '1.2rem', paddingTop: '0.4rem', borderTop: '1px solid #cbd5e1', fontSize: '0.7rem', color: '#64748b' }}>
          {workspace} · printed {new Date().toLocaleDateString()}
          {drawnSites.length > 0 && ` · ${style.enzymes.length
            ? style.enzymes.join(', ')
            : style.maxCuts === 1 ? 'unique cutters only' : `enzymes cutting up to ${style.maxCuts}×`}`}
          {/*
            On the figure itself, not only in the setup panel. A reader of the
            printed page has no way to know that the map is a selection unless
            the page says so, and a map that looks complete and is not is the
            worst thing this view could produce.
          */}
          {notDrawn > 0 && ` · ${notDrawn} of ${seq.features.length} annotated features not shown`}
        </footer>
      </div>

      <style>{`
        @media print {
          @page { margin: 14mm; }
          /* The application around the figure: the sidebar, the header bar,
             and the controls that set the figure up. */
          /* Not every header: the figure's own title block is one. */
          .no-print, aside, header:not(.figure-head) { display: none !important; }
          /* The app lays itself out as a flex column with its own scrolling
             pane; on paper that pane is the page, and a scroll container
             prints only what was visible in it. */
          .app-container, .main-content, .page-content {
            display: block !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            min-height: 0 !important;
          }
          body { background: #fff !important; }
          /* The map's own zoom controls are part of the drawing on screen and
             furniture on paper. */
          .printable button { display: none !important; }
          /* A table split across a page break loses its header, and a figure
             split across one is no longer a figure. */
          figure, table, section { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

const input: React.CSSProperties = { padding: '0.35rem 0.5rem', fontSize: '0.82rem' };
const heading: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', margin: '0 0 0.35rem' };
const td: React.CSSProperties = { padding: '0.18rem 0.4rem', borderBottom: '1px solid #e2e8f0' };
