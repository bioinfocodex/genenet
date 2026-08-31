'use client';
import { useState, useTransition } from 'react';
import { saveConstruct } from '@/app/actions/sequences';
import type { Assembly, AssemblyProblem } from '@/lib/assembly';

/**
 * What an assembly produced, and whether to believe it.
 *
 * Problems come first and cannot be collapsed. A construct that can go together
 * two ways still has a sequence, and showing that sequence above the warning
 * invites someone to copy it and order primers against it. The order here is
 * deliberate.
 */

export interface JunctionRow {
  from: string;
  to: string;
  shared: string;
  detail?: string;
  warnings?: string[];
}

export function ProblemList({ problems }: { problems: AssemblyProblem[] }) {
  if (problems.length === 0) return null;
  const severe = problems.some(p => p.kind === 'no-assembly' || p.kind === 'multiple-assemblies');
  return (
    <div className="glass-panel" style={{
      padding: '1.1rem 1.35rem',
      border: `1px solid ${severe ? 'rgba(220,38,38,0.35)' : 'rgba(217,119,6,0.35)'}`,
      background: severe ? 'rgba(220,38,38,0.05)' : 'rgba(217,119,6,0.05)',
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: severe ? '#b91c1c' : '#a3560a', marginBottom: '0.5rem',
      }}>
        {severe ? 'This will not work as designed' : 'Worth checking before you set it up'}
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {problems.map((p, i) => (
          <li key={i} style={{ fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{p.message}</li>
        ))}
      </ul>
    </div>
  );
}

export function ConstructPanel({
  assembly, junctions, method, accent,
}: {
  assembly: Assembly;
  junctions: JunctionRow[];
  method: string;
  accent: string;
}) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [showSeq, setShowSeq] = useState(false);

  const partNames = assembly.order.map(o => o.name).join(', ');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the construct a name first.'); return; }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('name', trimmed);
      fd.append('sequence', assembly.sequence);
      fd.append('method', method);
      fd.append('parts', partNames);
      fd.append('topology', assembly.topology);
      const r = await saveConstruct(fd);
      if ('error' in r) setError(r.error);
      else setSaved(r.id);
    });
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: `4px solid ${accent}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Product</h3>
        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {assembly.sequence.length.toLocaleString()} bp &middot; {assembly.topology}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', margin: '0.9rem 0' }}>
        {assembly.order.map((p, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{
              fontSize: '0.8rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: 5,
              background: `${accent}18`, color: accent, border: `1px solid ${accent}35`,
            }}>
              {p.name}{p.flipped && <span title="reverse-complemented to fit"> &#8634;</span>}
            </span>
            {i < assembly.order.length - 1 && <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>}
          </span>
        ))}
        {assembly.topology === 'circular' && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>&#8635; closes</span>
        )}
      </div>

      {junctions.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', width: '100%', minWidth: 420 }}>
            <thead>
              <tr>
                {['Junction', 'Shared sequence', ''].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '0.3rem 0.6rem', color: 'var(--text-muted)',
                    fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                    borderBottom: '1px solid var(--glass-border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {junctions.map((j, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.35rem 0.6rem', whiteSpace: 'nowrap' }}>{j.from} &rarr; {j.to}</td>
                  <td style={{ padding: '0.35rem 0.6rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{j.shared}</td>
                  <td style={{ padding: '0.35rem 0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {j.detail}
                    {j.warnings?.length ? <span style={{ color: '#a3560a' }}> &#9888;</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {junctions.flatMap(j => j.warnings ?? []).length > 0 && (
            <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.1rem' }}>
              {junctions.flatMap(j => (j.warnings ?? []).map(w => `${j.from} - ${j.to}: ${w}`)).map((w, i) => (
                <li key={i} style={{ fontSize: '0.78rem', color: '#a3560a', lineHeight: 1.5 }}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button onClick={() => setShowSeq(s => !s)} className="btn btn-secondary" style={{ fontSize: '0.78rem', marginBottom: showSeq ? '0.6rem' : 0 }}>
        {showSeq ? 'Hide sequence' : 'Show sequence'}
      </button>
      {showSeq && (
        <textarea
          readOnly
          value={assembly.sequence}
          onFocus={e => e.currentTarget.select()}
          style={{
            width: '100%', height: 120, fontFamily: 'monospace', fontSize: '0.7rem',
            padding: '0.6rem', border: '1px solid var(--glass-border)', borderRadius: 6,
            background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
      )}

      <div style={{ marginTop: '1.1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
        {saved ? (
          <div style={{ fontSize: '0.85rem' }}>
            Saved. <a href={`/sequences/${saved}`} style={{ color: accent, fontWeight: 600 }}>Open the construct &rarr;</a>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name this construct"
              className="input-control"
              style={{ flex: 1, minWidth: 200, fontSize: '0.85rem', padding: '0.45rem 0.7rem' }}
            />
            <button onClick={save} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
              {pending ? 'Saving…' : 'Save to library'}
            </button>
          </div>
        )}
        {error && <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: '0.45rem' }}>{error}</div>}
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.55rem 0 0', lineHeight: 1.5 }}>
          Saving makes it a sequence like any other &mdash; mappable, digestible, and something a
          Sanger read can be checked against.
        </p>
      </div>
    </div>
  );
}
