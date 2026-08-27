'use client';
import { useState, useMemo } from 'react';
import { findGuides, NUCLEASES, type Guide, type Nuclease } from '@/lib/crispr';

/**
 * Guide design against the sequence on screen.
 *
 * Two numbers, kept apart: whether the guide will cut where you want, and
 * whether it will cut anywhere else. Collapsing them into one figure hides the
 * trade-off that actually decides which guide to order.
 *
 * The on-target score is a set of published rules rather than a fitted model,
 * so the panel shows why a guide lost points instead of asking anyone to trust
 * a bare number.
 */

type Props = {
  sequence: string;
  selection: { start: number; end: number } | null;
  onSelect?: (sel: { start: number; end: number }) => void;
};

const LIMIT = 25;

function pct(n: number) { return `${Math.round(n * 100)}%`; }

function scoreColour(score: number) {
  return score >= 80 ? '#16a34a' : score >= 60 ? '#ea580c' : '#dc2626';
}

export default function CrisprPanel({ sequence, selection, onSelect }: Props) {
  const [nuclease, setNuclease] = useState<Nuclease>('SpCas9');
  const [useSelection, setUseSelection] = useState(true);
  const [running, setRunning] = useState(false);
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const clean = useMemo(() => sequence.toUpperCase().replace(/[^ACGTN]/g, ''), [sequence]);
  const region = useSelection && selection && selection.end > selection.start
    ? { start: selection.start, end: selection.end }
    : undefined;

  const run = () => {
    setRunning(true); setError(null); setGuides(null);
    // Yield so the button paints its pending state before the scan blocks.
    setTimeout(() => {
      try {
        setGuides(findGuides(clean, { nuclease, region, limit: LIMIT }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not design guides.');
      }
      setRunning(false);
    }, 0);
  };

  const spec = NUCLEASES[nuclease];

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>CRISPR Guide Design</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Finds protospacers with a {spec.pam} PAM on both strands, scores each one, and checks it
          against the rest of this sequence for other places it could cut.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Nuclease
          </span>
          <select
            className="input-control"
            value={nuclease}
            onChange={e => { setNuclease(e.target.value as Nuclease); setGuides(null); }}
            style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
          >
            {Object.values(NUCLEASES).map(n => (
              <option key={n.name} value={n.name}>{n.name} ({n.pam})</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', paddingBottom: '0.45rem' }}>
          <input
            type="checkbox"
            checked={useSelection && !!selection}
            disabled={!selection}
            onChange={e => { setUseSelection(e.target.checked); setGuides(null); }}
          />
          <span style={{ color: selection ? 'inherit' : 'var(--text-muted)' }}>
            {selection
              ? `Only cut inside the selection (${selection.start + 1}–${selection.end})`
              : 'Select a region to target it'}
          </span>
        </label>

        <button onClick={run} disabled={running || clean.length < 30} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
          {running ? 'Designing…' : 'Design guides'}
        </button>
      </div>

      {clean.length < 30 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          The sequence is too short to hold a guide and its PAM.
        </div>
      )}

      {error && (
        <div style={{ padding: '0.6rem 0.8rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, fontSize: '0.8rem', color: '#991b1b' }}>
          {error}
        </div>
      )}

      {guides && guides.length === 0 && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: 7, fontSize: '0.82rem' }}>
          No {spec.pam} PAM site {region ? 'inside the selected region' : 'in this sequence'}.
          {region && ' Try widening the selection.'}
        </div>
      )}

      {guides && guides.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            {guides.length === LIMIT ? `Best ${LIMIT}` : `${guides.length}`} guide{guides.length === 1 ? '' : 's'},
            ranked by on-target score against specificity. Off-targets are those found in this
            sequence &mdash; not a genome-wide search.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {guides.map(g => {
              const key = `${g.strand}${g.start}`;
              const open = expanded === key;
              const penalties = g.onTarget.reasons.filter(r => r.delta < 0);
              return (
                <div key={key} style={{ border: '1px solid var(--glass-border)', borderRadius: 8, background: 'white', overflow: 'hidden' }}>
                  <button
                    onClick={() => { setExpanded(open ? null : key); onSelect?.({ start: g.start, end: g.end }); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem',
                      padding: '0.5rem 0.7rem', background: 'none', border: 'none', cursor: 'pointer',
                      textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', letterSpacing: '0.02em' }}>
                      {g.protospacer}
                      <span style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>{g.pam}</span>
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.7rem', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        cut {g.cutSite} · {g.strand}
                      </span>
                      <span title="On-target score" style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 800, color: scoreColour(g.onTarget.score) }}>
                        {g.onTarget.score}
                      </span>
                      <span
                        title="Specificity: 100% means nothing else here resembles it"
                        style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: g.offTargets.length ? '#ea580c' : '#16a34a' }}
                      >
                        {pct(g.specificity)}
                      </span>
                    </span>
                  </button>

                  {open && (
                    <div style={{ padding: '0 0.7rem 0.7rem', borderTop: '1px solid var(--glass-border)', fontSize: '0.78rem' }}>
                      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', margin: '0.55rem 0' }}>
                        <span><span style={{ color: 'var(--text-muted)' }}>Position </span>{g.start + 1}–{g.end}</span>
                        <span><span style={{ color: 'var(--text-muted)' }}>GC </span>{pct(g.onTarget.gc)}</span>
                        <span><span style={{ color: 'var(--text-muted)' }}>Off-targets </span>{g.offTargets.length}</span>
                      </div>

                      {penalties.length > 0 ? (
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {penalties.map((r, i) => (
                            <li key={i} style={{ color: 'var(--text-secondary)' }}>
                              <span style={{ fontFamily: 'monospace', color: '#dc2626' }}>{r.delta}</span>{' '}
                              <strong style={{ fontWeight: 600 }}>{r.rule}</strong> — {r.detail}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ color: '#16a34a', marginBottom: '0.5rem' }}>
                          Nothing marked against this guide.
                        </div>
                      )}

                      {g.offTargets.length > 0 && (
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
                            Other sites it could cut
                          </div>
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem', maxHeight: 130, overflowY: 'auto' }}>
                            {g.offTargets.slice(0, 10).map((o, i) => (
                              <li key={i} style={{ fontFamily: 'monospace', fontSize: '0.74rem', display: 'flex', gap: '0.6rem' }}>
                                <span style={{ color: 'var(--text-muted)', minWidth: 58, textAlign: 'right' }}>{o.position + 1}</span>
                                <span>{o.protospacer}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{o.mismatches} mm</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
