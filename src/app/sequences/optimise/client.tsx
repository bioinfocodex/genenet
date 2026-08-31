'use client';
import { useState } from 'react';
import { Wand2, Scissors, AlertTriangle, Check, Copy } from 'lucide-react';
import { HOST_LIST, host, type CodonUsage } from '@/lib/codon-usage';
import { optimise, type OptimiseResult, type Metrics } from '@/lib/codon-optimise';
import { findSilentSites, type SiteCandidate } from '@/lib/silent-mutagenesis';

/**
 * Two jobs that share a guarantee.
 *
 * Both tabs only ever make synonymous changes, so the protein is invariant, and
 * both say so in the same place and the same words. That invariant is the whole
 * reason either is safe to use, and it should not be something the reader has
 * to infer from the absence of a warning.
 */

const COMMON_ENZYMES = [
  'EcoRI', 'BamHI', 'HindIII', 'XhoI', 'XbaI', 'SalI', 'NotI', 'NcoI',
  'NdeI', 'KpnI', 'SacI', 'SpeI', 'PstI', 'BglII', 'EcoRV', 'AgeI',
];

function Delta({ label, before, after, format, betterWhen }: {
  label: string;
  before: number;
  after: number;
  format: (n: number) => string;
  betterWhen: 'higher' | 'lower';
}) {
  const changed = Math.abs(after - before) > 1e-9;
  const better = betterWhen === 'higher' ? after > before : after < before;
  const colour = !changed ? 'var(--text-muted)' : better ? 'var(--accent-green)' : '#a3560a';
  return (
    <div style={{ minWidth: 118 }}>
      <div style={{
        fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.2rem',
      }}>
        {label}
      </div>
      <div style={{ fontSize: '0.92rem', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: 'var(--text-muted)' }}>{format(before)}</span>
        <span style={{ color: 'var(--text-muted)' }}> → </span>
        <strong style={{ color: colour }}>{format(after)}</strong>
      </div>
    </div>
  );
}

function MetricRow({ before, after }: { before: Metrics; after: Metrics }) {
  return (
    <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap', margin: '0 0 1.1rem' }}>
      <Delta label="CAI" before={before.cai} after={after.cai} format={n => n.toFixed(3)} betterWhen="higher" />
      <Delta label="GC" before={before.gc} after={after.gc} format={n => `${(n * 100).toFixed(1)}%`} betterWhen="lower" />
      <Delta label="Rare codons" before={before.rareCount} after={after.rareCount} format={n => String(n)} betterWhen="lower" />
      <Delta label="In clusters" before={before.rareClusters} after={after.rareClusters} format={n => String(n)} betterWhen="lower" />
      <Delta label="Longest repeat" before={before.longestRepeat} after={after.longestRepeat} format={n => (n ? `${n} bp` : 'none')} betterWhen="lower" />
      <Delta label="5′ structure" before={before.startStructureDG} after={after.startStructureDG} format={n => `${n.toFixed(1)}`} betterWhen="higher" />
    </div>
  );
}

function SequenceBox({ seq, label }: { seq: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>{label}</span>
        <button
          onClick={() => { navigator.clipboard?.writeText(seq); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="btn btn-secondary"
          style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea
        readOnly value={seq} onFocus={e => e.currentTarget.select()}
        style={{
          width: '100%', height: 110, fontFamily: 'monospace', fontSize: '0.7rem',
          padding: '0.6rem', border: '1px solid var(--glass-border)', borderRadius: 6,
          background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
        }}
      />
    </div>
  );
}

function Unresolved({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{
      margin: '0 0 1rem', padding: '0.85rem 1.1rem', borderRadius: 8,
      border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.05)',
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: '#a3560a', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
      }}>
        <AlertTriangle size={13} /> Could not be fixed without changing the protein
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {items.map((u, i) => (
          <li key={i} style={{ fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{u}</li>
        ))}
      </ul>
    </div>
  );
}

const PROTEIN_SAFE = 'Protein unchanged — verified against the original, not assumed.';

export default function OptimiseClient({ sequences }: { sequences: { id: string; name: string; sequence: string }[] }) {
  const [tab, setTab] = useState<'optimise' | 'sites'>('optimise');
  const [cds, setCds] = useState('');
  const [hostId, setHostId] = useState('ecoli');
  const [avoid, setAvoid] = useState<string[]>([]);
  const [seed, setSeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimiseResult | null>(null);
  const [sites, setSites] = useState<SiteCandidate[] | null>(null);
  const [uniqueOnly, setUniqueOnly] = useState(true);

  const usage: CodonUsage = host(hostId);
  const clean = cds.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T');

  const load = (id: string) => {
    const s = sequences.find(x => x.id === id);
    if (s) { setCds(s.sequence); setResult(null); setSites(null); setError(null); }
  };

  const run = () => {
    setError(null); setResult(null); setSites(null);
    try {
      if (tab === 'optimise') setResult(optimise(clean, { usage, avoidSites: avoid, seed }));
      else setSites(findSilentSites(clean, avoid.length ? avoid : COMMON_ENZYMES, usage, { uniqueOnly }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process that sequence.');
    }
  };

  const toggleEnzyme = (name: string) =>
    setAvoid(a => (a.includes(name) ? a.filter(x => x !== name) : [...a, name]));

  return (
    <>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        {([['optimise', 'Optimise for a host', Wand2], ['sites', 'Add a diagnostic site', Scissors]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => { setTab(id); setResult(null); setSites(null); setError(null); }}
            className={tab === id ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <label style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            Coding sequence
          </label>
          <select
            onChange={e => load(e.target.value)} defaultValue=""
            className="input-control" style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', maxWidth: 240 }}
          >
            <option value="">Load from library…</option>
            {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <textarea
          value={cds}
          onChange={e => { setCds(e.target.value); setResult(null); setSites(null); }}
          placeholder="ATG…  — the coding sequence only, starting in frame"
          style={{
            width: '100%', height: 130, fontFamily: 'monospace', fontSize: '0.75rem',
            padding: '0.7rem', border: '1px solid var(--glass-border)', borderRadius: 8,
            background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.45rem 0 0.9rem' }}>
          {clean.length.toLocaleString()} bp
          {clean.length % 3 !== 0 && clean.length > 0 && (
            <span style={{ color: '#a3560a' }}> · not a whole number of codons</span>
          )}
          {clean.length >= 3 && clean.length % 3 === 0 && ` · ${(clean.length / 3).toLocaleString()} codons`}
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
          <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            Host
            <select value={hostId} onChange={e => setHostId(e.target.value)} className="input-control" style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}>
              {HOST_LIST.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          {tab === 'optimise' && (
            <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              Variant
              <input
                type="number" min={1} max={999} value={seed}
                onChange={e => setSeed(Math.max(1, Number(e.target.value) || 1))}
                className="input-control" style={{ width: 66, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>same number, same gene</span>
            </label>
          )}
          {tab === 'sites' && (
            <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={uniqueOnly} onChange={e => setUniqueOnly(e.target.checked)} />
              Only sites that cut once
            </label>
          )}
        </div>

        <div style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem',
        }}>
          {tab === 'optimise' ? 'Sites to avoid' : 'Sites to place (all common ones if none picked)'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '1rem' }}>
          {COMMON_ENZYMES.map(name => (
            <button
              key={name}
              onClick={() => toggleEnzyme(name)}
              style={{
                fontSize: '0.74rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: 5,
                cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${avoid.includes(name) ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                background: avoid.includes(name) ? 'rgba(59,130,246,0.1)' : 'transparent',
                color: avoid.includes(name) ? 'var(--accent-blue)' : 'var(--text-secondary)',
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <button onClick={run} disabled={clean.length < 3} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>
          {tab === 'optimise' ? 'Optimise' : 'Find silent sites'}
        </button>
        {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
      </div>

      {result && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.9rem' }}>
            <Check size={16} color="var(--accent-green)" />
            <strong style={{ fontSize: '0.9rem' }}>{PROTEIN_SAFE}</strong>
          </div>

          <MetricRow before={result.before} after={result.after} />
          <Unresolved items={result.unresolved} />

          {result.notes.length > 0 && (
            <ul style={{ margin: '0 0 1rem', paddingLeft: '1.1rem' }}>
              {result.notes.map((n, i) => (
                <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{n}</li>
              ))}
            </ul>
          )}

          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '0 0 0.3rem', lineHeight: 1.6 }}>
            {result.changes.length.toLocaleString()} of {(result.protein.length).toLocaleString()} codons changed.
          </p>
          <SequenceBox seq={result.sequence} label="Optimised sequence" />
          <SequenceBox seq={result.protein} label="Protein (unchanged)" />
        </div>
      )}

      {sites && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.9rem' }}>
            <Check size={16} color="var(--accent-green)" />
            <strong style={{ fontSize: '0.9rem' }}>{PROTEIN_SAFE}</strong>
          </div>

          {sites.length === 0 ? (
            <p style={{ fontSize: '0.88rem', margin: 0, lineHeight: 1.6 }}>
              No site from that set can be spelled here by synonymous codons. Widening the enzyme
              selection, or allowing sites that cut more than once, usually turns something up.
            </p>
          ) : (
            <>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '0 0 0.85rem', lineHeight: 1.6 }}>
                {sites.length} place{sites.length === 1 ? '' : 's'} a site fits. Cheapest change first
                &mdash; a one-base change is one mutagenesis primer.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem', minWidth: 560 }}>
                  <thead>
                    <tr>
                      {['Enzyme', 'At', 'Codon changes', 'Bases', 'Rarest codon', ''].map(h => (
                        <th key={h} style={{
                          textAlign: ['Bases'].includes(h) ? 'right' : 'left',
                          padding: '0.3rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600,
                          fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                          borderBottom: '1px solid var(--glass-border)', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sites.slice(0, 40).map((c, i) => (
                      <tr key={i}>
                        <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{c.enzyme}</td>
                        <td style={{ padding: '0.4rem 0.6rem', fontVariantNumeric: 'tabular-nums' }}>{(c.position + 1).toLocaleString()}</td>
                        <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', fontSize: '0.74rem' }}>
                          {c.changes.map(ch => `${ch.from}→${ch.to}`).join(', ')}
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                            {' '}({c.changes.map(ch => `${ch.aa}${ch.codonPosition}`).join(', ')})
                          </span>
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.basesChanged}</td>
                        <td style={{
                          padding: '0.4rem 0.6rem', fontVariantNumeric: 'tabular-nums',
                          color: c.worstCodonFrequency < 0.1 ? '#a3560a' : 'var(--text-secondary)',
                        }}>
                          {(c.worstCodonFrequency * 100).toFixed(0)}%
                          {c.worstCodonFrequency < 0.1 && <span title="rare in this host"> &#9888;</span>}
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {c.unique ? 'cuts once' : 'cuts elsewhere too'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SequenceBox seq={sites[0].sequence} label={`Sequence with the ${sites[0].enzyme} site at ${sites[0].position + 1}`} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.85rem 0 0', lineHeight: 1.55 }}>
                The percentage is how often the host uses the rarest codon the change introduces. A
                site bought with a codon the host barely uses is a diagnostic digest paid for in
                expression.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
