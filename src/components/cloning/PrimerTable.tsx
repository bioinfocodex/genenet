'use client';
import { useState } from 'react';
import type { PrimerPair } from '@/lib/primer-design';

/**
 * The oligos to order.
 *
 * Tail and annealing sequence are shown as separate colours in one string,
 * because they are one oligo but two different things: only the annealing half
 * binds on the first cycles, and only its melting temperature should be used to
 * set the machine. Printing a single sequence with a single Tm is how people
 * end up running PCR far too hot.
 */
export default function PrimerTable({ pairs, accent }: { pairs: PrimerPair[]; accent: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (pairs.length === 0) return null;

  const rows = pairs.flatMap(p => [
    { p: p.forward, pairWarnings: p.warnings },
    { p: p.reverse, pairWarnings: [] as string[] },
  ]);

  const copyAll = () => {
    const text = rows.map(r => `${r.p.name}\t${r.p.sequence}`).join('\n');
    navigator.clipboard?.writeText(text);
    setCopied('all');
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Primers to order</h3>
        <button onClick={copyAll} className="btn btn-secondary" style={{ fontSize: '0.78rem' }}>
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.76rem', minWidth: 520 }}>
          <thead>
            <tr>
              {['Primer', 'Sequence (5′→3′)', 'Anneal', 'Tm'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Tm' || h === 'Anneal' ? 'right' : 'left',
                  padding: '0.3rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600,
                  fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                  borderBottom: '1px solid var(--glass-border)', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p }, i) => (
              <tr key={i}>
                <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap', fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {p.tail && <span style={{ color: accent, fontWeight: 700 }} title="added tail — does not anneal on the first cycles">{p.tail}</span>}
                  <span title="anneals to the template">{p.anneals}</span>
                </td>
                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {p.anneals.length} nt
                </td>
                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {p.tm.toFixed(0)} °C
                  {p.warnings.length > 0 && <span style={{ color: '#a3560a' }} title={p.warnings.join('\n')}> &#9888;</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.some(r => r.p.warnings.length > 0) || pairs.some(p => p.warnings.length > 0) ? (
        <ul style={{ margin: '0.8rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {pairs.flatMap(p => p.warnings).map((w, i) => (
            <li key={`pair-${i}`} style={{ fontSize: '0.78rem', color: '#a3560a', lineHeight: 1.5 }}>{w}</li>
          ))}
          {rows.flatMap(r => r.p.warnings.map(w => `${r.p.name}: ${w}`)).map((w, i) => (
            <li key={`p-${i}`} style={{ fontSize: '0.78rem', color: '#a3560a', lineHeight: 1.5 }}>{w}</li>
          ))}
        </ul>
      ) : null}

      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.8rem 0 0', lineHeight: 1.55 }}>
        The coloured part is the tail this method needs; the rest anneals to the template. Set the
        annealing temperature from the Tm shown, which is the annealing half only &mdash; the tail
        does not bind until the tail itself has been copied.
      </p>
    </div>
  );
}
