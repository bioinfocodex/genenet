'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { createSample } from '@/app/actions/samples';

type SampleType = 'PLASMID' | 'LINEAR_DNA' | 'GLYCEROL_STOCK' | 'OTHER';

const TYPE_META = [
  { value: 'PLASMID' as SampleType,        label: 'Plasmid DNA',    icon: '🔵', temp: '-20°C' },
  { value: 'LINEAR_DNA' as SampleType,     label: 'Linear DNA',     icon: '🟢', temp: '-20°C' },
  { value: 'GLYCEROL_STOCK' as SampleType, label: 'Glycerol Stock', icon: '🟣', temp: '-80°C' },
  { value: 'OTHER' as SampleType,          label: 'Other',          icon: '⚪', temp: '-20°C' },
];

interface Props {
  freezers:  { id: string; name: string; temperature: number }[];
  tasks:     { id: string; title: string; projectId: string | null }[];
  projects:  { id: string; name: string }[];
  sequences: { id: string; name: string }[];
}

export default function SampleNewWrapper({ freezers, tasks, projects, sequences }: Props) {
  const [type, setType] = useState<SampleType>('PLASMID');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [freezerId, setFreezerId] = useState(freezers[0]?.id ?? '');
  const [rack, setRack] = useState('');
  const [box, setBox] = useState('');
  const [position, setPosition] = useState('');
  const [taskId, setTaskId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [geneSequenceId, setGeneSequenceId] = useState('');
  const [isPending, startTransition] = useTransition();

  const filteredFreezers = freezers.filter(f =>
    type === 'GLYCEROL_STOCK' ? f.temperature === -80 : f.temperature === -20
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', name);
    fd.append('type', type);
    fd.append('description', description);
    fd.append('notes', notes);
    fd.append('freezerId', freezerId);
    fd.append('rack', rack);
    fd.append('box', box);
    fd.append('position', position.toUpperCase());
    fd.append('taskId', taskId);
    fd.append('projectId', projectId);
    fd.append('geneSequenceId', geneSequenceId);
    startTransition(() => { createSample(fd); });
  };

  const L: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' };
  const I: React.CSSProperties = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' };

  return (
    <div style={{ maxWidth: 660, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/samples" style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>← Sample Inventory</Link>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FlaskConical size={24} /> Register Sample
        </h1>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Type */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <label style={{ ...L, marginBottom: '0.75rem', fontSize: '0.85rem' }}>Sample Type *</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            {TYPE_META.map(t => (
              <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', padding: '0.75rem 1rem', borderRadius: 9, border: `2px solid ${type === t.value ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: type === t.value ? 'var(--accent-blue-15)' : 'transparent', transition: 'all 0.15s' }}>
                <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} style={{ display: 'none' }} />
                <span style={{ fontSize: '1.3rem' }}>{t.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: type === t.value ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{t.label}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Store at {t.temp}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Identity */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>Identity</h3>
          <div>
            <label style={L}>Sample Name * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(unique, descriptive)</span></label>
            <input value={name} onChange={e => setName(e.target.value)} required className="input-control" placeholder="e.g. pUC19-GFP-Clone1, YEAST-GS-01" style={I} />
          </div>
          <div>
            <label style={L}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-control" rows={2} placeholder="Construct details, concentration, source…" style={{ ...I, resize: 'vertical' }} />
          </div>
          <div>
            <label style={L}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="input-control" placeholder="e.g. 100 ng/µL, sequencing confirmed" style={I} />
          </div>
        </div>

        {/* Storage */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>Storage Location</h3>
          <div>
            <label style={L}>Freezer</label>
            <select value={freezerId} onChange={e => setFreezerId(e.target.value)} className="input-control" style={I}>
              <option value="">None / Unassigned</option>
              {filteredFreezers.map(f => <option key={f.id} value={f.id}>{f.name} ({f.temperature}°C)</option>)}
              {filteredFreezers.length === 0 && freezers.length > 0 && <option disabled>No matching temperature freezers — add one in Freezers</option>}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div><label style={L}>Rack</label><input value={rack} onChange={e => setRack(e.target.value)} className="input-control" placeholder="e.g. 1" style={I} /></div>
            <div><label style={L}>Box</label><input value={box} onChange={e => setBox(e.target.value)} className="input-control" placeholder="e.g. 2" style={I} /></div>
            <div><label style={L}>Position</label><input value={position} onChange={e => setPosition(e.target.value)} className="input-control" placeholder="e.g. A1" style={I} maxLength={4} /></div>
          </div>
        </div>

        {/* Linkages */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>Linkages</h3>
          <div>
            <label style={L}>Source Task</label>
            <select value={taskId} onChange={e => { setTaskId(e.target.value); const t = tasks.find(t => t.id === e.target.value); if (t?.projectId && !projectId) setProjectId(t.projectId); }} className="input-control" style={I}>
              <option value="">None</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div>
            <label style={L}>Project</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input-control" style={I}>
              <option value="">None</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={L}>Source Sequence</label>
            <select value={geneSequenceId} onChange={e => setGeneSequenceId(e.target.value)} className="input-control" style={I}>
              <option value="">None</option>
              {sequences.map(s => <option key={s.id} value={s.id}>🧬 {s.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Link href="/samples" className="btn btn-secondary">Cancel</Link>
          <button type="submit" disabled={!name.trim() || isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FlaskConical size={15} /> {isPending ? 'Registering…' : 'Register Sample'}
          </button>
        </div>
      </form>
    </div>
  );
}
