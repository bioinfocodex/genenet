'use client';
import { useState } from 'react';
import type { PrimerPair } from '@/lib/primer-design';
import { checkOligo, dimer } from '@/lib/secondary-structure';

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

  // Structure is checked on the whole oligo, tail included. The tail does not
  // anneal to the template on the first cycles, but it is physically present
  // and folds like any other DNA — a hairpin that ties up the 3' end does not
  // care that the bases holding it there were added for cloning.
  const structure = rows.map(r => checkOligo(r.p.sequence));

  // Cross-dimers between the two primers of a pair: the classic primer-dimer,
  // which no amount of checking each oligo alone will find.
  const crossWarnings = pairs.flatMap(pair => {
    const d = dimer(pair.forward.sequence, pair.reverse.sequence);
    if (!d || d.dG > -6) return [];
    return [{
      names: `${pair.forward.name} + ${pair.reverse.name}`,
      dG: d.dG,
      text: d.involves3Prime
        ? `${pair.forward.name} and ${pair.reverse.name} pair at ${d.dG.toFixed(1)} kcal/mol with a 3' end in the helix. This is the primer-dimer that takes over a reaction: it extends, and the short product then amplifies faster than the template.`
        : `${pair.forward.name} and ${pair.reverse.name} pair at ${d.dG.toFixed(1)} kcal/mol over ${d.length} bp, away from the 3' ends. It will not extend, but it competes for the oligos.`,
      diagram: d.diagram,
    }];
  });

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
              {['Primer', 'Sequence (5′→3′)', 'Anneal', 'Tm', 'Structure'].map(h => (
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
                <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                  {structure[i].warnings.length === 0 ? (
                    <span style={{ color: 'var(--text-muted)' }}>clear</span>
                  ) : (
                    <span
                      style={{ color: structure[i].warnings.some(w => w.includes("3'")) ? '#b91c1c' : '#a3560a', fontWeight: 600 }}
                      title={structure[i].warnings.join('\n\n')}
                    >
                      {structure[i].hairpin && structure[i].hairpin!.dG <= -3 ? 'hairpin' : 'dimer'}
                      {' '}
                      {Math.min(
                        structure[i].hairpin?.dG ?? 0,
                        structure[i].selfDimer?.dG ?? 0,
                      ).toFixed(1)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(rows.some(r => r.p.warnings.length > 0) || pairs.some(p => p.warnings.length > 0)
        || structure.some(s => s.warnings.length > 0) || crossWarnings.length > 0) ? (
        <ul style={{ margin: '0.8rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {/* A cross-dimer is the one that ruins a reaction outright, so it leads. */}
          {crossWarnings.map((w, i) => (
            <li key={`x-${i}`} style={{ fontSize: '0.78rem', color: '#b91c1c', lineHeight: 1.5 }}>
              {w.text}
              <pre style={{
                margin: '0.35rem 0 0', fontFamily: 'monospace', fontSize: '0.68rem',
                color: 'var(--text-secondary)', overflowX: 'auto', lineHeight: 1.35,
              }}>{w.diagram.join('\n')}</pre>
            </li>
          ))}
          {pairs.flatMap(p => p.warnings).map((w, i) => (
            <li key={`pair-${i}`} style={{ fontSize: '0.78rem', color: '#a3560a', lineHeight: 1.5 }}>{w}</li>
          ))}
          {rows.flatMap((r, i) => structure[i].warnings.map(w => `${r.p.name}: ${w}`)).map((w, i) => (
            <li key={`s-${i}`} style={{ fontSize: '0.78rem', color: '#a3560a', lineHeight: 1.5 }}>{w}</li>
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
