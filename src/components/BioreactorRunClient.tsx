'use client';
import { useState, useTransition } from 'react';
import { addReading, deleteReading, updateRunStatus } from '@/app/actions/bioreactors';
import BioreactorChart from './BioreactorChart';
import { Trash2, Plus, Activity } from 'lucide-react';

interface Reading {
  id: string;
  elapsedHrs: number;
  ph: number | null;
  temperature: number | null;
  dissolvedO2: number | null;
  feedRate: number | null;
  agitation: number | null;
  od600: number | null;
  notes: string | null;
  recordedAt: Date;
}
interface Run {
  id: string;
  name: string;
  vesselSize: string;
  organism: string | null;
  medium: string | null;
  status: string;
  notes: string | null;
  startedAt: Date;
  endedAt: Date | null;
  readings: Reading[];
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING: 'badge-green',
  COMPLETED: 'badge-blue',
  FAILED: 'badge-red',
  PAUSED: 'badge-orange',
};

export default function BioreactorRunClient({ run: initRun }: { run: Run }) {
  const [run] = useState(initRun);
  const [readings, setReadings] = useState(initRun.readings);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ elapsedHrs: '', ph: '', temperature: '', dissolvedO2: '', feedRate: '', agitation: '', od600: '', notes: '' });

  const handleAddReading = () => {
    if (!form.elapsedHrs) return;
    const fd = new FormData();
    fd.append('runId', run.id);
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
    startTransition(async () => {
      await addReading(fd);
      setForm({ elapsedHrs: '', ph: '', temperature: '', dissolvedO2: '', feedRate: '', agitation: '', od600: '', notes: '' });
    });
  };

  const handleDelete = (id: string) => {
    const fd = new FormData(); fd.append('id', id); fd.append('runId', run.id);
    startTransition(() => deleteReading(fd));
    setReadings(prev => prev.filter(r => r.id !== id));
  };

  const handleStatusChange = (status: string) => {
    const fd = new FormData(); fd.append('id', run.id); fd.append('status', status);
    startTransition(() => updateRunStatus(fd));
  };

  const numField = (key: keyof typeof form, label: string, placeholder?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{label}</label>
      <input type="number" step="any" value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className="input-control" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }} placeholder={placeholder} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div className="glass-panel" style={{ padding: '1.5rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{run.vesselSize}</span>
              <span className={`badge ${STATUS_COLORS[run.status] ?? ''}`}>{run.status}</span>
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={20} color="var(--accent-green)" /> {run.name}
            </h1>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {run.organism && <span>Organism: <strong>{run.organism}</strong></span>}
              {run.medium && <span>Medium: <strong>{run.medium}</strong></span>}
              <span>Started: <strong>{new Date(run.startedAt).toLocaleDateString()}</strong></span>
              {run.endedAt && <span>Ended: <strong>{new Date(run.endedAt).toLocaleDateString()}</strong></span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {run.status === 'RUNNING' && <>
              <button onClick={() => handleStatusChange('PAUSED')} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>⏸ Pause</button>
              <button onClick={() => handleStatusChange('COMPLETED')} className="btn btn-secondary" style={{ fontSize: '0.82rem', color: 'var(--accent-green)' }}>✓ Complete</button>
              <button onClick={() => handleStatusChange('FAILED')} className="btn btn-secondary" style={{ fontSize: '0.82rem', color: 'var(--accent-red)' }}>✕ Failed</button>
            </>}
            {run.status === 'PAUSED' && <button onClick={() => handleStatusChange('RUNNING')} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>▶ Resume</button>}
          </div>
        </div>
        {run.notes && <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>{run.notes}</div>}
      </div>

      {/* Chart */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>Time Series</h3>
        <BioreactorChart readings={readings} />
      </div>

      {/* Add reading */}
      {(run.status === 'RUNNING' || run.status === 'PAUSED') && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>Log Reading</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.65rem', marginBottom: '0.75rem' }}>
            {numField('elapsedHrs', 'Elapsed (h) *', '0.0')}
            {numField('ph', 'pH', '7.0')}
            {numField('temperature', 'Temp (°C)', '37')}
            {numField('dissolvedO2', 'DO₂ (%)', '100')}
            {numField('feedRate', 'Feed (mL/h)', '0')}
            {numField('agitation', 'Agitation (rpm)', '200')}
            {numField('od600', 'OD₆₀₀', '0.0')}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Notes</label>
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="input-control" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem', width: '100%' }} placeholder="Optional notes" />
            </div>
            <button className="btn btn-primary" onClick={handleAddReading} disabled={!form.elapsedHrs || isPending} style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
              <Plus size={14} /> Log
            </button>
          </div>
        </div>
      )}

      {/* Readings table */}
      {readings.length > 0 && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--glass-border)', fontSize: '0.85rem', fontWeight: 600 }}>Data Log ({readings.length} readings)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  {['h', 'pH', 'Temp °C', 'DO₂ %', 'Feed mL/h', 'RPM', 'OD₆₀₀', 'Notes', ''].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: i < readings.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{r.elapsedHrs.toFixed(2)}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{r.ph?.toFixed(2) ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: '#ef4444' }}>{r.temperature?.toFixed(1) ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--accent-green)' }}>{r.dissolvedO2?.toFixed(1) ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: '#f59e0b' }}>{r.feedRate?.toFixed(1) ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{r.agitation ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--accent-purple)' }}>{r.od600?.toFixed(3) ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes ?? ''}</td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <button onClick={() => handleDelete(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.15rem' }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
