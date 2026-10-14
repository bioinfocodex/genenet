'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';
import { updateOligo, setOligoArchived } from '@/app/actions/oligos';

interface Editable {
  id: string;
  name: string;
  modifications: string;
  location: string;
  notes: string;
  archived: boolean;
}

export default function OligoEditor({ oligo }: { oligo: Editable }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  const save = (form: HTMLFormElement) => {
    setMessage(null);
    start(async () => {
      const r = await updateOligo(new FormData(form));
      setMessage('error' in r ? { text: r.error, ok: false } : { text: 'Saved.', ok: true });
      router.refresh();
    });
  };

  const toggleArchive = () => {
    start(async () => {
      const fd = new FormData();
      fd.append('id', oligo.id);
      fd.append('archived', String(!oligo.archived));
      const r = await setOligoArchived(fd);
      if ('error' in r) setMessage({ text: r.error, ok: false });
      router.refresh();
    });
  };

  return (
    <form
      className="glass-panel"
      onSubmit={e => { e.preventDefault(); save(e.currentTarget); }}
      style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem 1rem' }}
    >
      <input type="hidden" name="id" value={oligo.id} />
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Details</h2>
        <button type="button" onClick={toggleArchive} disabled={pending} className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          {oligo.archived ? <><ArchiveRestore size={14} /> Restore</> : <><Archive size={14} /> Archive (tube used up)</>}
        </button>
      </div>
      <Field label="Name"><input name="name" defaultValue={oligo.name} required className="input-control" style={input} /></Field>
      <Field label="Location"><input name="location" defaultValue={oligo.location} className="input-control" style={input} /></Field>
      <Field label="Modifications"><input name="modifications" defaultValue={oligo.modifications} className="input-control" style={input} /></Field>
      <Field label="Notes"><input name="notes" defaultValue={oligo.notes} className="input-control" style={input} /></Field>
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button disabled={pending} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>{pending ? 'Saving…' : 'Save'}</button>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          The sequence cannot be changed: the code on the tube names these bases. A new sequence is a new oligo.
        </span>
        {message && <span style={{ fontSize: '0.8rem', color: message.ok ? 'var(--accent-green)' : '#b91c1c' }}>{message.text}</span>}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = { padding: '0.45rem 0.65rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' };
