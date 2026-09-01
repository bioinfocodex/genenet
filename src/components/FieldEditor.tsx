'use client';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { FIELD_TYPES, FIELD_TYPE_LABELS, keyFromLabel, type FieldType } from '@/lib/fields';

/**
 * Editing a list of typed field definitions.
 *
 * Shared by the entity-type builder and the result-schema builder. They are the
 * same act — declaring what a record holds — and having two copies would mean
 * a field type added to one and forgotten in the other.
 */

export interface DraftField {
  /** Present on a field that already exists; absent on a new one. */
  id?: string;
  /** Existing fields carry their key so values are not orphaned by a rename. */
  key?: string;
  label: string;
  type: FieldType;
  required: boolean;
  isUnique: boolean;
  /** Comma-separated while editing; split on submit. */
  options: string;
  unit: string;
  linkTypeId: string;
}

export function blankField(): DraftField {
  return {
    label: '', type: 'text', required: false, isUnique: false,
    options: '', unit: '', linkTypeId: '',
  };
}

/** What the server actions expect. */
export function toPayload(fields: DraftField[]) {
  return fields
    .filter(f => f.label.trim())
    .map(f => ({
      id: f.id,
      key: f.key,
      label: f.label.trim(),
      type: f.type,
      required: f.required,
      isUnique: f.isUnique,
      options: f.options ? f.options.split(',').map(s => s.trim()).filter(Boolean) : [],
      unit: f.unit.trim() || null,
      linkTypeId: f.type === 'link' ? f.linkTypeId : null,
    }));
}

export default function FieldEditor({
  fields, onChange, linkTypes, allowedTypes,
}: {
  fields: DraftField[];
  onChange: (next: DraftField[]) => void;
  /** Types a link field may point at. Empty disables the link type. */
  linkTypes: { id: string; name: string }[];
  /** Restrict which types are offered. Defaults to all of them. */
  allowedTypes?: readonly FieldType[];
}) {
  const types = allowedTypes ?? FIELD_TYPES;

  const patch = (i: number, over: Partial<DraftField>) =>
    onChange(fields.map((x, j) => (j === i ? { ...x, ...over } : x)));

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.8rem' }}>
        {fields.map((f, i) => (
          <div key={f.id ?? i} style={{
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
                value={f.type}
                onChange={e => patch(i, { type: e.target.value as FieldType })}
                // The type of a saved field is fixed: changing "number" to
                // "date" would leave every recorded value in the wrong column.
                disabled={Boolean(f.id)}
                title={f.id ? 'The type of an existing field cannot change — values are already stored in its column.' : undefined}
                className="input-control" style={{ fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
              >
                {types.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
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
                onClick={() => onChange(fields.filter((_, j) => j !== i))}
                disabled={fields.length === 1}
                style={{
                  background: 'none', border: 'none', cursor: fields.length === 1 ? 'default' : 'pointer',
                  color: fields.length === 1 ? 'var(--text-muted)' : '#b91c1c', padding: 4,
                }}
                title={f.id ? 'Removing this field deletes every value recorded under it' : 'Remove this field'}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {(f.type === 'select' || f.type === 'multiselect') && (
              <input
                value={f.options} onChange={e => patch(i, { options: e.target.value })}
                placeholder="Options, comma separated: pass, fail, repeat"
                className="input-control"
                style={{ width: '100%', marginTop: '0.45rem', fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
              />
            )}
            {(f.type === 'number' || f.type === 'integer') && (
              <input
                value={f.unit} onChange={e => patch(i, { unit: e.target.value })}
                placeholder="Unit, e.g. ng/µl"
                className="input-control"
                style={{ width: 200, marginTop: '0.45rem', fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
              />
            )}
            {f.type === 'link' && (
              linkTypes.length > 0 ? (
                <select
                  value={f.linkTypeId} onChange={e => patch(i, { linkTypeId: e.target.value })}
                  className="input-control"
                  style={{ marginTop: '0.45rem', fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
                >
                  <option value="">Which type does this point at?</option>
                  {linkTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : (
                <p style={{ fontSize: '0.78rem', color: '#a3560a', margin: '0.45rem 0 0' }}>
                  There is no record type to link to yet. Use a sequence or sample link instead.
                </p>
              )
            )}
            {f.label && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.4rem 0 0', fontFamily: 'monospace' }}>
                key: {f.key ?? keyFromLabel(f.label)}
                {f.id && ' (fixed)'}
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => onChange([...fields, blankField()])}
        className="btn btn-secondary"
        style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
      >
        <Plus size={13} /> Add a field
      </button>
    </>
  );
}
