'use client';
import { useTransition } from 'react';
import Link from 'next/link';
import { createRun } from '@/app/actions/bioreactors';

export default function NewRunPage() {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    startTransition(() => { createRun(fd); });
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/bioreactors" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>← Bioreactor Runs</Link>
        <h1 className="title-gradient" style={{ fontSize: '2rem' }}>New Run</h1>
      </div>
      <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <Field label="Run Name *" name="name" required placeholder="e.g. Batch 42 — GFP production" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Vessel Size</label>
            <select name="vesselSize" className="input-control" style={{ padding: '0.65rem' }}>
              {['2L','10L','0.5L','20L','50L','Custom'].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <Field label="Organism" name="organism" placeholder="e.g. E. coli BL21, S. cerevisiae" />
        </div>
        <Field label="Growth Medium" name="medium" placeholder="e.g. LB, TB, YPD" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Notes</label>
          <textarea name="notes" className="input-control" rows={3} placeholder="Initial conditions, goals, notes…" style={{ resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <Link href="/bioreactors" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={isPending}>{isPending ? 'Creating…' : 'Start Run'}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, name, required, placeholder }: { label: string; name: string; required?: boolean; placeholder?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</label>
      <input name={name} required={required} className="input-control" placeholder={placeholder} />
    </div>
  );
}
