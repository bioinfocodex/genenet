'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { saveEntry } from '@/app/actions/notebook';

export default function NewEntry({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('body', '');
      fd.append('entryDate', entryDate);
      fd.append('projectId', projectId);
      const r = await saveEntry(fd);
      if ('error' in r) { setError(r.error); return; }
      router.push(`/notebook/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Plus size={15} /> New entry
      </button>
    );
  }

  const LABEL: React.CSSProperties = {
    display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem',
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={LABEL}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Colony PCR of the Gibson assembly"
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }} />
        </div>
        <div>
          <label style={LABEL}>Date of the work</label>
          <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }} />
        </div>
        <div>
          <label style={LABEL}>Project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}>
            <option value="">—</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' }}>
        The date is the day the work was done, not the day it is being typed.
      </p>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button onClick={submit} disabled={pending || !title.trim()} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>
          {pending ? 'Creating…' : 'Start the entry'}
        </button>
        <button onClick={() => setOpen(false)} className="btn btn-secondary" style={{ fontSize: '0.84rem' }}>Cancel</button>
      </div>
      {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
    </div>
  );
}
