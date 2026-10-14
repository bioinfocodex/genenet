'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, ChevronDown, X, Folder, Database, Plus } from 'lucide-react';
import SequenceViewer, { type SequenceFeature, type SavedPrimer } from '@/components/SequenceViewer';
import type { LibraryFeature } from '@/lib/features.data';
import { openTab, closeTab, writeDesk, type Desk } from '@/lib/workspace';

export interface TreeSequence { id: string; name: string; type: string; size: number }
export interface TreeGroup { id: string; name: string; sequences: TreeSequence[] }

export interface OpenSequence {
  id: string; name: string; sequence: string; size: number; seqType: string;
  host: string | null; strain: string | null;
  features: SequenceFeature[]; primers: SavedPrimer[];
}

export default function WorkspaceClient(
  { groups, open, activeId, library }:
  { groups: TreeGroup[]; open: OpenSequence[]; activeId: string | null; library: LibraryFeature[] },
) {
  const router = useRouter();
  const [treeOpen, setTreeOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.slice(0, 2).map(g => g.id)));
  const [filter, setFilter] = useState('');

  const openIds = useMemo(() => open.map(o => o.id), [open]);

  /*
   * Every navigation writes the whole desk back to the URL, so the browser's
   * own history is the undo for opening and closing tabs.
   */
  const go = (desk: Desk) => router.push(`/sequences/workspace${writeDesk(desk)}`);

  const desk: Desk = { open: openIds, active: activeId };
  const openFile = (id: string) => go(openTab(desk, id));
  const closeFile = (id: string) => go(closeTab(desk, id));

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => ({ ...g, sequences: g.sequences.filter(s => s.name.toLowerCase().includes(q)) }))
      .filter(g => g.sequences.length > 0);
  }, [groups, filter]);

  const active = open.find(o => o.id === activeId) ?? null;

  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch', height: 'calc(100vh - 120px)', minHeight: 480 }}>

      {/* ── Folder tree ── */}
      {treeOpen ? (
        <aside className="glass-panel" style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '0.6rem', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <Database size={14} style={{ color: 'var(--text-muted)' }} />
            <strong style={{ fontSize: '0.8rem' }}>Project</strong>
            <button onClick={() => setTreeOpen(false)} title="Hide the tree"
              style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
            </button>
          </div>

          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="input-control"
            placeholder="Filter…"
            style={{ fontSize: '0.76rem', padding: '0.25rem 0.45rem', marginBottom: '0.5rem' }}
          />

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {shown.length === 0 && (
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', padding: '0.4rem' }}>Nothing matches.</p>
            )}
            {shown.map(g => {
              const isOpen = expanded.has(g.id) || filter.trim().length > 0;
              return (
                <div key={g.id} style={{ marginBottom: '0.15rem' }}>
                  <button
                    onClick={() => setExpanded(prev => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                      return next;
                    })}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', width: '100%', padding: '0.22rem 0.3rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'inherit', textAlign: 'left' }}
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Folder size={12} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>{g.sequences.length}</span>
                  </button>

                  {isOpen && g.sequences.map(s => {
                    const isOpenTab = openIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => openFile(s.id)}
                        title={`${s.name} — ${s.type}, ${s.size.toLocaleString()} bp`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.35rem', width: '100%',
                          padding: '0.2rem 0.3rem 0.2rem 1.4rem', border: 'none', cursor: 'pointer',
                          fontSize: '0.76rem', fontFamily: 'inherit', textAlign: 'left', borderRadius: 4,
                          background: s.id === activeId ? 'var(--accent-blue-15)' : 'none',
                          color: s.id === activeId ? 'var(--accent-blue)' : 'var(--text-primary)',
                          fontWeight: isOpenTab ? 600 : 400,
                        }}
                      >
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                          background: s.type === 'plasmid' ? 'var(--accent-purple)' : 'var(--accent-green)',
                        }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <Link href="/sequences" style={{ fontSize: '0.74rem', color: 'var(--accent-blue)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Plus size={12} /> Full library
          </Link>
        </aside>
      ) : (
        <button onClick={() => setTreeOpen(true)} title="Show the tree"
          style={{ width: 26, flexShrink: 0, border: '1px solid var(--glass-border)', borderRadius: 8, background: 'white', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <ChevronRight size={14} />
        </button>
      )}

      {/* ── Tabs and the sequence itself ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'stretch', borderBottom: '1px solid var(--glass-border)', overflowX: 'auto', flexShrink: 0 }}>
          {open.map(o => (
            <div key={o.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.5rem 0.35rem 0.75rem',
                borderRadius: '7px 7px 0 0', cursor: 'pointer', whiteSpace: 'nowrap',
                border: '1px solid var(--glass-border)', borderBottom: 'none',
                background: o.id === activeId ? 'white' : 'transparent',
                color: o.id === activeId ? 'var(--accent-blue)' : 'var(--text-muted)',
                fontWeight: o.id === activeId ? 700 : 400, fontSize: '0.8rem',
              }}
              onClick={() => go({ open: openIds, active: o.id })}
            >
              {o.name}
              <button
                onClick={e => { e.stopPropagation(); closeFile(o.id); }}
                aria-label={`Close ${o.name}`}
                style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {open.length === 0 && (
            <span style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Nothing open — pick a sequence from the tree.
            </span>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {active ? (
            /*
             * Only the active tab is mounted. Each viewer scans 570 enzymes
             * over the whole molecule on mount, so keeping eight of them alive
             * to preserve scroll position would cost eight scans for seven
             * views nobody is looking at.
             */
            <SequenceViewer
              key={active.id}
              id={active.id}
              name={active.name}
              sequence={active.sequence}
              size={active.size}
              seqType={active.seqType}
              host={active.host}
              strain={active.strain}
              initialFeatures={active.features}
              initialPrimers={active.primers}
              library={library}
            />
          ) : (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Open a sequence from the tree on the left. Several can be open at once.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
