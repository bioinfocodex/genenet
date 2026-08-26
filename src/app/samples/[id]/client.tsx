'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Save, Trash2, FlaskConical } from 'lucide-react';
import { updateSample, updateSampleStatus, deleteSample } from '@/app/actions/samples';

const TYPE_COLOR: Record<string, string> = {
  PLASMID:        'var(--accent-blue)',
  LINEAR_DNA:     'var(--accent-green)',
  GLYCEROL_STOCK: 'var(--accent-purple)',
  OTHER:          'var(--text-muted)',
};

const STATUS_OPTIONS = ['ACTIVE', 'USED', 'DEPLETED', 'ARCHIVED'];
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'var(--accent-green)', USED: 'var(--accent-orange)',
  DEPLETED: 'var(--accent-red)', ARCHIVED: 'var(--text-muted)',
};

interface Freezer  { id: string; name: string; temperature: number; }
interface Sequence { id: string; name: string; }
interface Sample {
  id: string; sampleId: string; name: string; type: string; status: string;
  description: string | null; notes: string | null;
  rack: string | null; box: string | null; position: string | null;
  freezer:      { id: string; name: string; temperature: number } | null;
  task:         { id: string; title: string } | null;
  project:      { id: string; name: string } | null;
  geneSequence: { id: string; name: string } | null;
  createdBy:    { name: string } | null;
  createdAt:    string | Date;
}

export default function SampleDetailClient({ sample, freezers, sequences }: { sample: Sample; freezers: Freezer[]; sequences: Sequence[] }) {
  const [name, setName] = useState(sample.name);
  const [description, setDescription] = useState(sample.description ?? '');
  const [notes, setNotes] = useState(sample.notes ?? '');
  const [freezerId, setFreezerId] = useState(sample.freezer?.id ?? '');
  const [rack, setRack] = useState(sample.rack ?? '');
  const [box, setBox] = useState(sample.box ?? '');
  const [position, setPosition] = useState(sample.position ?? '');
  const [geneSequenceId, setGeneSequenceId] = useState(sample.geneSequence?.id ?? '');
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const accentColor = TYPE_COLOR[sample.type] ?? 'var(--text-muted)';

  const handleSave = () => {
    const fd = new FormData();
    fd.append('id', sample.id);
    fd.append('name', name);
    fd.append('description', description);
    fd.append('notes', notes);
    fd.append('freezerId', freezerId);
    fd.append('rack', rack);
    fd.append('box', box);
    fd.append('position', position.toUpperCase());
    fd.append('geneSequenceId', geneSequenceId);
    startTransition(async () => { await updateSample(fd); setSaved(true); setTimeout(() => setSaved(false), 2000); });
  };

  const handleStatus = (status: string) => {
    const fd = new FormData();
    fd.append('id', sample.id);
    fd.append('status', status);
    startTransition(() => { updateSampleStatus(fd); });
  };

  const L: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' };
  const I: React.CSSProperties = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Header card */}
      <div className="glass-panel" style={{ padding: '1.75rem 2rem', borderLeft: `4px solid ${accentColor}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem', color: accentColor }}>{sample.sampleId}</span>
              <span style={{ fontSize: '0.75rem', background: `${accentColor}18`, color: accentColor, padding: '0.2rem 0.6rem', borderRadius: 5, fontWeight: 600 }}>
                {sample.type.replace('_', ' ')}
              </span>
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{sample.name}</h1>
            {sample.description && <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '0.3rem' }}>{sample.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => handleStatus(s)}
                disabled={isPending}
                style={{
                  padding: '0.35rem 0.75rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
                  border: `1.5px solid ${sample.status === s ? STATUS_COLOR[s] : 'var(--glass-border)'}`,
                  background: sample.status === s ? `${STATUS_COLOR[s]}18` : 'transparent',
                  color: sample.status === s ? STATUS_COLOR[s] : 'var(--text-muted)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', flexWrap: 'wrap', fontSize: '0.82rem' }}>
          {sample.freezer && (
            <span style={{ color: 'var(--text-secondary)' }}>
              ❄️ <strong>{sample.freezer.name}</strong> ({sample.freezer.temperature}°C)
              {(sample.rack || sample.box || sample.position) && ` · ${[sample.rack && `R${sample.rack}`, sample.box && `B${sample.box}`, sample.position].filter(Boolean).join(' ')}`}
            </span>
          )}
          {sample.task && <Link href={`/tasks/${sample.task.id}`} style={{ color: 'var(--accent-blue)' }}>📋 {sample.task.title}</Link>}
          {sample.project && <span style={{ color: 'var(--text-muted)' }}>📁 {sample.project.name}</span>}
          {sample.geneSequence && <Link href={`/sequences/${sample.geneSequence.id}`} style={{ color: 'var(--accent-green)' }}>🧬 {sample.geneSequence.name}</Link>}
          {sample.createdBy && <span style={{ color: 'var(--text-muted)' }}>👤 {sample.createdBy.name}</span>}
          <span style={{ color: 'var(--text-muted)' }}>📅 {new Date(sample.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Edit form */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Edit Details</h3>
        <div>
          <label style={L}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input-control" style={I} />
        </div>
        <div>
          <label style={L}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-control" rows={2} style={{ ...I, resize: 'vertical' }} />
        </div>
        <div>
          <label style={L}>Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="input-control" placeholder="e.g. 100 ng/µL, sequencing confirmed" style={I} />
        </div>

        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: '0.5rem' }}>Storage Location</h3>
        <div>
          <label style={L}>Freezer</label>
          <select value={freezerId} onChange={e => setFreezerId(e.target.value)} className="input-control" style={I}>
            <option value="">None</option>
            {freezers.map(f => <option key={f.id} value={f.id}>{f.name} ({f.temperature}°C)</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <div><label style={L}>Rack</label><input value={rack} onChange={e => setRack(e.target.value)} className="input-control" placeholder="e.g. 1" style={I} /></div>
          <div><label style={L}>Box</label><input value={box} onChange={e => setBox(e.target.value)} className="input-control" placeholder="e.g. 2" style={I} /></div>
          <div><label style={L}>Position</label><input value={position} onChange={e => setPosition(e.target.value.toUpperCase())} className="input-control" placeholder="e.g. A1" style={I} maxLength={4} /></div>
        </div>

        <div>
          <label style={L}>Linked Sequence</label>
          <select value={geneSequenceId} onChange={e => setGeneSequenceId(e.target.value)} className="input-control" style={I}>
            <option value="">None</option>
            {sequences.map(s => <option key={s.id} value={s.id}>🧬 {s.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
          <form action={deleteSample}>
            <input type="hidden" name="id" value={sample.id} />
            <button type="submit" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--accent-red)', background: 'transparent', border: '1px solid var(--accent-red)', borderRadius: 7, padding: '0.45rem 0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              <Trash2 size={13} /> Delete Sample
            </button>
          </form>
          <button onClick={handleSave} disabled={isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <Save size={14} /> {isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
