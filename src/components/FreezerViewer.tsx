'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Box as BoxIcon, Search } from 'lucide-react';

interface Sample {
  id: string; sampleId: string; name: string; type: string;
  status: string; rack: string | null; box: string | null; position: string | null;
}
interface Freezer {
  id: string; name: string; temperature: number; location: string | null;
  samples: Sample[];
}

const TYPE_COLOR: Record<string, string> = {
  PLASMID:        'var(--accent-blue)',
  LINEAR_DNA:     'var(--accent-green)',
  GLYCEROL_STOCK: 'var(--accent-purple)',
  OTHER:          'var(--text-muted)',
};
const STATUS_OPACITY: Record<string, number> = {
  ACTIVE: 1, USED: 0.5, DEPLETED: 0.3, ARCHIVED: 0.25,
};

const ROWS = ['A','B','C','D','E','F','G','H'];
const COLS = [1,2,3,4,5,6,7,8,9,10,11,12];

export default function FreezerViewer({ freezers }: { freezers: Freezer[] }) {
  const [search, setSearch] = useState('');
  const [selectedFreezer, setSelectedFreezer] = useState<string | null>(freezers[0]?.id ?? null);
  const [selectedBox, setSelectedBox] = useState<{ rack: string; box: string } | null>(null);
  const [hoveredSample, setHoveredSample] = useState<Sample | null>(null);

  const freezer = freezers.find(f => f.id === selectedFreezer);

  const q = search.toLowerCase();
  const filteredSamples = freezer?.samples.filter(s =>
    !q || s.name.toLowerCase().includes(q) || s.sampleId.toLowerCase().includes(q) || s.type.toLowerCase().includes(q)
  ) ?? [];

  // Group samples: rack → box → position → sample
  const byRackBox = new Map<string, Map<string, Map<string, Sample>>>();
  for (const s of (freezer?.samples ?? [])) {
    const rack = s.rack ?? 'Unassigned';
    const box  = s.box  ?? 'Unassigned';
    const pos  = s.position ?? '?';
    if (!byRackBox.has(rack)) byRackBox.set(rack, new Map());
    const byBox = byRackBox.get(rack)!;
    if (!byBox.has(box)) byBox.set(box, new Map());
    byBox.get(box)!.set(pos, s);
  }

  const racks = Array.from(byRackBox.keys()).sort();
  const boxSamples = selectedBox
    ? (byRackBox.get(selectedBox.rack)?.get(selectedBox.box) ?? new Map<string, Sample>())
    : new Map<string, Sample>();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Freezer selector */}
      {freezers.length > 0 && (
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          {freezers.map(f => (
            <button
              key={f.id}
              onClick={() => { setSelectedFreezer(f.id); setSelectedBox(null); }}
              style={{
                padding: '0.55rem 1.1rem', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                border: `2px solid ${selectedFreezer === f.id ? (f.temperature === -80 ? 'var(--accent-purple)' : 'var(--accent-blue)') : 'var(--glass-border)'}`,
                background: selectedFreezer === f.id ? (f.temperature === -80 ? 'rgba(139,92,246,0.1)' : 'var(--accent-blue-15)') : 'white',
                color: selectedFreezer === f.id ? (f.temperature === -80 ? 'var(--accent-purple)' : 'var(--accent-blue)') : 'var(--text-secondary)',
                fontWeight: selectedFreezer === f.id ? 700 : 500, fontSize: '0.85rem', transition: 'all 0.15s',
              }}
            >
              {f.temperature === -80 ? '🧊' : '❄️'} {f.name}
              <span style={{ fontSize: '0.72rem', marginLeft: '0.4rem', opacity: 0.7 }}>
                {f.temperature}°C · {f.samples.length} samples
              </span>
            </button>
          ))}
        </div>
      )}

      {!freezer && (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          No freezers configured. Add one above.
        </div>
      )}

      {freezer && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* Left: rack/box list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>
              {freezer.name} — {freezer.temperature}°C
            </div>
            {racks.length === 0 && (
              <div className="glass-panel" style={{ padding: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>Empty</div>
            )}
            {racks.map(rack => {
              const boxes = Array.from(byRackBox.get(rack)!.keys()).sort();
              return (
                <div key={rack} className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>Rack {rack}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {boxes.map(box => {
                      const count = byRackBox.get(rack)!.get(box)!.size;
                      const active = selectedBox?.rack === rack && selectedBox?.box === box;
                      return (
                        <button
                          key={box}
                          onClick={() => setSelectedBox(active ? null : { rack, box })}
                          style={{
                            padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                            border: `1.5px solid ${active ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                            background: active ? 'var(--accent-blue-15)' : 'var(--bg-primary)',
                            color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                            fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.12s',
                          }}
                        >
                          Box {box} <span style={{ opacity: 0.65 }}>({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: box grid or sample list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Search bar */}
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} className="input-control" placeholder="Search samples…" style={{ width: '100%', paddingLeft: '2.1rem', padding: '0.5rem 0.75rem 0.5rem 2.1rem', fontSize: '0.85rem' }} />
            </div>

            {selectedBox ? (
              // Grid view for selected box
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '1rem' }}>
                  Rack {selectedBox.rack} · Box {selectedBox.box}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.78rem' }}>{boxSamples.size} / {ROWS.length * COLS.length} positions used</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'inline-grid', gridTemplateColumns: `24px repeat(${COLS.length}, 44px)`, gap: 3 }}>
                    {/* Column headers */}
                    <div />
                    {COLS.map(c => <div key={c} style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>{c}</div>)}
                    {/* Rows */}
                    {ROWS.map(row => (
                      <>
                        <div key={`row-${row}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>{row}</div>
                        {COLS.map(col => {
                          const pos = `${row}${col}`;
                          const sample = boxSamples.get(pos);
                          const color = sample ? (TYPE_COLOR[sample.type] ?? 'var(--text-muted)') : null;
                          const opacity = sample ? (STATUS_OPACITY[sample.status] ?? 1) : 1;
                          return (
                            <div
                              key={pos}
                              title={sample ? `${sample.sampleId}: ${sample.name}` : pos}
                              onMouseEnter={() => sample && setHoveredSample(sample)}
                              onMouseLeave={() => setHoveredSample(null)}
                              style={{
                                height: 36, borderRadius: 4, border: `1.5px solid ${sample ? color! : 'var(--glass-border)'}`,
                                background: sample ? `${color}22` : 'var(--bg-primary)',
                                cursor: sample ? 'pointer' : 'default',
                                opacity,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                                transition: 'all 0.1s',
                              }}
                            >
                              {sample && (
                                <Link href={`/samples/${sample.id}`} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: color! }} />
                                </Link>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ))}
                  </div>
                </div>
                {/* Hover tooltip */}
                {hoveredSample && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--glass-border)', fontSize: '0.82rem' }}>
                    <span style={{ fontWeight: 700, color: TYPE_COLOR[hoveredSample.type] }}>{hoveredSample.sampleId}</span>
                    <span style={{ color: 'var(--text-primary)', marginLeft: '0.5rem' }}>{hoveredSample.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>· {hoveredSample.type.replace('_', ' ')} · {hoveredSample.status}</span>
                    <Link href={`/samples/${hoveredSample.id}`} style={{ color: 'var(--accent-blue)', marginLeft: '0.75rem', fontSize: '0.78rem' }}>View →</Link>
                  </div>
                )}
                {/* Legend */}
                <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {Object.entries(TYPE_COLOR).map(([t, c]) => (
                    <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} />
                      {t.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              // Sample list when no box selected
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                  {q ? `Results for "${search}"` : `All samples in ${freezer.name}`}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({filteredSamples.length})</span>
                </div>
                {filteredSamples.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {q ? 'No matches found.' : 'No samples stored here yet.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {filteredSamples.map(s => (
                      <Link key={s.id} href={`/samples/${s.id}`} style={{ textDecoration: 'none' }}>
                        <div className="glass-card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', opacity: STATUS_OPACITY[s.status] ?? 1 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: TYPE_COLOR[s.type] ?? 'var(--text-muted)' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{s.name}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{s.sampleId}</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {[s.rack, s.box, s.position].filter(Boolean).join(' / ')}
                          </div>
                          <span style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', borderRadius: 4, background: 'var(--bg-primary)', color: s.status === 'ACTIVE' ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600 }}>{s.status}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
