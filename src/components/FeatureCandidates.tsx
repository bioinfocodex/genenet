'use client';
import { useState, useTransition } from 'react';
import { Library, Check } from 'lucide-react';
import { addFeaturesToLibrary } from '@/app/actions/sequences';
import { colourForType } from '@/lib/features';
import type { FeatureCandidate } from '@/lib/feature-learning';

/**
 * Parts this sequence could teach the library.
 *
 * Accepting is a decision, not a side effect of importing. An annotation is
 * only as good as the file it came from, and a library quietly filled from
 * every import would soon recognise things that are not there — which costs
 * more than recognising nothing.
 *
 * So the ones worth adding are pre-selected and the rest are shown anyway, with
 * the reason they were passed over. Hiding them would leave someone wondering
 * why a feature they can see on the map was not offered.
 */
export default function FeatureCandidates({
  sequenceId, candidates,
}: {
  sequenceId: string;
  candidates: FeatureCandidate[];
}) {
  const worth = candidates.filter(c => c.worthAdding);
  const passed = candidates.filter(c => !c.worthAdding);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(worth.map(c => c.sequence)));
  const [added, setAdded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);
  const [pending, start] = useTransition();

  if (candidates.length === 0) return null;

  const toggle = (seq: string) =>
    setPicked(p => {
      const next = new Set(p);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });

  const submit = () => {
    const chosen = worth.filter(c => picked.has(c.sequence));
    if (chosen.length === 0) { setError('Nothing selected.'); return; }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('sequenceId', sequenceId);
      fd.append('parts', JSON.stringify(chosen.map(c => ({
        name: c.name, type: c.type, color: colourForType(c.type), sequence: c.sequence,
      }))));
      const r = await addFeaturesToLibrary(fd);
      if ('error' in r) setError(r.error);
      else setAdded(r.added);
    });
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h2 style={{
        fontSize: '1rem', fontWeight: 700, margin: '0 0 0.3rem',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        <Library size={16} /> Teach the library
      </h2>
      <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', margin: '0 0 1rem', lineHeight: 1.6, maxWidth: '68ch' }}>
        This sequence carries annotations the library does not know. Adding them means the next
        plasmid with the same part gets it recognised automatically — which is how a lab&rsquo;s own
        vectors stop being tribal knowledge.
      </p>

      {added !== null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
          <Check size={16} color="var(--accent-green)" />
          {added === 0
            ? 'Nothing new — the library already had those.'
            : `${added} part${added === 1 ? '' : 's'} added. They will be found automatically from now on.`}
        </div>
      ) : (
        <>
          {worth.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {worth.map((c, i) => (
                <label key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.5rem 0.7rem', borderRadius: 7, cursor: 'pointer',
                  border: `1px solid ${picked.has(c.sequence) ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                  background: picked.has(c.sequence) ? 'rgba(59,130,246,0.05)' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={picked.has(c.sequence)}
                    onChange={() => toggle(c.sequence)}
                  />
                  <span style={{
                    width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                    background: colourForType(c.type),
                  }} />
                  <span style={{ fontWeight: 600, fontSize: '0.87rem' }}>{c.name}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.type}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {c.sequence.length} bp
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              Nothing here is worth adding. The reasons are below.
            </p>
          )}

          {worth.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={submit} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.83rem' }}>
                {pending ? 'Adding…' : `Add ${picked.size} to library`}
              </button>
              <button
                onClick={() => setPicked(p => p.size === worth.length ? new Set() : new Set(worth.map(c => c.sequence)))}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem' }}
              >
                {picked.size === worth.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
          )}

          {error && <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: '0.5rem' }}>{error}</div>}
        </>
      )}

      {passed.length > 0 && (
        <div style={{ marginTop: '1.1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--glass-border)' }}>
          <button
            onClick={() => setShowPassed(s => !s)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'inherit',
            }}
          >
            {showPassed ? '▾' : '▸'} {passed.length} not offered
          </button>
          {showPassed && (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {passed.map((c, i) => (
                <li key={i} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <strong style={{ fontWeight: 600 }}>{c.name}</strong> — {c.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
