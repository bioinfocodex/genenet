'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { createEntityType } from '@/app/actions/entities';
import {
  FIELD_TYPES, FIELD_TYPE_LABELS, keyFromLabel, validatePrefix, type FieldType,
} from '@/lib/fields';

/**
 * Declaring a record type.
 *
 * The prefix gets its own explanation because it is the one thing here that
 * cannot be changed later — it ends up printed on tubes, and a code that
 * changes meaning is worse than no code.
 */

interface DraftField {
  label: string;
  type: FieldType;
  required: boolean;
  isUnique: boolean;
  options: string;
  unit: string;
  linkTypeId: string;
}

const blank = (): DraftField => ({
  label: '', type: 'text', required: false, isUnique: false,
  options: '', unit: '', linkTypeId: '',
});

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
  const [fields, setFields] = useState<DraftField[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const prefixProblem = prefix ? validatePrefix(prefix) : null;

  const patch = (i: number, over: Partial<DraftField>) =>
    setFields(f => f.map((x, j) => (j === i ? { ...x, ...over } : x)));

  const submit = () => {
    setError(null);
    const usable = fields.filter(f => f.label.trim());
    if (!name.trim()) { setError('Give the type a name.'); return; }
    if (usable.length === 0) { setError('A type needs at least one field.'); return; }

    start(async () => {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('plural', plural.trim() || `${name.trim()}s`);
      fd.append('prefix', prefix.trim().toUpperCase());
      fd.append('description', description.trim());
      fd.append('color', color);
      fd.append('fields', JSON.stringify(usable.map(f => ({
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        isUnique: f.isUnique,
        options: f.options ? f.options.split(',').map(s => s.trim()).filter(Boolean) : [],
        unit: f.unit.trim() || null,
        linkTypeId: f.type === 'link' ? f.linkTypeId : null,
      }))));

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.8rem' }}>
        {fields.map((f, i) => (
          <div key={i} style={{
            border: '1px solid var(--glass-border)', borderRadius: 8, padding: '0.7rem 0.85rem',
            background: 'var(--bg-primary)',
          }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <GripVertical size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                value={f.label} onChange={e => patch(i, { label: e.target.value })}
                placeholder="Field name" className="input-control"
                style={{ flex: '1 1 150px', fontSize: '0.84rem', padding: '0.35rem 0.55rem' }}
              />
              <select
                value={f.type} onChange={e => patch(i, { type: e.target.value as FieldType })}
                className="input-control" style={{ fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
              >
                {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </select>
              <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={f.required} onChange={e => patch(i, { required: e.target.checked })} />
                Required
              </label>
              {f.type !== 'multiselect' && f.type !== 'boolean' && (
                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={f.isUnique} onChange={e => patch(i, { isUnique: e.target.checked })} />
                  Unique
                </label>
              )}
              <button
                onClick={() => setFields(x => x.filter((_, j) => j !== i))}
                disabled={fields.length === 1}
                style={{
                  background: 'none', border: 'none', cursor: fields.length === 1 ? 'default' : 'pointer',
                  color: fields.length === 1 ? 'var(--text-muted)' : '#b91c1c', padding: 4,
                }}
                title="Remove this field"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {(f.type === 'select' || f.type === 'multiselect') && (
              <input
                value={f.options} onChange={e => patch(i, { options: e.target.value })}
                placeholder="Options, comma separated: DH5α, BL21, Top10"
                className="input-control"
                style={{ width: '100%', marginTop: '0.45rem', fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
              />
            )}
            {(f.type === 'number' || f.type === 'integer') && (
              <input
                value={f.unit} onChange={e => patch(i, { unit: e.target.value })}
                placeholder="Unit, e.g. µg/ml"
                className="input-control"
                style={{ width: 200, marginTop: '0.45rem', fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
              />
            )}
            {f.type === 'link' && (
              existingTypes.length > 0 ? (
                <select
                  value={f.linkTypeId} onChange={e => patch(i, { linkTypeId: e.target.value })}
                  className="input-control"
                  style={{ marginTop: '0.45rem', fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
                >
                  <option value="">Which type does this point at?</option>
                  {existingTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : (
                <p style={{ fontSize: '0.78rem', color: '#a3560a', margin: '0.45rem 0 0' }}>
                  There is no other type to link to yet. Create one first, or use a sequence or
                  sample link instead.
                </p>
              )
            )}
            {f.label && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.4rem 0 0', fontFamily: 'monospace' }}>
                key: {keyFromLabel(f.label)}
              </p>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => setFields(f => [...f, blank()])} className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <Plus size={13} /> Add a field
      </button>

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
