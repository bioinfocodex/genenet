'use client';
import React from 'react';
import { 
  Layers, 
  Dna, 
  Eye, 
  Search, 
  BarChart2, 
  Settings2, 
  ChevronDown,
  Hash
} from 'lucide-react';

interface MolbuilderToolbarProps {
  layers: {
    feat: boolean;
    enz: boolean;
    primer: boolean;
    orf: boolean;
  };
  setLayers: (layers: any) => void;
  frames: Set<number>;
  setFrames: (frames: Set<number>) => void;
  viewMode: 'wrap' | 'linear';
  setViewMode: (mode: 'wrap' | 'linear') => void;
  lineLen: number;
  setLineLen: (len: number) => void;
  showStats: boolean;
  setShowStats: (show: boolean) => void;
  showFind: boolean;
  setShowFind: (show: boolean) => void;
}

export default function MolbuilderToolbar({
  layers,
  setLayers,
  frames,
  setFrames,
  viewMode,
  setViewMode,
  lineLen,
  setLineLen,
  showStats,
  setShowStats,
  showFind,
  setShowFind
}: MolbuilderToolbarProps) {
  
  const toggleLayer = (layer: string) => {
    setLayers({ ...layers, [layer]: !layers[layer as keyof typeof layers] });
  };

  const toggleFrame = (f: number) => {
    const next = new Set(frames);
    if (next.has(f)) next.delete(f); else next.add(f);
    setFrames(next);
  };

  return (
    <div className="seq-toolbar glass-panel" style={{ borderRadius: '12px 12px 0 0', borderBottom: '1px solid var(--seq-border)' }}>
      {/* Group: Visibility / Layers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '1rem', borderRight: '1px solid var(--seq-border)' }}>
        <ToolbarGroupLabel icon={<Layers size={14} />} label="Layers" />
        <ToolbarToggle active={layers.feat} onClick={() => toggleLayer('feat')} label="Feat" />
        <ToolbarToggle active={layers.enz} onClick={() => toggleLayer('enz')} label="Enz" />
        <ToolbarToggle active={layers.primer} onClick={() => toggleLayer('primer')} label="Prim" />
        <ToolbarToggle active={layers.orf} onClick={() => toggleLayer('orf')} label="ORF" />
      </div>

      {/* Group: Translation / Frames */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '1rem', borderRight: '1px solid var(--seq-border)' }}>
        <ToolbarGroupLabel icon={<Dna size={14} />} label="Frames" />
        <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
          {[1, 2, 3].map(f => (
            <ToolbarToggle key={f} active={frames.has(f)} onClick={() => toggleFrame(f)} label={`+${f}`} />
          ))}
          <div style={{ width: '1px', height: '16px', background: 'var(--seq-border)', margin: '0 0.2rem' }} />
          {[-1, -2, -3].map(f => (
            <ToolbarToggle key={f} active={frames.has(f)} onClick={() => toggleFrame(f)} label={`${f}`} />
          ))}
        </div>
      </div>

      {/* Group: View Settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingRight: '1.5rem' }}>
        <ToolbarGroupLabel icon={<Eye size={14} />} label="View" />
        <select 
          value={lineLen} 
          onChange={(e) => setLineLen(parseInt(e.target.value))}
          style={{ padding: '0.25rem 0.4rem', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid var(--glass-border)', fontWeight: 600 }}
        >
          <option value={50}>50 bp</option>
          <option value={60}>60 bp</option>
          <option value={80}>80 bp</option>
          <option value={100}>100 bp</option>
        </select>
      </div>

      {/* Group: Search & Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
        <ToolbarBtn active={showFind} onClick={() => setShowFind(!showFind)} icon={<Search size={16} />} label="Find" />
        <ToolbarBtn active={showStats} onClick={() => setShowStats(!showStats)} icon={<BarChart2 size={16} />} label="Stats" />
        <ToolbarBtn active={false} onClick={() => {}} icon={<Settings2 size={16} />} />
      </div>
    </div>
  );
}

function ToolbarGroupLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '0.25rem' }}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function ToolbarToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.3rem 0.6rem',
        borderRadius: '6px',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
        border: '1px solid ' + (active ? 'var(--accent-blue)' : 'var(--glass-border)'),
        background: active ? 'var(--accent-blue-15)' : 'white',
        color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
}

function ToolbarBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.75rem',
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        border: '1px solid ' + (active ? 'var(--accent-blue)' : 'transparent'),
        background: active ? 'var(--accent-blue-15)' : 'transparent',
        color: active ? 'var(--accent-blue)' : 'var(--text-primary)',
      }}
    >
      {icon}
      {label && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{label}</span>}
    </button>
  );
}
