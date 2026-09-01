'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createResultSchema } from '@/app/actions/results';
import FieldEditor, { blankField, toPayload, type DraftField } from '@/components/FieldEditor';

/**
 * Declaring what an assay produces.
 *
 * A numeric field is suggested by default because a result schema with no
 * number in it cannot be summarised, and summarising is the reason to declare
 * one rather than typing into a notes box.
 */
export default function SchemaBuilder({
  entityTypes,
}: {
  entityTypes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<DraftField[]>([
    { ...blankField(), label: '', type: 'number' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const hasNumber = fields.some(f => f.label.trim() && (f.type === 'number' || f.type === 'integer'));

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Give the assay a name.'); return; }
    const payload = toPayload(fields);
    if (payload.length === 0) { setError('An assay needs at least one field to record.'); return; }

    start(async () => {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('description', description.trim());
      fd.append('fields', JSON.stringify(payload));
      const r = await createResultSchema(fd);
      if ('error' in r) { setError(r.error); return; }
      router.push(`/results/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Plus size={15} /> Define an assay
      </button>
    );
  }

  const LABEL: React.CSSProperties = {
    display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem',
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.05rem', margin: '0 0 1rem' }}>A new assay</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem', marginBottom: '1.1rem' }}>
        <div>
          <label style={LABEL}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Plate reader OD600"
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }} />
        </div>
        <div>
          <label style={LABEL}>What it measures (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Overnight growth, read at 600 nm"
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }} />
        </div>
      </div>

      <div style={LABEL}>Readings</div>
      <FieldEditor fields={fields} onChange={setFields} linkTypes={entityTypes} />

      {!hasNumber && (
        <p style={{ fontSize: '0.78rem', color: '#a3560a', margin: '0.7rem 0 0', lineHeight: 1.55 }}>
          No numeric field yet. Without one there is nothing to average or plot, and the assay will
          behave like a notes box with extra steps.
        </p>
      )}

      <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={submit} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>
          {pending ? 'Creating…' : 'Create the assay'}
        </button>
        <button onClick={() => setOpen(false)} className="btn btn-secondary" style={{ fontSize: '0.84rem' }}>
          Cancel
        </button>
      </div>
      {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
    </div>
  );
}
