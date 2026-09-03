'use client';
import React from 'react';
import {
  Layers,
  Pencil,
  Undo2,
  Dna,
  Eye,
  Search,
  BarChart2,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface MolbuilderToolbarProps {
  layers: {
    feat: boolean;
    enz: boolean;
    primer: boolean;
    orf: boolean;
  };
  setLayers: (layers: MolbuilderToolbarProps['layers']) => void;
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
  /** Sequence fills the window, app chrome and all. */
  focused: boolean;
  onToggleFocus: () => void;
  /** Armed for editing: typing changes the molecule. */
  editing: boolean;
  onToggleEditing: () => void;
  canUndo: boolean;
  onUndo: () => void;
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
  setShowFind,
  focused,
  onToggleFocus,
  editing,
  onToggleEditing,
  canUndo,
  onUndo,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '0.6rem', borderRight: '1px solid var(--seq-border)' }}>
        <ToolbarGroupLabel icon={<Layers size={14} />} label="Layers" />
        <ToolbarToggle active={layers.feat} onClick={() => toggleLayer('feat')} label="Feat" />
        <ToolbarToggle active={layers.enz} onClick={() => toggleLayer('enz')} label="Enz" />
        <ToolbarToggle active={layers.primer} onClick={() => toggleLayer('primer')} label="Prim" />
        <ToolbarToggle active={layers.orf} onClick={() => toggleLayer('orf')} label="ORF" />
      </div>

      {/* Group: Translation / Frames */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '0.6rem', borderRight: '1px solid var(--seq-border)' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '0.6rem' }}>
        <ToolbarGroupLabel icon={<Eye size={14} />} label="View" />
        <select 
          value={lineLen} 
          onChange={(e) => setLineLen(parseInt(e.target.value))}
          style={{ padding: '0.25rem 0.4rem', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid var(--glass-border)', fontWeight: 600 }}
        >
          <option value={0}>Fit width</option>
          <option value={50}>50 bp</option>
          <option value={60}>60 bp</option>
          <option value={80}>80 bp</option>
          <option value={100}>100 bp</option>
        </select>
      </div>

      {/* Group: Search & Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
        {/*
          * Editing is armed, not ambient. A view that mutates the molecule
          * whenever a key is pressed is one nobody can leave open safely.
          */}
        <ToolbarBtn
          active={editing}
          onClick={onToggleEditing}
          icon={<Pencil size={16} />}
          label={editing ? 'Editing' : 'Edit'}
          title={editing
            ? 'Typing changes the sequence. Click to stop.'
            : 'Click a base, then type to insert and ⌫ to delete'}
        />
        {editing && (
          <ToolbarBtn
            active={false}
            onClick={onUndo}
            icon={<Undo2 size={16} />}
            label="Undo"
            title={canUndo ? 'Undo the last edit (⌘Z)' : 'Nothing to undo'}
          />
        )}
        <ToolbarBtn active={showFind} onClick={() => setShowFind(!showFind)} icon={<Search size={16} />} label="Find" />
        <ToolbarBtn active={showStats} onClick={() => setShowStats(!showStats)} icon={<BarChart2 size={16} />} label="Stats" />
        {/*
          * The sequence over the whole window. Compacting the chrome buys back
          * a hundred and fifty pixels; this is the one that actually changes
          * how much sequence is on screen.
          */}
        <ToolbarBtn
          active={focused}
          onClick={onToggleFocus}
          icon={focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          label={focused ? 'Exit' : 'Full'}
          title={focused ? 'Back to the rest of the page (Esc)' : 'Fill the window with the sequence'}
        />
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
        padding: '0.2rem 0.45rem',
        borderRadius: '6px',
        fontSize: '0.72rem',
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

function ToolbarBtn({ active, onClick, icon, label, title }: { active: boolean; onClick: () => void; icon: React.ReactNode; label?: string; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.55rem',
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
