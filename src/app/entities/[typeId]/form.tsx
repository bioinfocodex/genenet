'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { saveEntity } from '@/app/actions/entities';
import type { FieldDefinition } from '@/lib/fields';

/**
 * Filling in a lab-defined record.
 *
 * The form is generated from the type's fields, so a field added last week
 * appears here without anyone touching this file. That is the point of the
 * whole exercise; the alternative is a hand-written form per type, which is
 * what having fixed models meant in the first place.
 */

export interface Options {
  projects: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
  samples: { id: string; name: string; sampleId: string }[];
  linkables: { id: string; code: string; name: string; entityTypeId: string }[];
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem',
};

const CONTROL: React.CSSProperties = {
  width: '100%', fontSize: '0.85rem', padding: '0.4rem 0.6rem',
};

function Field({
  def, value, onChange, options,
}: {
  def: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  options: Options;
}) {
  const label = (
    <label style={LABEL_STYLE}>
      {def.label}
      {def.required && <span style={{ color: '#b91c1c' }}> *</span>}
      {def.unit && <span style={{ textTransform: 'none', fontWeight: 400 }}> ({def.unit})</span>}
    </label>
  );

  switch (def.type) {
    case 'longtext':
      return (
        <div>
          {label}
          <textarea
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={{ ...CONTROL, height: 80, resize: 'vertical' }}
          />
        </div>
      );

    case 'boolean':
      return (
        <div>
          {label}
          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox" checked={value === true}
              onChange={e => onChange(e.target.checked)}
            />
            {value === true ? 'Yes' : 'No'}
          </label>
        </div>
      );

    case 'date':
      return (
        <div>
          {label}
          <input
            type="date" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          />
        </div>
      );

    case 'number':
    case 'integer':
      return (
        <div>
          {label}
          <input
            type="number" step={def.type === 'integer' ? 1 : 'any'}
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          />
        </div>
      );

    case 'select':
      return (
        <div>
          {label}
          <select
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          >
            <option value="">{def.required ? 'Choose one' : '—'}</option>
            {(def.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );

    case 'multiselect': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          {label}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {(def.options ?? []).map(o => {
              const on = chosen.includes(o);
              return (
                <button
                  key={o} type="button"
                  onClick={() => onChange(on ? chosen.filter(x => x !== o) : [...chosen, o])}
                  style={{
                    fontSize: '0.78rem', fontWeight: 600, padding: '0.22rem 0.55rem', borderRadius: 5,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${on ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                    background: on ? 'rgba(59,130,246,0.1)' : 'transparent',
                    color: on ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case 'sequence':
      return (
        <div>
          {label}
          <select
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          >
            <option value="">—</option>
            {options.sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      );

    case 'sample':
      return (
        <div>
          {label}
          <select
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          >
            <option value="">—</option>
            {options.samples.map(s => (
              <option key={s.id} value={s.id}>{s.sampleId} · {s.name}</option>
            ))}
          </select>
        </div>
      );

    case 'link': {
      const choices = options.linkables.filter(l => l.entityTypeId === def.linkTypeId);
      return (
        <div>
          {label}
          <select
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          >
            <option value="">—</option>
            {choices.map(l => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
          </select>
          {choices.length === 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
              Nothing of that type exists yet to link to.
            </p>
          )}
        </div>
      );
    }

    default:
      return (
        <div>
          {label}
          <input
            value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
            className="input-control" style={CONTROL}
          />
        </div>
      );
  }
}

export default function EntityForm({
  type, defs, projects, sequences, samples, linkables, initial, entityId,
}: {
  type: { id: string; name: string; prefix: string; color: string };
  defs: FieldDefinition[];
  initial?: { name: string; projectId: string | null; values: Record<string, unknown> };
  entityId?: string;
} & Options) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(entityId));
  const [name, setName] = useState(initial?.name ?? '');
  const [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(initial?.values ?? {});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const options: Options = { projects, sequences, samples, linkables };

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError(`Give the ${type.name.toLowerCase()} a name.`); return; }
    start(async () => {
      const fd = new FormData();
      fd.append('entityTypeId', type.id);
      if (entityId) fd.append('entityId', entityId);
      fd.append('name', name.trim());
      fd.append('projectId', projectId);
      fd.append('values', JSON.stringify(values));

      const r = await saveEntity(fd);
      if ('error' in r) { setError(r.error); return; }
      if (entityId) { router.refresh(); return; }
      setName(''); setValues({}); setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Plus size={15} /> New {type.name.toLowerCase()}
      </button>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: `4px solid ${type.color}` }}>
      <h2 style={{ fontSize: '1.02rem', margin: '0 0 1rem' }}>
        {entityId ? `Edit this ${type.name.toLowerCase()}` : `A new ${type.name.toLowerCase()}`}
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
        <div>
          <label style={LABEL_STYLE}>Name<span style={{ color: '#b91c1c' }}> *</span></label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            className="input-control" style={CONTROL}
          />
        </div>
        {defs.map(def => (
          <Field
            key={def.key}
            def={def}
            value={values[def.key]}
            onChange={v => setValues(s => ({ ...s, [def.key]: v }))}
            options={options}
          />
        ))}
        <div>
          <label style={LABEL_STYLE}>Project</label>
          <select
            value={projectId} onChange={e => setProjectId(e.target.value)}
            className="input-control" style={CONTROL}
          >
            <option value="">—</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: '1.2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={submit} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.84rem' }}>
          {pending ? 'Saving…' : entityId ? 'Save changes' : `Add ${type.name.toLowerCase()}`}
        </button>
        {!entityId && (
          <button onClick={() => setOpen(false)} className="btn btn-secondary" style={{ fontSize: '0.84rem' }}>
            Cancel
          </button>
        )}
      </div>
      {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
    </div>
  );
}
