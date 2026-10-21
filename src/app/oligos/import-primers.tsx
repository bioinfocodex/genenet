'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Import } from 'lucide-react';
import { previewPrimerImport, importPrimersFromSequences } from '@/app/actions/oligos';
import type { PrimerImportPlan } from '@/lib/oligos';

/**
 * File the primers already saved on individual sequences into the collection.
 * Shows what it would do first; nothing is written until confirmed.
 */
export default function ImportPrimers() {
  const router = useRouter();
  const [plan, setPlan] = useState<PrimerImportPlan | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const preview = () => start(async () => {
    setDone(null);
    setError(null);
    setPlan(await previewPrimerImport());
  });

  const confirm = () => start(async () => {
    const r = await importPrimersFromSequences();
    if ('error' in r) { setError(r.error); return; }
    setDone(r.added.length ? `Filed ${r.added.length}: ${r.added.map(a => a.code).join(', ')}` : 'Nothing new to file.');
    setPlan(null);
    router.refresh();
  });

  if (!plan) {
    return (
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button onClick={preview} disabled={pending} className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Import size={14} /> {pending ? 'Checking…' : 'Import primers saved on sequences'}
        </button>
        {done && <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)' }}>{done}</span>}
        {error && <span style={{ fontSize: '0.8rem', color: '#b91c1c' }}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', fontSize: '0.82rem' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>Import primers saved on sequences</div>
      <p style={{ margin: '0 0 0.5rem', color: 'var(--text-secondary)' }}>
        {plan.add.length === 0
          ? 'Every primer saved on a sequence is already in the collection.'
          : `${plan.add.length} new oligo${plan.add.length === 1 ? '' : 's'} would be added. The same primer saved on several sequences becomes one oligo that lists where it was used.`}
      </p>
      {plan.add.length > 0 && (
        <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.1rem', maxHeight: 180, overflowY: 'auto' }}>
          {plan.add.map(a => (
            <li key={a.sequence}>
              <strong>{a.name}</strong> <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{a.sequence}</span>
              <span style={{ color: 'var(--text-muted)' }}> · {a.notes.split('\n').at(-1)}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.existing.length > 0 && (
        <div style={{ color: 'var(--text-muted)' }}>Already filed: {plan.existing.map(e => `${e.name} (${e.code})`).join(', ')}</div>
      )}
      {plan.invalid.length > 0 && (
        <div style={{ color: '#a3560a' }}>Not filed: {plan.invalid.map(i => `${i.name}: ${i.reason}`).join('; ')}</div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button onClick={() => setPlan(null)} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>Cancel</button>
        {plan.add.length > 0 && (
          <button onClick={confirm} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
            {pending ? 'Filing…' : `File ${plan.add.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
