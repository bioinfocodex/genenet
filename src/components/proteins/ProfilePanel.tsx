'use client';
import { useMemo, useState } from 'react';
import {
  hydropathyProfile, hydrophobicSegments, chargeCurve, isoelectricPoint,
  absorbance, chargeAtPh,
} from '@/lib/protein-analysis';

/**
 * The protein along its own length, and in the buffer it will be in.
 *
 * A protein record carried three numbers for the whole chain. Two of the three
 * questions a purification actually asks are not answerable from those: where
 * the hydrophobic stretches are, and what charge the protein carries at the pH
 * of the column buffer. The third -- how much light it absorbs -- was not
 * there at all, and without it a concentration cannot be read off a
 * spectrophotometer.
 */

const WINDOWS: { value: number; label: string }[] = [
  { value: 9, label: '9 — surface character' },
  { value: 19, label: '19 — membrane-spanning' },
];

export default function ProfilePanel({ sequence }: { sequence: string }) {
  const [window, setWindow] = useState(9);
  const [ph, setPh] = useState(7.4);

  const profile = useMemo(() => hydropathyProfile(sequence, window), [sequence, window]);
  const segments = useMemo(() => hydrophobicSegments(sequence), [sequence]);
  const curve = useMemo(() => chargeCurve(sequence), [sequence]);
  const pi = useMemo(() => isoelectricPoint(sequence), [sequence]);
  const abs = useMemo(() => absorbance(sequence), [sequence]);
  const charge = chargeAtPh(sequence, ph);

  if (profile.length === 0) {
    return <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No amino acid sequence to analyse.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={heading}>Hydropathy (Kyte–Doolittle)</h3>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            window
            <select value={window} onChange={e => setWindow(Number(e.target.value))} className="input-control" style={{ padding: '0.2rem 0.4rem', fontSize: '0.78rem' }}>
              {WINDOWS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </label>
        </div>
        <HydropathyChart profile={profile} length={sequence.length} />
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.4rem 0 0' }}>
          {segments.length === 0
            ? 'No stretch is hydrophobic enough, for long enough, to cross a membrane: nothing reaches 1.6 averaged over 19 residues.'
            : `${segments.length} stretch${segments.length === 1 ? '' : 'es'} above 1.6 over 19 residues — ${segments.map(s => `${s.start}–${s.end}`).join(', ')}. Hydrophobic enough to cross a membrane; equally, a buried core or a signal peptide.`}
        </p>
      </section>

      <section>
        <h3 style={heading}>Charge, and the buffer it is in</h3>
        <ChargeChart curve={curve} pi={pi} ph={ph} />
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            pH
            <input type="range" min={2} max={12} step={0.1} value={ph} onChange={e => setPh(Number(e.target.value))} style={{ width: 180 }} />
            <span style={{ fontFamily: 'monospace', minWidth: 34 }}>{ph.toFixed(1)}</span>
          </label>
          <span style={{ fontSize: '0.85rem' }}>
            net charge <strong style={{ color: charge > 0 ? '#2563eb' : charge < 0 ? '#dc2626' : 'var(--text-muted)', fontFamily: 'monospace' }}>{charge > 0 ? '+' : ''}{charge.toFixed(2)}</strong>
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            pI {pi.toFixed(2)} — binds {pi > ph ? 'a cation exchanger' : 'an anion exchanger'} at this pH
            {Math.abs(ph - pi) < 0.5 && ', though this close to the pI it is at its least soluble'}
          </span>
        </div>
      </section>

      <section>
        <h3 style={heading}>Absorbance at 280 nm</h3>
        {abs.blind ? (
          <p style={{ fontSize: '0.82rem', color: '#a3560a', margin: 0 }}>
            No tryptophan, tyrosine or cystine: this protein does not absorb at 280 nm, and its concentration cannot be
            read there. Use a dye-binding assay instead.
          </p>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <tbody>
              <Row label="ε, cystines intact" value={`${abs.extinctionOxidised.toLocaleString()} M⁻¹cm⁻¹`} />
              <Row label="ε, fully reduced" value={`${abs.extinctionReduced.toLocaleString()} M⁻¹cm⁻¹`} />
              <Row label="A280 of 1 mg/mL" value={`${abs.a280Oxidised.toFixed(3)} (reduced: ${abs.a280Reduced.toFixed(3)})`} />
              <Row label="1 A280 unit is" value={`${(1 / (abs.a280Oxidised || 1)).toFixed(2)} mg/mL`} />
            </tbody>
          </table>
        )}
        {!abs.blind && abs.extinctionOxidised !== abs.extinctionReduced && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.4rem 0 0' }}>
            In reducing buffer the cystines are broken and contribute nothing, so use the reduced figure there; the
            oxidised one would read the sample as more concentrated than it is.
          </p>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '0.2rem 0.9rem 0.2rem 0', color: 'var(--text-muted)' }}>{label}</td>
      <td style={{ padding: '0.2rem 0', fontFamily: 'monospace' }}>{value}</td>
    </tr>
  );
}

const W = 760;
const H = 150;

function HydropathyChart({ profile, length }: { profile: { position: number; value: number }[]; length: number }) {
  // A fixed scale, because the shape is only readable against the thresholds
  // it is being judged by. Kyte-Doolittle runs from -4.5 to 4.5.
  const max = 4.5;
  const x = (p: number) => (p / Math.max(1, length)) * W;
  const y = (v: number) => H / 2 - (v / max) * (H / 2 - 6);
  const d = profile.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.position).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      <rect x={0} y={y(4.5)} width={W} height={y(1.6) - y(4.5)} fill="rgba(234,88,12,0.07)" />
      <line x1={0} y1={y(1.6)} x2={W} y2={y(1.6)} stroke="#ea580c" strokeWidth={1} strokeDasharray="4,3" />
      <text x={4} y={y(1.6) - 4} fontSize={9} fill="#ea580c">1.6 — membrane-spanning threshold</text>
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
      <text x={4} y={y(0) - 3} fontSize={9} fill="#94a3b8">0</text>
      <path d={d} fill="none" stroke="#2563eb" strokeWidth={1.4} />
      <text x={W - 4} y={H - 3} fontSize={9} fill="#94a3b8" textAnchor="end">{length} aa</text>
    </svg>
  );
}

function ChargeChart({ curve, pi, ph }: { curve: { ph: number; charge: number }[]; pi: number; ph: number }) {
  const max = Math.max(1, ...curve.map(p => Math.abs(p.charge)));
  const x = (p: number) => ((p - 2) / 10) * W;
  const y = (c: number) => H / 2 - (c / max) * (H / 2 - 8);
  const d = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ph).toFixed(1)},${y(p.charge).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
      <line x1={x(pi)} y1={0} x2={x(pi)} y2={H} stroke="#16a34a" strokeWidth={1} strokeDasharray="4,3" />
      <text x={x(pi) + 4} y={12} fontSize={10} fill="#16a34a">pI {pi.toFixed(2)}</text>
      <line x1={x(ph)} y1={0} x2={x(ph)} y2={H} stroke="#2563eb" strokeWidth={1.5} />
      <path d={d} fill="none" stroke="#7c3aed" strokeWidth={1.6} />
      {[2, 4, 6, 8, 10, 12].map(p => (
        <text key={p} x={x(p)} y={H - 2} fontSize={9} fill="#94a3b8" textAnchor="middle">pH {p}</text>
      ))}
      <text x={4} y={14} fontSize={9} fill="#94a3b8">+{max.toFixed(0)}</text>
      <text x={4} y={H - 14} fontSize={9} fill="#94a3b8">−{max.toFixed(0)}</text>
    </svg>
  );
}

const heading: React.CSSProperties = {
  fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '0 0 0.5rem',
};
