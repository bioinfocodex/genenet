'use client';
import { useState, useTransition } from 'react';
import { SlidersHorizontal, Check } from 'lucide-react';
import {
  type MapStyle, type TypeRow, defaultStyle, serialiseStyle,
} from '@/lib/map-display';
import { saveMapStyle } from '@/app/actions/sequences';

/**
 * What this map leaves out, and whether that choice is kept.
 *
 * A plasmid that has been through annotation and an assembly carries forty
 * features, half of them `misc_feature` from whatever file they came in on.
 * Deleting them is the wrong answer -- they are correct, and the next person
 * will want them -- so the map has to be able to leave them out, and the
 * choice has to survive a reload or it is no use for preparing a figure.
 *
 * The count of what is not drawn is shown whether or not this panel is open.
 * A filter that silently removes features turns a map into a claim that the
 * molecule contains only what is on the page, and that is the one thing a map
 * must never say.
 */

/** Floors worth offering: the clutter on a real map is tags, RBSs and linkers. */
const FLOORS = [0, 25, 50, 100, 250];

export default function MapStylePanel({
  style, rows, notDrawn, total, onChange, sequenceId,
}: {
  style: MapStyle;
  rows: TypeRow[];
  /** How many features the style is leaving out, counted by the drawing's own rule. */
  notDrawn: number;
  total: number;
  onChange: (next: MapStyle) => void;
  /** Null when there is nothing to save to -- an unsaved or scratch sequence. */
  sequenceId?: string | null;
}) {
  const [open, setOpen] = useState(false);

  const toggleType = (type: string) => {
    const hidden = style.hiddenTypes.includes(type);
    onChange({
      ...style,
      hiddenTypes: hidden
        ? style.hiddenTypes.filter(t => t !== type)
        : [...style.hiddenTypes, type],
    });
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="btn btn-secondary"
        style={{
          fontSize: '0.74rem', padding: '0.22rem 0.5rem', display: 'flex',
          alignItems: 'center', gap: '0.3rem',
        }}
        title="Which features and layers this map draws"
      >
        <SlidersHorizontal size={12} />
        Drawn
        {notDrawn > 0 && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, padding: '0.05rem 0.3rem', borderRadius: 8,
            background: 'rgba(217,119,6,0.15)', color: '#a3560a',
          }}>
            {notDrawn} left out
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Clicking anywhere else closes it, the way the other popovers here do. */}
          <div onClick={() => setOpen(false)}
               style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            /*
             * Hung from the right edge of its own button. Anchored left it
             * ran off the side of the map pane -- the toolbar it sits in is
             * right-aligned, so there is room to the left of the button and
             * none to the right of it.
             */
            position: 'absolute', top: 'calc(100% + 0.35rem)', right: 0, zIndex: 41,
            width: 280, maxHeight: 420, overflowY: 'auto',
            background: 'white', border: '1px solid var(--glass-border)',
            borderRadius: 10, boxShadow: '0 8px 28px rgba(15,23,42,0.14)',
            padding: '0.7rem 0.8rem', fontSize: '0.8rem',
          }}>
            <Heading>Feature types on this sequence</Heading>
            {rows.length === 0 && (
              <p style={{ margin: '0 0 0.6rem', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                Nothing annotated yet.
              </p>
            )}
            {rows.map(r => (
              <label key={r.type} style={row}>
                <input
                  type="checkbox"
                  checked={!r.hidden}
                  onChange={() => toggleType(r.type)}
                />
                <span style={{
                  width: 10, height: 10, borderRadius: 3, background: r.colour,
                  border: '1px solid rgba(0,0,0,0.25)', flexShrink: 0,
                }} />
                <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.76rem' }}>{r.type}</span>
                <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{r.count}</span>
              </label>
            ))}

            <Heading>Shortest feature drawn</Heading>
            <select
              value={style.minLength}
              onChange={e => onChange({ ...style, minLength: Number(e.target.value) })}
              className="input-control"
              style={{ width: '100%', fontSize: '0.76rem', padding: '0.22rem 0.4rem', marginBottom: '0.6rem' }}
              title="A spliced feature counts by its exons, not the introns between them"
            >
              {FLOORS.map(n => (
                <option key={n} value={n}>{n === 0 ? 'draw them all' : `${n} bp and longer`}</option>
              ))}
            </select>

            <Heading>Layers</Heading>
            <label style={row}>
              <input type="checkbox" checked={style.sites}
                     onChange={e => onChange({ ...style, sites: e.target.checked })} />
              <span style={{ flex: 1 }}>Restriction sites</span>
            </label>
            <label style={row}>
              <input type="checkbox" checked={style.primers}
                     onChange={e => onChange({ ...style, primers: e.target.checked })} />
              <span style={{ flex: 1 }}>Primers</span>
            </label>

            <div style={{
              marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--glass-border)',
              display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', flex: 1 }}>
                {notDrawn === 0
                  ? `all ${total} features drawn`
                  : `${notDrawn} of ${total} features left out`}
              </span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.72rem', padding: '0.18rem 0.45rem' }}
                onClick={() => onChange(defaultStyle())}
                title="Back to the shipped defaults"
              >
                Reset
              </button>
            </div>

            {sequenceId && <SaveRow style={style} sequenceId={sequenceId} />}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Keeping the style, as its own control.
 *
 * Deliberately not automatic. The filters are also used to look at something
 * for a moment -- hide the imported clutter, find the one site, put it back --
 * and writing every one of those to the record would make "how this sequence
 * is drawn" mean "however it was last glanced at".
 */
function SaveRow({ style, sequenceId }: { style: MapStyle; sequenceId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  const save = () => {
    setDone(false);
    start(async () => {
      const fd = new FormData();
      fd.append('id', sequenceId);
      const json = serialiseStyle(style);
      if (json) fd.append('style', json);
      await saveMapStyle(fd);
      setDone(true);
    });
  };

  return (
    <div style={{ marginTop: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <button
        className="btn btn-primary"
        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
        disabled={pending}
        onClick={save}
        title="The figure view draws this sequence with the style saved here"
      >
        {pending ? 'Saving…' : 'Keep for this sequence'}
      </button>
      {done && !pending && (
        <span style={{ fontSize: '0.72rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <Check size={12} /> kept
        </span>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '0.5rem 0 0.3rem',
    }}>
      {children}
    </div>
  );
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.12rem 0', cursor: 'pointer',
};
