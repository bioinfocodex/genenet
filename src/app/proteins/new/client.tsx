'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createProtein, translateGeneToProtein } from '@/app/actions/proteins';
import { translateDNA, calcProteinProperties } from '@/lib/simulation';

type Mode = 'aa' | 'dna' | 'translate';
interface Gene { id: string; name: string; size: number; }

export default function NewProteinClient({ genes }: { genes: Gene[] }) {
  const [mode, setMode] = useState<Mode>('aa');
  const [input, setInput] = useState('');
  const [geneId, setGeneId] = useState(genes[0]?.id ?? '');
  const [isPending, startTransition] = useTransition();

  const preview = input.trim()
    ? mode === 'aa'
      ? calcProteinProperties(input.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, ''))
      : mode === 'dna'
      ? (() => { const p = translateDNA(input.toUpperCase().replace(/[^ACGT]/g, '')); return calcProteinProperties(p); })()
      : null
    : null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    startTransition(() => {
      if (mode === 'translate') {
        const fd = new FormData();
        fd.append('geneSequenceId', geneId);
        translateGeneToProtein(fd);
      } else {
        const fd = new FormData(form);
        fd.append('fromDna', mode === 'dna' ? 'true' : 'false');
        createProtein(fd);
      }
    });
  };

  const tabs: [Mode, string][] = [['aa', 'Amino Acid Sequence'], ['dna', 'From DNA (translate)'], ['translate', 'From Gene Library']];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/proteins" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>← Protein Library</Link>
        <h1 className="title-gradient" style={{ fontSize: '2rem' }}>Add Protein</h1>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        {tabs.map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} style={{ padding: '0.5rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: mode === m ? 600 : 400, color: mode === m ? 'var(--accent-blue)' : 'var(--text-muted)', borderBottom: `2px solid ${mode === m ? 'var(--accent-blue)' : 'transparent'}`, fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {mode !== 'translate' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Name *</label>
              <input name="name" required className="input-control" placeholder="e.g. GFP, TEV protease" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Description</label>
              <input name="description" className="input-control" placeholder="Optional description" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {mode === 'aa' ? 'Amino Acid Sequence *' : 'DNA Sequence (will be translated) *'}
                </label>
                {preview && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)', fontWeight: 600 }}>
                    {preview.formulaString}
                  </span>
                )}
              </div>
              <textarea
                name="sequence"
                required
                value={input}
                onChange={e => setInput(e.target.value)}
                className="input-control"
                rows={8}
                placeholder={mode === 'aa' ? 'MVSKGEELFTG… (single-letter codes)' : 'ATGGTGAGCAAGGGCGAGGAG…'}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.6 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Tags</label>
              <input name="tags" className="input-control" placeholder="e.g. fluorescent, recombinant (comma-separated)" />
            </div>
          </>
        )}

        {mode === 'translate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {genes.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No gene sequences in library. <Link href="/sequences/new" style={{ color: 'var(--accent-blue)' }}>Add a gene first.</Link>
              </div>
            ) : (
              <>
                <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Select Gene to Translate</label>
                <select value={geneId} onChange={e => setGeneId(e.target.value)} className="input-control" style={{ padding: '0.75rem' }}>
                  {genes.map(g => <option key={g.id} value={g.id}>{g.name} ({g.size.toLocaleString()} bp)</option>)}
                </select>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  The system will translate from the first ATG in reading frame 0.
                </p>
              </>
            )}
          </div>
        )}

        {preview && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', padding: '1rem', background: 'var(--accent-blue-15)', borderRadius: '8px', border: '1px solid rgba(37,99,235,0.2)' }}>
            {[['Length', `${preview.length} aa`], ['MW', `${preview.mw} kDa`], ['pI', preview.isoelectric.toFixed(2)], ['GRAVY', preview.gravy.toFixed(3)]].map(([l, v]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l}</div>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <Link href="/proteins" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={isPending || (mode === 'translate' && !geneId)}>
            {isPending ? 'Saving…' : '+ Add Protein'}
          </button>
        </div>
      </form>
    </div>
  );
}
