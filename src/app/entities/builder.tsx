'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createEntityType } from '@/app/actions/entities';
import { validatePrefix } from '@/lib/fields';
import FieldEditor, { blankField, toPayload, type DraftField } from '@/components/FieldEditor';

/**
 * Declaring a record type.
 *
 * The prefix gets its own explanation because it is the one thing here that
 * cannot be changed later — it ends up printed on tubes, and a code that
 * changes meaning is worse than no code.
 */

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem',
};

export default function EntityTypeBuilder({
  existingTypes,
}: {
  existingTypes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [plural, setPlural] = useState('');
  const [prefix, setPrefix] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [fields, setFields] = useState<DraftField[]>([blankField()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const prefixProblem = prefix ? validatePrefix(prefix) : null;

  const submit = () => {
    setError(null);
    const payload = toPayload(fields);
    if (!name.trim()) { setError('Give the type a name.'); return; }
    if (payload.length === 0) { setError('A type needs at least one field.'); return; }

    start(async () => {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('plural', plural.trim() || `${name.trim()}s`);
      fd.append('prefix', prefix.trim().toUpperCase());
      fd.append('description', description.trim());
      fd.append('color', color);
      fd.append('fields', JSON.stringify(payload));

      const r = await createEntityType(fd);
      if ('error' in r) { setError(r.error); return; }
      router.push(`/entities/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Plus size={15} /> Define a type
      </button>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.05rem', margin: '0 0 1rem' }}>A new record type</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
        <div>
          <label style={LABEL_STYLE}>Name (singular)</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); if (!prefix) setPrefix(e.target.value.slice(0, 3).toUpperCase()); }}
            placeholder="Strain"
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Plural</label>
          <input
            value={plural} onChange={e => setPlural(e.target.value)}
            placeholder={name ? `${name}s` : 'Strains'}
            className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Code prefix</label>
          <input
            value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())}
            placeholder="STR" maxLength={6}
            className="input-control"
            style={{
              width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem', fontFamily: 'monospace',
              borderColor: prefixProblem ? '#b91c1c' : undefined,
            }}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Colour</label>
          <input
            type="color" value={color} onChange={e => setColor(e.target.value)}
            style={{ width: '100%', height: 34, padding: 2, border: '1px solid var(--glass-border)', borderRadius: 6, background: 'transparent' }}
          />
        </div>
      </div>

      <p style={{ fontSize: '0.76rem', color: prefixProblem ? '#b91c1c' : 'var(--text-muted)', margin: '0 0 1rem', lineHeight: 1.55 }}>
        {prefixProblem ?? `Records will be numbered ${prefix || 'STR'}-001, ${prefix || 'STR'}-002. The prefix cannot be changed afterwards — it ends up printed on tubes.`}
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <label style={LABEL_STYLE}>What is it (optional)</label>
        <input
          value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Bacterial strains held in the lab collection"
          className="input-control" style={{ width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
        />
      </div>

      <div style={LABEL_STYLE}>Fields</div>
      <FieldEditor fields={fields} onChange={setFields} linkTypes={existingTypes} />

      <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={submit} disabled={pending || !!prefixProblem} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>
          {pending ? 'Creating…' : 'Create the type'}
        </button>
        <button onClick={() => setOpen(false)} className="btn btn-secondary" style={{ fontSize: '0.84rem' }}>
          Cancel
        </button>
      </div>
      {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
    </div>
  );
}
