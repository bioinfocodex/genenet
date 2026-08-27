'use client';
import { useState, useTransition } from 'react';
import { updateGel } from '@/app/actions/gels';
import { LADDER_1KB, gelPosition } from '@/lib/simulation';
import { Plus, Trash2, GripVertical, Save } from 'lucide-react';

interface Band {
  size: number;
  label: string;
  color: string;
  highlight: boolean;
}
interface Lane {
  id: string;
  name: string;
  color: string;
  bands: Band[];
}
interface GelData {
  id: string;
  name: string;
  concentration: number;
  voltage: number;
  runTime: number;
  lanes: string;
}

const LANE_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b', '#06b6d4', '#f97316', '#ec4899'];

export default function GelEditor({ gel: initGel }: { gel: GelData }) {
  const [name, setName] = useState(initGel.name);
  const [concentration, setConcentration] = useState(initGel.concentration);
  const [voltage, setVoltage] = useState(initGel.voltage);
  const [runTime, setRunTime] = useState(initGel.runTime);
  const [lanes, setLanes] = useState<Lane[]>(() => {
    try { return JSON.parse(initGel.lanes); } catch { return []; }
  });
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [newBandSize, setNewBandSize] = useState<Record<string, string>>({});
  const [newBandLabel, setNewBandLabel] = useState<Record<string, string>>({});

  const addLane = () => {
    const id = `lane-${Date.now()}`;
    setLanes(prev => [...prev, { id, name: `Lane ${prev.length + 1}`, color: LANE_COLORS[prev.length % LANE_COLORS.length], bands: [] }]);
  };

  const removeLane = (id: string) => setLanes(prev => prev.filter(l => l.id !== id));

  const updateLane = (id: string, update: Partial<Lane>) =>
    setLanes(prev => prev.map(l => l.id === id ? { ...l, ...update } : l));

  const addBand = (laneId: string) => {
    const size = parseInt(newBandSize[laneId] || '');
    if (isNaN(size) || size <= 0) return;
    const label = newBandLabel[laneId] || `${size} bp`;
    setLanes(prev => prev.map(l => l.id === laneId ? { ...l, bands: [...l.bands, { size, label, color: l.color, highlight: false }] } : l));
    setNewBandSize(p => ({ ...p, [laneId]: '' }));
    setNewBandLabel(p => ({ ...p, [laneId]: '' }));
  };

  const removeBand = (laneId: string, idx: number) =>
    setLanes(prev => prev.map(l => l.id === laneId ? { ...l, bands: l.bands.filter((_, i) => i !== idx) } : l));

  const toggleHighlight = (laneId: string, idx: number) =>
    setLanes(prev => prev.map(l => l.id === laneId ? { ...l, bands: l.bands.map((b, i) => i === idx ? { ...b, highlight: !b.highlight } : b) } : l));

  const handleSave = () => {
    const fd = new FormData();
    fd.append('id', initGel.id);
    fd.append('name', name);
    fd.append('concentration', String(concentration));
    fd.append('voltage', String(voltage));
    fd.append('runTime', String(runTime));
    fd.append('lanes', JSON.stringify(lanes));
    startTransition(async () => { await updateGel(fd); setSaved(true); setTimeout(() => setSaved(false), 2000); });
  };

  // Gel visualization constants
  const GEL_H = 400;
  const LANE_W = 70;
  const LADDER_W = 65;
  const PAD = { top: 30, bottom: 20 };
  const totalW = LADDER_W + lanes.length * LANE_W + 20;

  const allBandSizes = lanes.flatMap(l => l.bands.map(b => b.size));
  const minBp = Math.max(50, Math.min(...allBandSizes, ...LADDER_1KB));
  const maxBp = Math.max(10000, ...allBandSizes, ...LADDER_1KB);
  const toY = (size: number) => PAD.top + gelPosition(size, minBp, maxBp) * (GEL_H - PAD.top - PAD.bottom);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Settings bar */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 160 }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Gel Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.88rem', width: '100%' }} />
          </div>
          {[
            { label: 'Agarose (%)', value: concentration, set: setConcentration, min: 0.5, max: 3, step: 0.1 },
            { label: 'Voltage (V)', value: voltage, set: setVoltage, min: 50, max: 200, step: 10 },
            { label: 'Run Time (min)', value: runTime, set: setRunTime, min: 10, max: 120, step: 5 },
          ].map(({ label, value, set, min, max, step }) => (
            <div key={label} style={{ minWidth: 130 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>{label}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="range" min={min} max={max} step={step} value={value} onChange={e => set(parseFloat(e.target.value) as any)} style={{ flex: 1 }} />
                <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', minWidth: 36 }}>{value}</span>
              </div>
            </div>
          ))}
          <button onClick={handleSave} disabled={isPending} className="btn btn-primary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Save size={14} /> {isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1.5rem', alignItems: 'start' }}>
        {/* Lane editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 600 }}>Lanes</h3>
            <button onClick={addLane} className="btn btn-secondary" style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Plus size={12} /> Add Lane
            </button>
          </div>

          {lanes.length === 0 && (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem', border: '1px dashed var(--glass-border)', borderRadius: '8px' }}>
              Click &ldquo;Add Lane&rdquo; to start building your gel
            </div>
          )}

          {lanes.map((lane, li) => (
            <div key={lane.id} className="glass-panel" style={{ padding: '1rem', borderLeft: `3px solid ${lane.color}` }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <input
                  value={lane.name}
                  onChange={e => updateLane(lane.id, { name: e.target.value })}
                  className="input-control"
                  style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                  placeholder={`Lane ${li + 1}`}
                />
                <input type="color" value={lane.color} onChange={e => updateLane(lane.id, { color: e.target.value })} style={{ width: 32, height: 32, padding: 0, border: 'none', cursor: 'pointer', borderRadius: '4px' }} />
                <button onClick={() => removeLane(lane.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: '0.2rem' }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Existing bands */}
              {lane.bands.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.65rem' }}>
                  {lane.bands.map((band, bi) => (
                    <div key={bi} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.5rem', background: 'white', borderRadius: '5px', border: `1px solid ${band.highlight ? lane.color : 'var(--glass-border)'}` }}>
                      <button onClick={() => toggleHighlight(lane.id, bi)} style={{ width: 10, height: 10, borderRadius: '50%', background: band.highlight ? lane.color : 'var(--glass-border)', border: 'none', cursor: 'pointer', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--accent-blue)', fontWeight: 600, minWidth: 55 }}>{band.size} bp</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1 }}>{band.label}</span>
                      <button onClick={() => removeBand(lane.id, bi)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.1rem' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add band */}
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input type="number" value={newBandSize[lane.id] || ''} onChange={e => setNewBandSize(p => ({ ...p, [lane.id]: e.target.value }))} className="input-control" style={{ width: 80, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} placeholder="bp" min="50" />
                <input value={newBandLabel[lane.id] || ''} onChange={e => setNewBandLabel(p => ({ ...p, [lane.id]: e.target.value }))} className="input-control" style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} placeholder="label (optional)" />
                <button onClick={() => addBand(lane.id)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }}>+ Band</button>
              </div>
            </div>
          ))}
        </div>

        {/* Gel visualization */}
        <div className="glass-panel" style={{ padding: '1rem', position: 'sticky', top: '1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', textAlign: 'center' }}>
            {concentration}% · {voltage}V · {runTime} min
          </div>
          <div style={{ overflowX: 'auto' }}>
            <svg width={totalW} height={GEL_H + 30} style={{ display: 'block', background: '#1e293b', borderRadius: '6px', minWidth: totalW }}>
              {/* Ladder */}
              {LADDER_1KB.filter(s => s >= minBp && s <= maxBp).map((s, i) => {
                const y = toY(s);
                return (
                  <g key={i}>
                    <rect x={4} y={y - 2} width={LADDER_W - 12} height={4} fill="#64748b" rx={1} />
                    <text x={LADDER_W - 6} y={y + 1} fontSize={8} fill="#94a3b8" textAnchor="end" dominantBaseline="middle" fontFamily="monospace">
                      {s >= 1000 ? `${s / 1000}k` : s}
                    </text>
                  </g>
                );
              })}
              <text x={LADDER_W / 2} y={GEL_H + 16} fontSize={9} fill="#64748b" textAnchor="middle">Ladder</text>

              {/* Sample lanes */}
              {lanes.map((lane, li) => {
                const lx = LADDER_W + li * LANE_W;
                return (
                  <g key={lane.id}>
                    {lane.bands.map((band, bi) => {
                      const y = toY(band.size);
                      return (
                        <g key={bi}>
                          <rect x={lx + 6} y={y - 3} width={LANE_W - 16} height={band.highlight ? 7 : 5} fill={lane.color} opacity={band.highlight ? 1 : 0.8} rx={1} />
                          {band.highlight && (
                            <text x={lx + 6 + (LANE_W - 16) / 2} y={y + 12} fontSize={7} fill={lane.color} textAnchor="middle">{band.size} bp</text>
                          )}
                        </g>
                      );
                    })}
                    <text x={lx + LANE_W / 2} y={GEL_H + 16} fontSize={9} fill="#94a3b8" textAnchor="middle" style={{ overflow: 'hidden' }}>
                      {lane.name.length > 8 ? lane.name.slice(0, 7) + '…' : lane.name}
                    </text>
                  </g>
                );
              })}

              {/* Well indicators at top */}
              {lanes.map((lane, li) => {
                const lx = LADDER_W + li * LANE_W;
                return <rect key={lane.id} x={lx + 8} y={8} width={LANE_W - 20} height={12} fill="#334155" rx={2} />;
              })}
              <rect x={6} y={8} width={LADDER_W - 14} height={12} fill="#334155" rx={2} />
            </svg>
          </div>
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {lanes.map(lane => (
              <span key={lane.id} style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-muted)' }}>
                <span style={{ width: 8, height: 3, background: lane.color, borderRadius: 1, display: 'inline-block' }} />
                {lane.name} ({lane.bands.length})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
