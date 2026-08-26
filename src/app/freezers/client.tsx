'use client';
import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { createFreezer } from '@/app/actions/samples';

export default function FreezersClient() {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [temperature, setTemperature] = useState<'-20' | '-80'>('-20');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', name);
    fd.append('temperature', temperature);
    fd.append('location', location);
    fd.append('notes', notes);
    startTransition(() => { createFreezer(fd); setShowModal(false); });
  };

  const L: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' };
  const I: React.CSSProperties = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' };

  return (
    <>
      <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
        <Plus size={15} /> Add Freezer
      </button>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: 460, padding: '2rem', position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={20} />
            </button>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.5rem' }}>Add Freezer</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={L}>Freezer Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} required className="input-control" placeholder="e.g. Lab -20°C #1, Ultra-low Freezer A" style={I} />
              </div>
              <div>
                <label style={L}>Temperature</label>
                <div style={{ display: 'flex', gap: '0.65rem' }}>
                  {(['-20', '-80'] as const).map(t => (
                    <label key={t} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.65rem', borderRadius: 8, border: `2px solid ${temperature === t ? (t === '-80' ? 'var(--accent-purple)' : 'var(--accent-blue)') : 'var(--glass-border)'}`, background: temperature === t ? (t === '-80' ? 'rgba(139,92,246,0.1)' : 'var(--accent-blue-15)') : 'transparent', transition: 'all 0.15s', fontWeight: temperature === t ? 700 : 400, color: temperature === t ? (t === '-80' ? 'var(--accent-purple)' : 'var(--accent-blue)') : 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      <input type="radio" value={t} checked={temperature === t} onChange={() => setTemperature(t)} style={{ display: 'none' }} />
                      {t === '-80' ? '🧊' : '❄️'} {t}°C
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={L}>Location</label>
                <input value={location} onChange={e => setLocation(e.target.value)} className="input-control" placeholder="e.g. Lab Room 2, West Wall" style={I} />
              </div>
              <div>
                <label style={L}>Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} className="input-control" placeholder="Optional notes" style={I} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={!name.trim() || isPending} className="btn btn-primary">
                  {isPending ? 'Adding…' : 'Add Freezer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
