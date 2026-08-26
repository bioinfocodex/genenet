'use client';
import { useState, useMemo } from 'react';
import { calcProteinProperties } from '@/lib/simulation';

const AA_COLORS: Record<string, string> = {
  // Hydrophobic
  A:'#f97316', V:'#f97316', I:'#f97316', L:'#f97316', M:'#f97316', F:'#f97316', W:'#f97316', P:'#f97316',
  // Polar uncharged
  S:'#22c55e', T:'#22c55e', C:'#22c55e', Y:'#22c55e', N:'#22c55e', Q:'#22c55e',
  // Positive
  K:'#3b82f6', R:'#3b82f6', H:'#3b82f6',
  // Negative
  D:'#ef4444', E:'#ef4444',
  // Special
  G:'#94a3b8',
};

const AA_NAMES: Record<string, string> = {
  A:'Ala', R:'Arg', N:'Asn', D:'Asp', C:'Cys', E:'Glu', Q:'Gln', G:'Gly',
  H:'His', I:'Ile', L:'Leu', K:'Lys', M:'Met', F:'Phe', P:'Pro', S:'Ser',
  T:'Thr', W:'Trp', Y:'Tyr', V:'Val',
};

type Tab = 'overview' | 'sequence' | 'composition';

interface Props {
  sequence: string;
}

export default function ProteinViewer({ sequence }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const props = useMemo(() => calcProteinProperties(sequence), [sequence]);

  const tabs: [Tab, string][] = [['overview', 'Overview'], ['sequence', 'Sequence'], ['composition', 'Composition']];

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', marginBottom: '1.25rem' }}>
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '0.5rem 1rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--accent-blue)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === t ? 'var(--accent-blue)' : 'transparent'}`, fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab props={props} />}
      {tab === 'sequence' && <SequenceTab sequence={sequence} />}
      {tab === 'composition' && <CompositionTab props={props} />}
    </div>
  );
}

function OverviewTab({ props }: { props: ReturnType<typeof calcProteinProperties> }) {
  const stats = [
    { label: 'Length', value: `${props.length} aa` },
    { label: 'Molecular Weight', value: `${props.mw} kDa` },
    { label: 'Isoelectric Point (pI)', value: props.isoelectric.toFixed(2) },
    { label: 'GRAVY', value: props.gravy.toFixed(3) },
    { label: 'Character', value: props.gravy >= 0 ? 'Hydrophobic' : 'Hydrophilic' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{ padding: '1rem', background: 'white', borderRadius: '8px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>{label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* pI chart hint */}
      <div style={{ padding: '1rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Charge at pH</div>
        <PIBar pI={props.isoelectric} />
      </div>

      {/* AA legend */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Hydrophobic', color: '#f97316' },
          { label: 'Polar', color: '#22c55e' },
          { label: 'Positive (+)', color: '#3b82f6' },
          { label: 'Negative (−)', color: '#ef4444' },
          { label: 'Glycine', color: '#94a3b8' },
        ].map(({ label, color }) => (
          <span key={label} style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '2px', background: color, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PIBar({ pI }: { pI: number }) {
  const pHs = [3, 5, 7, 9, 11];
  return (
    <div>
      <div style={{ position: 'relative', height: 24, background: 'linear-gradient(to right, #3b82f6, #94a3b8, #ef4444)', borderRadius: 4, marginBottom: '0.5rem' }}>
        <div style={{
          position: 'absolute',
          left: `${(pI / 14) * 100}%`,
          top: -4,
          transform: 'translateX(-50%)',
          width: 3,
          height: 32,
          background: '#1e293b',
          borderRadius: 2,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
        {pHs.map(p => <span key={p}>pH {p}</span>)}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
        pI = <strong style={{ color: 'var(--text-primary)' }}>{pI.toFixed(2)}</strong>
        {pI < 7 ? ' — acidic protein (net negative at pH 7)' : pI > 7 ? ' — basic protein (net positive at pH 7)' : ' — neutral'}
      </div>
    </div>
  );
}

function SequenceTab({ sequence }: { sequence: string }) {
  const [hovered, setHovered] = useState<{ aa: string; pos: number } | null>(null);
  const PER_LINE = 60;
  const GROUP = 10;

  const lines = [];
  for (let i = 0; i < sequence.length; i += PER_LINE) {
    lines.push({ start: i, text: sequence.substring(i, i + PER_LINE) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {hovered && (
        <div style={{ padding: '0.4rem 0.8rem', background: 'var(--accent-blue-15)', borderRadius: '6px', fontSize: '0.82rem', display: 'inline-block' }}>
          Position {hovered.pos + 1} · <strong>{hovered.aa}</strong> ({AA_NAMES[hovered.aa] ?? '?'}) · {hovered.aa}
        </div>
      )}
      <div style={{ fontFamily: 'monospace', fontSize: '0.76rem', lineHeight: 2, overflowX: 'auto', background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
        {lines.map(({ start, text }) => (
          <div key={start} style={{ display: 'flex', gap: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 52, textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>{start + 1}</span>
            <div>
              {Array.from({ length: Math.ceil(text.length / GROUP) }, (_, gi) => {
                const gStart = gi * GROUP;
                const group = text.substring(gStart, gStart + GROUP);
                return (
                  <span key={gi} style={{ marginRight: '0.5rem' }}>
                    {group.split('').map((aa, bi) => {
                      const pos = start + gStart + bi;
                      return (
                        <span
                          key={bi}
                          onMouseEnter={() => setHovered({ aa, pos })}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            background: AA_COLORS[aa] ? AA_COLORS[aa] + '30' : 'transparent',
                            borderBottom: `2px solid ${AA_COLORS[aa] ?? '#94a3b8'}`,
                            padding: '0 1px',
                            cursor: 'default',
                            borderRadius: '1px',
                          }}
                        >
                          {aa}
                        </span>
                      );
                    })}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompositionTab({ props }: { props: ReturnType<typeof calcProteinProperties> }) {
  const sorted = Object.entries(props.aaComposition).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 1;

  const groups = [
    { label: 'Hydrophobic', aas: ['A','V','I','L','M','F','W','P'], color: '#f97316' },
    { label: 'Polar', aas: ['S','T','C','Y','N','Q'], color: '#22c55e' },
    { label: 'Positive', aas: ['K','R','H'], color: '#3b82f6' },
    { label: 'Negative', aas: ['D','E'], color: '#ef4444' },
    { label: 'Special', aas: ['G'], color: '#94a3b8' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Group breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {groups.map(g => {
          const count = g.aas.reduce((sum, aa) => sum + (props.aaComposition[aa] ?? 0), 0);
          const pct = props.length > 0 ? ((count / props.length) * 100).toFixed(1) : '0';
          return (
            <div key={g.label} style={{ padding: '0.75rem', background: g.color + '15', border: `1px solid ${g.color}33`, borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: g.color, fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.25rem' }}>{g.label}</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>{pct}%</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{count} residues</div>
            </div>
          );
        })}
      </div>

      {/* Per-AA bar chart */}
      <div>
        <h4 style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Amino Acid Composition</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {sorted.map(([aa, count]) => {
            const pct = ((count / props.length) * 100).toFixed(1);
            const barW = (count / max) * 100;
            return (
              <div key={aa} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem', width: 20, textAlign: 'center', color: AA_COLORS[aa] ?? '#94a3b8' }}>{aa}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: 48 }}>{AA_NAMES[aa] ?? ''}</span>
                <div style={{ flex: 1, height: 14, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                  <div style={{ width: `${barW}%`, height: '100%', background: AA_COLORS[aa] ?? '#94a3b8', borderRadius: 2, opacity: 0.85 }} />
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: 40, textAlign: 'right' }}>{pct}%</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace', width: 32 }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
