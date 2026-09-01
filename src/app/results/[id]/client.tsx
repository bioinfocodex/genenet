'use client';
import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Grid3x3, Trash2, Sigma } from 'lucide-react';
import { recordResult, recordPlateResults, deleteResult } from '@/app/actions/results';
import { format as formatValue, type FieldDefinition } from '@/lib/fields';
import { summariseResults, groupBy, fmt, type NumericSummary } from '@/lib/result-stats';

/**
 * Reading and recording an assay.
 *
 * The summary comes before the table. A hundred rows of numbers is the raw
 * material, not the answer; putting the mean and spread underneath them would
 * make people scroll past the thing they came for.
 */

interface Storedish {
  fieldId: string;
  text: string | null; number: number | null; boolean: boolean | null;
  date: string | null; refId: string | null; refEntityId: string | null;
}

export interface Result {
  id: string;
  measuredAt: string;
  recordedBy: string | null;
  canDelete: boolean;
  values: Storedish[];
  target: { kind: string; id: string; label: string; href: string } | null;
}

const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.22rem',
};

const CONTROL: React.CSSProperties = { width: '100%', fontSize: '0.84rem', padding: '0.38rem 0.55rem' };

/** Dates arrive as ISO strings over the wire; the formatter wants Dates. */
function revive(v: Storedish) {
  return { ...v, date: v.date ? new Date(v.date) : null };
}

function StatCard({ s }: { s: NumericSummary }) {
  return (
    <div style={{
      border: '1px solid var(--glass-border)', borderRadius: 8, padding: '0.8rem 1rem',
      minWidth: 168, flex: '1 1 168px',
    }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {s.label}{s.unit ? ` (${s.unit})` : ''}
      </div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', margin: '0.2rem 0 0.1rem' }}>
        {fmt(s.mean)}
        {s.sd !== null && (
          <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)' }}> ± {fmt(s.sd)}</span>
        )}
      </div>
      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        n = {s.n} &middot; {fmt(s.min)}–{fmt(s.max)}
        {s.cv !== null && <> &middot; CV {s.cv.toFixed(1)}%</>}
      </div>
    </div>
  );
}

export default function ResultsClient({
  schema, defs, results, samples, entities, tasks, plates,
}: {
  schema: { id: string; name: string };
  defs: FieldDefinition[];
  results: Result[];
  samples: { id: string; sampleId: string; name: string }[];
  entities: { id: string; code: string; name: string }[];
  tasks: { id: string; title: string }[];
  plates: { id: string; name: string; format: number }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'single' | 'plate'>('none');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [measuredAt, setMeasuredAt] = useState(new Date().toISOString().slice(0, 10));
  const [targetKind, setTargetKind] = useState('');
  const [targetId, setTargetId] = useState('');
  const [groupKey, setGroupKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Plate paste
  const [platePasteId, setPlatePasteId] = useState('');
  const [gridField, setGridField] = useState(defs.find(d => d.type === 'number' || d.type === 'integer')?.key ?? '');
  const [grid, setGrid] = useState('');

  const rows = useMemo(
    () => results.map(r => ({ ...r, values: r.values.map(revive) })),
    [results],
  );
  const summary = useMemo(() => summariseResults(defs, rows), [defs, rows]);
  const groupable = defs.filter(d => ['select', 'boolean', 'multiselect'].includes(d.type));
  const groups = useMemo(() => {
    const g = groupable.find(d => d.key === groupKey);
    return g ? groupBy(defs, rows, g) : [];
  }, [defs, rows, groupKey, groupable]);

  const numericFields = defs.filter(d => d.type === 'number' || d.type === 'integer');

  const act = (fn: () => Promise<{ error?: string } & Record<string, unknown>>) => {
    setError(null); setMessage(null);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      if (typeof r.count === 'number') setMessage(`${r.count} reading${r.count === 1 ? '' : 's'} recorded.`);
      setValues({}); setGrid('');
      router.refresh();
    });
  };

  const submitSingle = () => act(() => {
    const fd = new FormData();
    fd.append('schemaId', schema.id);
    fd.append('values', JSON.stringify(values));
    fd.append('measuredAt', measuredAt);
    if (targetKind && targetId) fd.append(`${targetKind}Id`, targetId);
    return recordResult(fd) as Promise<{ error?: string } & Record<string, unknown>>;
  });

  const submitPlate = () => act(() => {
    const fd = new FormData();
    fd.append('schemaId', schema.id);
    fd.append('plateId', platePasteId);
    fd.append('fieldKey', gridField);
    fd.append('grid', grid);
    fd.append('measuredAt', measuredAt);
    return recordPlateResults(fd) as Promise<{ error?: string } & Record<string, unknown>>;
  });

  const targetOptions =
    targetKind === 'sample' ? samples.map(s => ({ id: s.id, label: `${s.sampleId} · ${s.name}` }))
    : targetKind === 'entity' ? entities.map(e => ({ id: e.id, label: `${e.code} · ${e.name}` }))
    : targetKind === 'task' ? tasks.map(t => ({ id: t.id, label: t.title }))
    : [];

  return (
    <>
      {results.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Sigma size={16} /> {results.length} reading{results.length === 1 ? '' : 's'}
          </h2>

          {summary.numeric.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7rem' }}>
              {summary.numeric.map(s => <StatCard key={s.key} s={s} />)}
            </div>
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              Nothing numeric recorded yet, so there is nothing to average.
            </p>
          )}

          {summary.categorical.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem', marginTop: '1rem' }}>
              {summary.categorical.map(c => (
                <div key={c.key}>
                  <div style={LABEL}>{c.label}</div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {c.counts.map(v => (
                      <span key={v.value} style={{ fontSize: '0.82rem' }}>
                        {v.value} <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{v.count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {groupable.length > 0 && numericFields.length > 0 && (
            <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
              <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: groupKey ? '0.8rem' : 0 }}>
                Split by
                <select value={groupKey} onChange={e => setGroupKey(e.target.value)}
                  className="input-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}>
                  <option value="">nothing</option>
                  {groupable.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </label>

              {groups.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 380 }}>
                    <thead>
                      <tr>
                        {['Group', 'n', ...numericFields.map(f => f.label)].map(h => (
                          <th key={h} style={{
                            textAlign: h === 'Group' ? 'left' : 'right',
                            padding: '0.3rem 0.7rem', color: 'var(--text-muted)', fontWeight: 600,
                            fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                            borderBottom: '1px solid var(--glass-border)', whiteSpace: 'nowrap',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g => (
                        <tr key={g.value}>
                          <td style={{ padding: '0.35rem 0.7rem', fontWeight: 600 }}>{g.value}</td>
                          <td style={{ padding: '0.35rem 0.7rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g.count}</td>
                          {numericFields.map(f => {
                            const s = g.numeric.find(x => x.key === f.key);
                            return (
                              <td key={f.key} style={{ padding: '0.35rem 0.7rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {s ? <>{fmt(s.mean)}{s.sd !== null && <span style={{ color: 'var(--text-muted)' }}> ± {fmt(s.sd)}</span>}</> : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: mode === 'none' ? 0 : '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => { setMode(mode === 'single' ? 'none' : 'single'); setError(null); }}
            className={mode === 'single' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Plus size={14} /> Record a reading
          </button>
          <button onClick={() => { setMode(mode === 'plate' ? 'none' : 'plate'); setError(null); }}
            className={mode === 'plate' ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Grid3x3 size={14} /> Paste a plate
          </button>
        </div>

        {mode === 'single' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
              {defs.map(def => (
                <div key={def.key}>
                  <label style={LABEL}>
                    {def.label}
                    {def.required && <span style={{ color: '#b91c1c' }}> *</span>}
                    {def.unit && <span style={{ textTransform: 'none', fontWeight: 400 }}> ({def.unit})</span>}
                  </label>
                  {def.type === 'select' ? (
                    <select value={(values[def.key] as string) ?? ''} onChange={e => setValues(v => ({ ...v, [def.key]: e.target.value }))}
                      className="input-control" style={CONTROL}>
                      <option value="">—</option>
                      {(def.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : def.type === 'boolean' ? (
                    <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input type="checkbox" checked={values[def.key] === true}
                        onChange={e => setValues(v => ({ ...v, [def.key]: e.target.checked }))} />
                      {values[def.key] === true ? 'Yes' : 'No'}
                    </label>
                  ) : def.type === 'longtext' ? (
                    <textarea value={(values[def.key] as string) ?? ''} onChange={e => setValues(v => ({ ...v, [def.key]: e.target.value }))}
                      className="input-control" style={{ ...CONTROL, height: 62, resize: 'vertical' }} />
                  ) : (
                    <input
                      type={def.type === 'number' || def.type === 'integer' ? 'number' : def.type === 'date' ? 'date' : 'text'}
                      step={def.type === 'integer' ? 1 : 'any'}
                      value={(values[def.key] as string) ?? ''}
                      onChange={e => setValues(v => ({ ...v, [def.key]: e.target.value }))}
                      className="input-control" style={CONTROL}
                    />
                  )}
                </div>
              ))}

              <div>
                <label style={LABEL}>Measured on</label>
                <input type="date" value={measuredAt} onChange={e => setMeasuredAt(e.target.value)}
                  className="input-control" style={CONTROL} />
              </div>
              <div>
                <label style={LABEL}>Measured on what</label>
                <select value={targetKind} onChange={e => { setTargetKind(e.target.value); setTargetId(''); }}
                  className="input-control" style={CONTROL}>
                  <option value="">Nothing in particular</option>
                  <option value="sample">A sample</option>
                  <option value="entity">A record</option>
                  <option value="task">A task</option>
                </select>
              </div>
              {targetKind && (
                <div>
                  <label style={LABEL}>Which one</label>
                  <select value={targetId} onChange={e => setTargetId(e.target.value)}
                    className="input-control" style={CONTROL}>
                    <option value="">—</option>
                    {targetOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>
            <button onClick={submitSingle} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.83rem', marginTop: '1rem' }}>
              {pending ? 'Recording…' : 'Record it'}
            </button>
          </>
        )}

        {mode === 'plate' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem', marginBottom: '0.8rem' }}>
              <div>
                <label style={LABEL}>Plate</label>
                <select value={platePasteId} onChange={e => setPlatePasteId(e.target.value)}
                  className="input-control" style={CONTROL}>
                  <option value="">Choose a plate</option>
                  {plates.map(p => <option key={p.id} value={p.id}>{p.name} ({p.format}-well)</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>These numbers are</label>
                <select value={gridField} onChange={e => setGridField(e.target.value)}
                  className="input-control" style={CONTROL}>
                  {numericFields.map(f => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>Measured on</label>
                <input type="date" value={measuredAt} onChange={e => setMeasuredAt(e.target.value)}
                  className="input-control" style={CONTROL} />
              </div>
            </div>

            <label style={LABEL}>Paste the grid</label>
            <textarea
              value={grid} onChange={e => setGrid(e.target.value)}
              placeholder={'0.412\t0.398\t0.455…\n0.501\t0.488\t0.472…'}
              style={{
                width: '100%', height: 150, fontFamily: 'monospace', fontSize: '0.74rem',
                padding: '0.6rem', border: '1px solid var(--glass-border)', borderRadius: 8,
                background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
              }}
            />
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.45rem 0 0', lineHeight: 1.55 }}>
              Numbers only, in plate order &mdash; one row per plate row, tab or comma separated. Leave
              out the row letters and column numbers: a grid that includes them does not fit the
              plate, and is refused rather than filed one row out of place.
              {numericFields.length === 0 && ' This assay has no numeric field to fill.'}
            </p>
            <button onClick={submitPlate} disabled={pending || !platePasteId || !grid.trim() || numericFields.length === 0}
              className="btn btn-primary" style={{ fontSize: '0.83rem', marginTop: '0.9rem' }}>
              {pending ? 'Recording…' : 'Record the plate'}
            </button>
          </>
        )}

        {message && <div style={{ fontSize: '0.83rem', color: 'var(--accent-green)', marginTop: '0.7rem' }}>{message}</div>}
        {error && <div style={{ fontSize: '0.83rem', color: '#b91c1c', marginTop: '0.7rem' }}>{error}</div>}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.85rem' }}>Readings</h2>
        {results.length === 0 ? (
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: 0 }}>Nothing recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.79rem', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Measured', 'On', ...defs.map(d => d.label), 'By', ''].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '0.35rem 0.6rem', color: 'var(--text-muted)',
                      fontWeight: 600, fontSize: '0.67rem', textTransform: 'uppercase',
                      letterSpacing: '0.04em', borderBottom: '1px solid var(--glass-border)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map(r => {
                  const byField = new Map(r.values.map(v => [v.fieldId, v]));
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: '0.35rem 0.6rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                        {new Date(r.measuredAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', whiteSpace: 'nowrap' }}>
                        {r.target
                          ? <Link href={r.target.href} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{r.target.label}</Link>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      {defs.map(d => (
                        <td key={d.key} style={{ padding: '0.35rem 0.6rem', fontVariantNumeric: 'tabular-nums' }}>
                          {formatValue(d, byField.get(d.id!))}
                        </td>
                      ))}
                      <td style={{ padding: '0.35rem 0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {r.recordedBy ?? '—'}
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem' }}>
                        {r.canDelete && (
                          <button
                            onClick={() => {
                              if (!confirm('Remove this reading?')) return;
                              act(() => {
                                const fd = new FormData();
                                fd.append('id', r.id);
                                return deleteResult(fd) as Promise<{ error?: string } & Record<string, unknown>>;
                              });
                            }}
                            disabled={pending}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 2 }}
                            title="Remove this reading"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {results.length > 300 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
                Showing the 300 most recent. The summary above covers all {results.length}.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
