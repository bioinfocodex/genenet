'use client';
import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Beaker, ArrowRightLeft, Droplets, Eraser } from 'lucide-react';
import { fillWells, clearWells, transferPlate, layoutDilution } from '@/app/actions/plates';
import { formatOf, rowLabel, roleColours, summarise, isEmpty, type WellLike } from '@/lib/plates';

/**
 * The plate map.
 *
 * Selection is by dragging a rectangle, because that is the shape of what a
 * multichannel pipette touches, and the range box below always shows the same
 * selection written out — so someone who prefers typing "A1:H3" and someone who
 * prefers dragging are editing the same thing and can see they are.
 */

export interface Well extends WellLike {
  id: string;
  notes: string | null;
  volumeUl: number | null;
  concentration: number | null;
  concentrationUnit: string | null;
  sampleName: string | null;
  entityName: string | null;
  sequenceName: string | null;
}

const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.22rem',
};

/** "A1:C4, E1" from a set of selected keys — the same notation the box takes. */
function describeSelection(keys: Set<string>): string {
  if (keys.size === 0) return '';
  const cells = [...keys].map(k => {
    const [r, c] = k.split(':').map(Number);
    return { row: r, col: c };
  }).sort((a, b) => a.row - b.row || a.col - b.col);

  // A single rectangle is by far the common case and reads far better as one
  // range than as a list of every well in it.
  const rows = cells.map(c => c.row), cols = cells.map(c => c.col);
  const r0 = Math.min(...rows), r1 = Math.max(...rows);
  const c0 = Math.min(...cols), c1 = Math.max(...cols);
  if ((r1 - r0 + 1) * (c1 - c0 + 1) === cells.length) {
    return r0 === r1 && c0 === c1
      ? `${rowLabel(r0)}${c0 + 1}`
      : `${rowLabel(r0)}${c0 + 1}:${rowLabel(r1)}${c1 + 1}`;
  }
  return cells.map(c => `${rowLabel(c.row)}${c.col + 1}`).join(', ');
}

export default function PlateClient({
  plate, wells, samples, entities, sequences, otherPlates,
}: {
  plate: { id: string; name: string; format: number };
  wells: Well[];
  samples: { id: string; sampleId: string; name: string }[];
  entities: { id: string; code: string; name: string }[];
  sequences: { id: string; name: string }[];
  otherPlates: { id: string; name: string; format: number }[];
}) {
  const router = useRouter();
  const f = formatOf(plate.format);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragFrom, setDragFrom] = useState<{ row: number; col: number } | null>(null);
  const [tab, setTab] = useState<'fill' | 'transfer' | 'dilute'>('fill');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Fill form
  const [role, setRole] = useState('');
  const [content, setContent] = useState('');
  const [sampleId, setSampleId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [volumeUl, setVolumeUl] = useState('');

  // Transfer form
  const [destId, setDestId] = useState('');
  const [kind, setKind] = useState('stamp');
  const [quad, setQuad] = useState(0);

  // Dilution form
  const [steps, setSteps] = useState(8);
  const [fold, setFold] = useState(10);
  const [direction, setDirection] = useState<'row' | 'column'>('row');

  const byKey = useMemo(() => new Map(wells.map(w => [`${w.row}:${w.col}`, w])), [wells]);
  const colours = useMemo(() => roleColours(wells), [wells]);
  const stats = useMemo(() => summarise(wells, f), [wells, f]);
  const rangeText = describeSelection(selected);

  const rectBetween = (a: { row: number; col: number }, b: { row: number; col: number }) => {
    const out = new Set<string>();
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.add(`${r}:${c}`);
    }
    return out;
  };

  const run = (fn: () => Promise<{ ok: true } | { error: string } | Record<string, unknown>>) => {
    setError(null); setMessage(null);
    start(async () => {
      const r = await fn() as { error?: string } & Record<string, unknown>;
      if (r.error) { setError(r.error); return; }
      if (typeof r.filled === 'number') setMessage(`${r.filled} well${r.filled === 1 ? '' : 's'} filled.`);
      else if (typeof r.cleared === 'number') setMessage(`${r.cleared} well${r.cleared === 1 ? '' : 's'} cleared.`);
      else if (typeof r.moved === 'number') setMessage(`${r.moved} well${r.moved === 1 ? '' : 's'} moved.`);
      else if (typeof r.wells === 'number') setMessage(`${r.wells} wells laid out.`);
      router.refresh();
    });
  };

  const doFill = () => {
    if (!rangeText) { setError('Select some wells first.'); return; }
    run(() => {
      const fd = new FormData();
      fd.append('plateId', plate.id);
      fd.append('range', rangeText);
      fd.append('role', role);
      fd.append('content', content);
      fd.append('sampleId', sampleId);
      fd.append('entityId', entityId);
      fd.append('sequenceId', sequenceId);
      fd.append('volumeUl', volumeUl);
      return fillWells(fd);
    });
  };

  const doClear = () => {
    if (!rangeText) { setError('Select some wells first.'); return; }
    run(() => {
      const fd = new FormData();
      fd.append('plateId', plate.id);
      fd.append('range', rangeText);
      return clearWells(fd);
    });
  };

  const doTransfer = () => {
    if (!destId) { setError('Choose a destination plate.'); return; }
    run(() => {
      const fd = new FormData();
      fd.append('sourceId', plate.id);
      fd.append('destId', destId);
      fd.append('kind', kind);
      fd.append('sourceRange', kind === 'quadrant' ? '' : rangeText);
      fd.append('quadrant', String(quad));
      fd.append('volumeUl', volumeUl);
      return transferPlate(fd);
    });
  };

  const doDilute = () => {
    if (!rangeText) { setError('Select the well to start from.'); return; }
    run(() => {
      const fd = new FormData();
      fd.append('plateId', plate.id);
      fd.append('start', rangeText.split(':')[0].split(',')[0].trim());
      fd.append('steps', String(steps));
      fd.append('fold', String(fold));
      fd.append('direction', direction);
      fd.append('role', role);
      return layoutDilution(fd);
    });
  };

  // Small plates get big wells; a 384 needs them small enough to fit.
  const wellSize = f.cols <= 12 ? 34 : f.cols <= 24 ? 20 : 12;

  return (
    <>
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ overflowX: 'auto', paddingBottom: '0.4rem' }}>
          <div style={{ display: 'inline-block', minWidth: 'min-content' }}
            onMouseLeave={() => setDragFrom(null)}
            onMouseUp={() => setDragFrom(null)}
          >
            {/* Column numbers */}
            <div style={{ display: 'flex', gap: 2, marginLeft: 24 }}>
              {Array.from({ length: f.cols }, (_, c) => (
                <div key={c} style={{
                  width: wellSize, textAlign: 'center', fontSize: '0.62rem',
                  color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {f.cols <= 24 || (c + 1) % 2 === 1 ? c + 1 : ''}
                </div>
              ))}
            </div>

            {Array.from({ length: f.rows }, (_, r) => (
              <div key={r} style={{ display: 'flex', gap: 2, marginTop: 2, alignItems: 'center' }}>
                <div style={{ width: 24, fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {rowLabel(r)}
                </div>
                {Array.from({ length: f.cols }, (_, c) => {
                  const key = `${r}:${c}`;
                  const w = byKey.get(key);
                  const on = selected.has(key);
                  // Same rule as isEmpty: a role marks the well as laid out.
                  const filled = w && !isEmpty(w);
                  const colour = w?.role ? colours[w.role] : undefined;
                  const title = w
                    ? [w.label, w.sampleName ?? w.entityName ?? w.sequenceName ?? w.content ?? 'empty',
                       w.role, w.volumeUl ? `${w.volumeUl} µl` : null].filter(Boolean).join(' · ')
                    : key;
                  return (
                    <div
                      key={c}
                      title={title}
                      onMouseDown={e => {
                        e.preventDefault();
                        setDragFrom({ row: r, col: c });
                        setSelected(prev => {
                          if (e.shiftKey) { const n = new Set(prev); n.add(key); return n; }
                          return new Set([key]);
                        });
                      }}
                      onMouseEnter={() => {
                        if (!dragFrom) return;
                        setSelected(rectBetween(dragFrom, { row: r, col: c }));
                      }}
                      style={{
                        width: wellSize, height: wellSize, borderRadius: '50%',
                        cursor: 'pointer', flexShrink: 0,
                        background: filled ? (colour ?? 'var(--accent-blue)') : 'transparent',
                        border: on
                          ? '2px solid var(--accent-blue)'
                          : `1px solid ${filled ? 'transparent' : 'var(--glass-border)'}`,
                        boxShadow: on ? '0 0 0 2px rgba(59,130,246,0.25)' : undefined,
                        opacity: filled ? 0.92 : 1,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {stats.roles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginTop: '0.9rem' }}>
            {stats.roles.map(r => (
              <span key={r.role} style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: colours[r.role] }} />
                {r.role} <span style={{ color: 'var(--text-muted)' }}>({r.count})</span>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <label style={LABEL}>Selection</label>
          <input
            value={rangeText}
            onChange={e => {
              // Typing a range is the same act as dragging one; both end up in
              // the same place, so the box is editable rather than read-only.
              const text = e.target.value;
              const next = new Set<string>();
              for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) {
                const m = /^([A-Za-z]{1,2})(\d{1,2})(?::([A-Za-z]{1,2})(\d{1,2}))?$/.exec(part);
                if (!m) continue;
                const toIdx = (s: string) => s.toUpperCase().length === 1
                  ? s.toUpperCase().charCodeAt(0) - 65
                  : (s.toUpperCase().charCodeAt(0) - 64) * 26 + (s.toUpperCase().charCodeAt(1) - 65);
                const r0 = toIdx(m[1]), c0 = Number(m[2]) - 1;
                const r1 = m[3] ? toIdx(m[3]) : r0, c1 = m[4] ? Number(m[4]) - 1 : c0;
                for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
                  for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
                    if (r < f.rows && c < f.cols) next.add(`${r}:${c}`);
                  }
                }
              }
              setSelected(next);
            }}
            placeholder="A1:H12"
            className="input-control"
            style={{ fontSize: '0.82rem', padding: '0.3rem 0.55rem', fontFamily: 'monospace', minWidth: 160 }}
          />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {selected.size} well{selected.size === 1 ? '' : 's'}
          </span>
          <button onClick={() => setSelected(new Set())} className="btn btn-secondary" style={{ fontSize: '0.76rem' }}>
            Clear selection
          </button>
        </div>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.45rem 0 0' }}>
          Drag to select a block. Shift-click adds a single well.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {([['fill', 'Fill wells', Beaker], ['transfer', 'Transfer', ArrowRightLeft], ['dilute', 'Serial dilution', Droplets]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => { setTab(id); setError(null); setMessage(null); }}
              className={tab === id ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === 'fill' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
              <div>
                <label style={LABEL}>Role (colours the map)</label>
                <input value={role} onChange={e => setRole(e.target.value)} placeholder="control"
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
              <div>
                <label style={LABEL}>Sample</label>
                <select value={sampleId} onChange={e => setSampleId(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                  <option value="">—</option>
                  {samples.map(s => <option key={s.id} value={s.id}>{s.sampleId} · {s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>Record</label>
                <select value={entityId} onChange={e => setEntityId(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                  <option value="">—</option>
                  {entities.map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>Sequence</label>
                <select value={sequenceId} onChange={e => setSequenceId(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                  <option value="">—</option>
                  {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>Or free text</label>
                <input value={content} onChange={e => setContent(e.target.value)} placeholder="LB + Amp"
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
              <div>
                <label style={LABEL}>Volume (µl)</label>
                <input type="number" value={volumeUl} onChange={e => setVolumeUl(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={doFill} disabled={pending || selected.size === 0} className="btn btn-primary" style={{ fontSize: '0.83rem' }}>
                {pending ? 'Working…' : `Fill ${selected.size || ''} well${selected.size === 1 ? '' : 's'}`}
              </button>
              <button onClick={doClear} disabled={pending || selected.size === 0} className="btn btn-secondary"
                style={{ fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Eraser size={13} /> Clear
              </button>
            </div>
          </>
        )}

        {tab === 'transfer' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
              <div>
                <label style={LABEL}>Kind</label>
                <select value={kind} onChange={e => setKind(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                  <option value="stamp">Stamp — well to the same well</option>
                  <option value="quadrant">Quadrant — 96 into a 384</option>
                  <option value="cherry-pick">Cherry-pick — selected wells, packed</option>
                </select>
              </div>
              <div>
                <label style={LABEL}>Destination plate</label>
                <select value={destId} onChange={e => setDestId(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                  <option value="">Choose a plate</option>
                  {otherPlates.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({formatOf(p.format).name})</option>
                  ))}
                </select>
              </div>
              {kind === 'quadrant' && (
                <div>
                  <label style={LABEL}>Quadrant</label>
                  <select value={quad} onChange={e => setQuad(Number(e.target.value))}
                    className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                    <option value={0}>1 — top left (A1)</option>
                    <option value={1}>2 — top right (A2)</option>
                    <option value={2}>3 — bottom left (B1)</option>
                    <option value={3}>4 — bottom right (B2)</option>
                  </select>
                </div>
              )}
              <div>
                <label style={LABEL}>Volume (µl)</label>
                <input type="number" value={volumeUl} onChange={e => setVolumeUl(e.target.value)}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.7rem 0 0', lineHeight: 1.55 }}>
              {kind === 'stamp' && (rangeText
                ? `The ${selected.size} selected wells move to the same positions on the destination.`
                : 'Every filled well moves to the same position on the destination. Select a range to move only part of the plate.')}
              {kind === 'quadrant' && 'All 96 wells interleave into one quadrant of a 384-well plate. Four source plates fill one destination.'}
              {kind === 'cherry-pick' && (rangeText
                ? `The ${selected.size} selected wells are packed into the destination from A1, down the columns.`
                : 'Select the wells to pick first.')}
              {' '}Empty wells never move — that would overwrite the destination with nothing.
            </p>
            <button onClick={doTransfer} disabled={pending || !destId} className="btn btn-primary" style={{ fontSize: '0.83rem', marginTop: '0.9rem' }}>
              {pending ? 'Working…' : 'Run the transfer'}
            </button>
          </>
        )}

        {tab === 'dilute' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.8rem' }}>
              <div>
                <label style={LABEL}>Steps</label>
                <input type="number" min={2} max={24} value={steps} onChange={e => setSteps(Number(e.target.value))}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
              <div>
                <label style={LABEL}>Fold per step</label>
                <input type="number" min={2} value={fold} onChange={e => setFold(Number(e.target.value))}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
              <div>
                <label style={LABEL}>Direction</label>
                <select value={direction} onChange={e => setDirection(e.target.value as 'row' | 'column')}
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }}>
                  <option value="row">Across the row</option>
                  <option value="column">Down the column</option>
                </select>
              </div>
              <div>
                <label style={LABEL}>Role</label>
                <input value={role} onChange={e => setRole(e.target.value)} placeholder="titration"
                  className="input-control" style={{ width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' }} />
              </div>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.7rem 0 0', lineHeight: 1.55 }}>
              Starts at {rangeText.split(':')[0].split(',')[0] || 'the selected well'} and writes the
              cumulative dilution into each well — 1:1, 1:{fold}, 1:{fold * fold}, and so on. The
              cumulative factor is what goes on the axis; the per-step fold is not.
            </p>
            <button onClick={doDilute} disabled={pending || selected.size === 0} className="btn btn-primary" style={{ fontSize: '0.83rem', marginTop: '0.9rem' }}>
              {pending ? 'Working…' : 'Lay out the dilution'}
            </button>
          </>
        )}

        {message && <div style={{ fontSize: '0.83rem', color: 'var(--accent-green)', marginTop: '0.7rem' }}>{message}</div>}
        {error && <div style={{ fontSize: '0.83rem', color: '#b91c1c', marginTop: '0.7rem' }}>{error}</div>}
      </div>
    </>
  );
}
