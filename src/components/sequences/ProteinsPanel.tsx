'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { translateFeatureToProtein } from '@/app/actions/proteins';

/**
 * The proteins a sequence encodes, and the way to make them.
 *
 * A protein record could point at the gene it came from, and nothing pointed
 * back: from a plasmid there was no way to see what had been translated out of
 * it, and no way to translate a CDS except by copying bases into the protein
 * form by hand. Both directions matter -- the question "is this construct's
 * product already in the library" is asked from the construct.
 */

export interface LinkedProtein {
  id: string;
  name: string;
  length: number;
  mw: number | null;
}

export interface TranslatableFeature {
  id: string;
  name: string;
  start: number;
  end: number;
  strand: 1 | -1;
  /** Bases the CDS covers, exons only. */
  codingLength: number;
  /** True when that length is a whole number of codons. */
  inFrame: boolean;
}

export default function ProteinsPanel({ sequenceId, proteins, features }: {
  sequenceId: string;
  proteins: LinkedProtein[];
  features: TranslatableFeature[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const translate = (featureId: string) => {
    setError(null);
    setBusy(featureId);
    start(async () => {
      const fd = new FormData();
      fd.append('sequenceId', sequenceId);
      fd.append('featureId', featureId);
      const r = await translateFeatureToProtein(fd);
      setBusy(null);
      if ('error' in r) { setError(r.error); return; }
      router.refresh();
    });
  };

  const translated = new Set(proteins.map(p => p.name));

  if (proteins.length === 0 && features.length === 0) return null;

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <FlaskConical size={16} /> Proteins
      </h2>

      {proteins.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {proteins.map(p => (
            <li key={p.id} style={{ fontSize: '0.84rem', display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
              <Link href={`/proteins/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.76rem' }}>
                {p.length} aa{p.mw ? ` · ${p.mw} kDa` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {features.length > 0 && (
        <>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            Coding features
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <tbody>
              {features.map(f => (
                <tr key={f.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <td style={cell}>
                    {f.name}
                    {f.strand === -1 && <span style={{ color: 'var(--text-muted)' }}> (minus strand)</span>}
                  </td>
                  <td style={{ ...cell, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {f.start.toLocaleString()}–{f.end.toLocaleString()} · {f.codingLength.toLocaleString()} bp
                  </td>
                  <td style={cell}>
                    {!f.inFrame && (
                      <span style={{ color: '#a3560a' }} title="Not a whole number of codons: the annotation may be off by a base or two">
                        not a whole number of codons
                      </span>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}
                      disabled={pending && busy === f.id}
                      onClick={() => translate(f.id)}
                    >
                      {busy === f.id ? 'Translating…' : translated.has(f.name) ? 'Translate again' : 'Translate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
            Each is read in its own frame and strand, with introns left out, so the protein is the one the gene encodes.
          </p>
        </>
      )}

      {error && <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: '0.4rem' }}>{error}</div>}
    </div>
  );
}

const cell: React.CSSProperties = { padding: '0.35rem 0.5rem', verticalAlign: 'middle' };
