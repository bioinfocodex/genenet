'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createPlate } from '@/app/actions/plates';
import { FORMAT_LIST } from '@/lib/plates';

export default function NewPlate({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [format, setFormat] = useState(96);
  const [barcode, setBarcode] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('format', String(format));
      fd.append('barcode', barcode.trim());
      fd.append('projectId', projectId);
      const r = await createPlate(fd);
      if ('error' in r) { setError(r.error); return; }
      router.push(`/plates/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Plus size={15} /> New plate
      </button>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.02rem', margin: '0 0 1rem' }}>A new plate</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Screen plate 1"
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Format</label>
          <select value={format} onChange={e => setFormat(Number(e.target.value))}
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}>
            {FORMAT_LIST.map(f => <option key={f.wells} value={f.wells}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Barcode (optional)</label>
          <input value={barcode} onChange={e => setBarcode(e.target.value)}
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem', fontFamily: 'monospace' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}>
            <option value="">—</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: '1.1rem', display: 'flex', gap: '0.5rem' }}>
        <button onClick={submit} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>
          {pending ? 'Creating…' : 'Create plate'}
        </button>
        <button onClick={() => setOpen(false)} className="btn btn-secondary" style={{ fontSize: '0.84rem' }}>Cancel</button>
      </div>
      {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
    </div>
  );
}
