'use client';
import { useState, useTransition } from 'react';
import { X, FlaskConical } from 'lucide-react';
import { createSample } from '@/app/actions/samples';

type SampleType = 'PLASMID' | 'LINEAR_DNA' | 'GLYCEROL_STOCK' | 'OTHER';

const TYPE_META: { value: SampleType; label: string; icon: string; temp: string }[] = [
  { value: 'PLASMID',        label: 'Plasmid DNA',     icon: '🔵', temp: '-20°C' },
  { value: 'LINEAR_DNA',     label: 'Linear DNA',      icon: '🟢', temp: '-20°C' },
  { value: 'GLYCEROL_STOCK', label: 'Glycerol Stock',  icon: '🟣', temp: '-80°C' },
  { value: 'OTHER',          label: 'Other Material',  icon: '⚪', temp: '-20°C' },
];

interface Freezer { id: string; name: string; temperature: number; }
interface Props {
  taskId?: string;
  projectId?: string;
  geneSequenceId?: string;
  taskTitle?: string;
  freezers: Freezer[];
  onClose: () => void;
}

export default function SampleRegistrationModal({ taskId, projectId, geneSequenceId, taskTitle, freezers, onClose }: Props) {
  const [type, setType] = useState<SampleType>('PLASMID');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [freezerId, setFreezerId] = useState(freezers[0]?.id ?? '');
  const [rack, setRack] = useState('');
  const [box, setBox] = useState('');
  const [position, setPosition] = useState('');
  const [isPending, startTransition] = useTransition();

  const selectedType = TYPE_META.find(t => t.value === type)!;
  const filteredFreezers = freezers.filter(f =>
    type === 'GLYCEROL_STOCK' ? f.temperature === -80 : f.temperature === -20
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const fd = new FormData();
    fd.append('name', name);
    fd.append('type', type);
    fd.append('description', description);
    fd.append('notes', notes);
    fd.append('freezerId', freezerId);
    fd.append('rack', rack);
    fd.append('box', box);
    fd.append('position', position.toUpperCase());
    if (taskId)          fd.append('taskId', taskId);
    if (projectId)       fd.append('projectId', projectId);
    if (geneSequenceId)  fd.append('geneSequenceId', geneSequenceId);
    startTransition(() => { createSample(fd); });
  };

  const L: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' };
  const I: React.CSSProperties = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', padding: '2rem', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
          <FlaskConical size={20} color="var(--accent-blue)" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Register Sample</h2>
        </div>
        {taskTitle && (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            From task: <strong style={{ color: 'var(--text-secondary)' }}>{taskTitle}</strong>
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Sample type selector */}
          <div>
            <label style={L}>Sample Type *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {TYPE_META.map(t => (
                <label
                  key={t.value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
                    padding: '0.6rem 0.9rem', borderRadius: 8,
                    border: `2px solid ${type === t.value ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                    background: type === t.value ? 'var(--accent-blue-15)' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} style={{ display: 'none' }} />
                  <span style={{ fontSize: '1.1rem' }}>{t.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem', color: type === t.value ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{t.label}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Store at {t.temp}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label style={L}>Sample Name * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(e.g. pUC19-GFP-Clone1)</span></label>
            <input value={name} onChange={e => setName(e.target.value)} required className="input-control" placeholder="Unique descriptive name" style={I} />
          </div>

          {/* Description */}
          <div>
            <label style={L}>Description / Notes</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-control" rows={2} placeholder="What was cloned, which construct, concentration…" style={{ ...I, resize: 'vertical' }} />
          </div>

          {/* Storage location */}
          <div>
            <label style={L}>
              Freezer <span style={{ fontWeight: 400, color: 'var(--accent-orange)' }}>→ {selectedType.temp}</span>
            </label>
            <select value={freezerId} onChange={e => setFreezerId(e.target.value)} className="input-control" style={I}>
              <option value="">None / Unassigned</option>
              {filteredFreezers.map(f => <option key={f.id} value={f.id}>{f.name} ({f.temperature}°C)</option>)}
              {filteredFreezers.length === 0 && <option disabled>No {type === 'GLYCEROL_STOCK' ? '-80°C' : '-20°C'} freezers configured</option>}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={L}>Rack</label>
              <input value={rack} onChange={e => setRack(e.target.value)} className="input-control" placeholder="e.g. 1, A" style={I} />
            </div>
            <div>
              <label style={L}>Box</label>
              <input value={box} onChange={e => setBox(e.target.value)} className="input-control" placeholder="e.g. 1, 2" style={I} />
            </div>
            <div>
              <label style={L}>Position</label>
              <input value={position} onChange={e => setPosition(e.target.value)} className="input-control" placeholder="e.g. A1, C4" style={I} maxLength={4} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!name.trim() || isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <FlaskConical size={15} /> {isPending ? 'Registering…' : 'Register Sample'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
