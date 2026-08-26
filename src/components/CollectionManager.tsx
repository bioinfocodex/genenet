'use client';
import { useState, useTransition } from 'react';
import { Plus, Trash2, Layers, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { createCollection, deleteCollection, addToCollection, removeFromCollection } from '@/app/actions/collections';

interface CollectionItem {
  id: string;
  itemType: string;
  itemId: string;
  notes: string | null;
}
interface Collection {
  id: string;
  name: string;
  description: string | null;
  items: CollectionItem[];
}
interface SeqRecord { id: string; name: string; type: string; size: number; }
interface ProtRecord { id: string; name: string; mw: number | null; }

interface Props {
  collections: Collection[];
  sequences: SeqRecord[];
  proteins: ProtRecord[];
}

export default function CollectionManager({ collections: init, sequences, proteins }: Props) {
  const [collections, setCollections] = useState(init);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!newName.trim()) return;
    const fd = new FormData();
    fd.append('name', newName);
    fd.append('description', newDesc);
    startTransition(async () => {
      await createCollection(fd);
      setNewName(''); setNewDesc(''); setShowForm(false);
    });
  };

  const handleDelete = (id: string) => {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => { await deleteCollection(fd); });
  };

  const handleAdd = (collectionId: string, itemType: string, itemId: string) => {
    const fd = new FormData();
    fd.append('collectionId', collectionId);
    fd.append('itemType', itemType);
    fd.append('itemId', itemId);
    startTransition(async () => { await addToCollection(fd); });
  };

  const handleRemove = (id: string) => {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => { await removeFromCollection(fd); });
  };

  const exportCSV = (col: Collection) => {
    const rows = [['Type', 'Name', 'Details', 'Notes']];
    col.items.forEach(item => {
      if (item.itemType === 'sequence') {
        const s = sequences.find(x => x.id === item.itemId);
        if (s) rows.push(['sequence', s.name, `${s.type} · ${s.size} bp`, item.notes ?? '']);
      } else if (item.itemType === 'protein') {
        const p = proteins.find(x => x.id === item.itemId);
        if (p) rows.push(['protein', p.name, `${p.mw ?? '?'} kDa`, item.notes ?? '']);
      }
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${col.name}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* New collection form */}
      {showForm ? (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>New Collection</h3>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} className="input-control" placeholder="Collection name" style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.88rem' }} />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} className="input-control" placeholder="Description (optional)" style={{ flex: 2, padding: '0.5rem 0.75rem', fontSize: '0.88rem' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={!newName || isPending} style={{ fontSize: '0.82rem' }}>Create</button>
            <button className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ fontSize: '0.82rem' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setShowForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', alignSelf: 'flex-start', fontSize: '0.88rem' }}>
          <Plus size={15} /> New Collection
        </button>
      )}

      {/* Collections list */}
      {init.length === 0 && !showForm && (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Layers size={36} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
          <p>No collections yet. Create one to organize sequences and proteins.</p>
        </div>
      )}

      {init.map(col => (
        <CollectionCard
          key={col.id}
          col={col}
          expanded={expandedId === col.id}
          onToggle={() => setExpandedId(prev => prev === col.id ? null : col.id)}
          sequences={sequences}
          proteins={proteins}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onDelete={handleDelete}
          onExport={() => exportCSV(col)}
          isPending={isPending}
        />
      ))}
    </div>
  );
}

function CollectionCard({ col, expanded, onToggle, sequences, proteins, onAdd, onRemove, onDelete, onExport, isPending }: {
  col: Collection;
  expanded: boolean;
  onToggle: () => void;
  sequences: SeqRecord[];
  proteins: ProtRecord[];
  onAdd: (colId: string, type: string, itemId: string) => void;
  onRemove: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  isPending: boolean;
}) {
  const [addType, setAddType] = useState<'sequence' | 'protein'>('sequence');
  const [addId, setAddId] = useState('');

  const resolvedItems = col.items.map(item => {
    if (item.itemType === 'sequence') {
      const s = sequences.find(x => x.id === item.itemId);
      return s ? { ...item, label: s.name, detail: `${s.type} · ${s.size} bp`, color: s.type === 'plasmid' ? 'var(--accent-blue)' : 'var(--accent-green)' } : null;
    } else if (item.itemType === 'protein') {
      const p = proteins.find(x => x.id === item.itemId);
      return p ? { ...item, label: p.name, detail: `${p.mw?.toFixed(1) ?? '?'} kDa protein`, color: 'var(--accent-purple)' } : null;
    }
    return null;
  }).filter(Boolean) as { id: string; label: string; detail: string; color: string; itemType: string }[];

  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', cursor: 'pointer' }} onClick={onToggle}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{col.name}</div>
          {col.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{col.description}</div>}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>
          {col.items.length} items
        </span>
        <button onClick={e => { e.stopPropagation(); onExport(); }} title="Export CSV" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
          <Download size={14} />
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(col.id); }} title="Delete collection" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: '0.2rem' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--glass-border)', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Add item */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={addType} onChange={e => { setAddType(e.target.value as any); setAddId(''); }} className="input-control" style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}>
              <option value="sequence">Sequence</option>
              <option value="protein">Protein</option>
            </select>
            <select value={addId} onChange={e => setAddId(e.target.value)} className="input-control" style={{ flex: 1, minWidth: 160, padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}>
              <option value="">— pick item —</option>
              {addType === 'sequence'
                ? sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                : proteins.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={() => { if (addId) { onAdd(col.id, addType, addId); setAddId(''); } }} disabled={!addId || isPending} style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Plus size={13} /> Add
            </button>
          </div>

          {/* Items */}
          {resolvedItems.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No items yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {resolvedItems.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: 'white', borderRadius: '6px', border: '1px solid var(--glass-border)' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, color: item.color, background: item.color + '15', padding: '0.1rem 0.35rem', borderRadius: '3px', textTransform: 'uppercase' }}>{item.itemType}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.detail}</span>
                  <button onClick={() => onRemove(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.15rem' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
