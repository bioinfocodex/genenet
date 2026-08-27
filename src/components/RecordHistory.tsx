'use client';
import { useState } from 'react';
import { History, Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { HistoryEntry } from '@/lib/history-types';

type Props = { entries: HistoryEntry[] };

function when(d: Date | string): string {
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const VERB: Record<string, string> = {
  create: 'created this record',
  update: 'edited this record',
  delete: 'deleted this record',
};

function Icon({ action }: { action: string }) {
  const common = { size: 14, style: { flexShrink: 0, marginTop: 3 } as React.CSSProperties };
  if (action === 'create') return <Plus {...common} style={{ ...common.style, color: 'var(--accent-green)' }} />;
  if (action === 'delete') return <Trash2 {...common} style={{ ...common.style, color: 'var(--accent-red)' }} />;
  return <Pencil {...common} style={{ ...common.style, color: 'var(--accent-blue)' }} />;
}

export default function RecordHistory({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const edits = entries.filter(e => e.action === 'update' && !e.trivial).length;

  return (
    <section style={{
      border: '1px solid var(--glass-border)', borderRadius: 12,
      background: 'var(--bg-secondary)', padding: '1.25rem', marginTop: '1.5rem',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
          color: 'inherit', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <History size={16} style={{ color: 'var(--accent-purple)' }} />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, flex: 1 }}>History</h2>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {entries.length === 0
            ? 'no recorded changes'
            : `${edits} edit${edits === 1 ? '' : 's'}`}
        </span>
      </button>

      {open && (
        entries.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.9rem 0 0' }}>
            Nothing recorded. Changes made from now on are listed here with what
            they changed, who changed it and when.
          </p>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            {entries.map(e => (
              <li key={e.id} style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                <Icon action={e.action} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem' }}>
                    <strong style={{ fontWeight: 600 }}>{e.actorName}</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{VERB[e.action] ?? e.action}</span>
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {when(e.at)}
                  </div>

                  {e.changes.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.45rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {e.changes.map(c => (
                        <li key={c.field} style={{
                          fontSize: '0.78rem', lineHeight: 1.5,
                          borderLeft: '2px solid var(--glass-border)', paddingLeft: '0.6rem',
                        }}>
                          <span style={{ color: 'var(--text-muted)' }}>{c.field}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginTop: '0.1rem' }}>
                            <span style={{ color: 'var(--accent-red)', textDecoration: 'line-through', wordBreak: 'break-word' }}>
                              {c.from ?? <em style={{ textDecoration: 'none', opacity: 0.7 }}>empty</em>}
                            </span>
                            <span style={{ color: 'var(--accent-green)', wordBreak: 'break-word' }}>
                              {c.to ?? <em style={{ opacity: 0.7 }}>empty</em>}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {e.trivial && (
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                      Nothing about the content changed.
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  );
}
