'use client';
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { ENZYMES } from '@/lib/restrictionEnzymes';
import type { ReSite } from './LinearMap';

interface EnzymePickerProps {
  /** Every enzyme with at least one site on this sequence, and where it cuts. */
  sitesByEnzyme: Map<string, ReSite[]>;
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Tighter, for a toolbar rather than a panel. */
  compact?: boolean;
}

/**
 * Choosing enzymes by name.
 *
 * The map had a set filter, a cut-count limit and a site-length limit, which
 * between them answer "show me the sites worth cloning into" — a good default
 * and not the only question. "Where does BamHI cut" had no answer anywhere in
 * the application: the Sites panel listed it, and no view could be pointed at
 * it.
 *
 * Only enzymes that actually cut this sequence are offered. A picker over all
 * 570 would let someone choose an enzyme, see nothing appear, and have no way
 * to tell whether the site was absent or the display was broken.
 */
export default function EnzymePicker({ sitesByEnzyme, picked, onChange, compact }: EnzymePickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const cutters = useMemo(() => {
    return [...sitesByEnzyme.entries()]
      .map(([name, sites]) => ({
        name,
        cuts: sites.length,
        pattern: ENZYMES[name]?.pattern ?? '',
      }))
      // Unique cutters first: on a plasmid they are the ones someone is
      // usually looking for, and a name-ordered list buries them.
      .sort((a, b) => a.cuts - b.cuts || a.name.localeCompare(b.name));
  }, [sitesByEnzyme]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = cutters.filter(c => !picked.has(c.name));
    if (!q) return pool.slice(0, 12);
    // Name first, then recognition sequence, so typing GAATTC finds EcoRI.
    return pool
      .filter(c => c.name.toLowerCase().includes(q) || c.pattern.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.cuts - b.cuts || a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [cutters, query, picked]);

  /*
   * Clamped at use rather than reset in an effect. The list shrinks as the
   * query narrows, so the stored index can outrun it; resetting from an
   * effect would cascade a second render on every keystroke to fix something
   * a single Math.min already handles.
   */
  const active = matches.length ? Math.min(highlight, matches.length - 1) : 0;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const add = (name: string) => {
    const next = new Set(picked);
    next.add(name);
    onChange(next);
    setQuery('');
  };

  const remove = (name: string) => {
    const next = new Set(picked);
    next.delete(name);
    onChange(next);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(matches.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); add(matches[active].name); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Backspace' && !query && picked.size) {
      // Backspace on an empty box removes the last chip, as every tag input does.
      remove([...picked][picked.size - 1]);
    }
  };

  const fs = compact ? '0.72rem' : '0.78rem';

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
      {[...picked].map(name => {
        const cuts = sitesByEnzyme.get(name)?.length ?? 0;
        const colour = sitesByEnzyme.get(name)?.[0]?.color ?? 'var(--accent-blue)';
        return (
          <span
            key={name}
            title={cuts === 0
              ? `${name} does not cut this sequence`
              : `${name} cuts ${cuts} time${cuts === 1 ? '' : 's'}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.12rem 0.3rem 0.12rem 0.45rem', borderRadius: 6, fontSize: fs,
              fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
              background: `${colour}1a`, color: colour, border: `1px solid ${colour}55`,
            }}
          >
            {name}
            <span style={{ fontWeight: 500, opacity: 0.75 }}>{cuts}×</span>
            <button
              onClick={() => remove(name)}
              aria-label={`Stop showing ${name}`}
              style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}
            >
              <X size={11} />
            </button>
          </span>
        );
      })}

      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setHighlight(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        className="input-control"
        placeholder={picked.size ? 'add…' : 'Show an enzyme…'}
        style={{ fontSize: fs, padding: '0.22rem 0.45rem', width: picked.size ? 96 : 150 }}
        title="Name or recognition sequence. Only enzymes that cut this sequence are listed."
      />

      {picked.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          style={{ fontSize: fs, padding: '0.2rem 0.45rem', borderRadius: 6, border: '1px solid var(--glass-border)', background: 'white', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
          title="Back to the sites the filters choose"
        >
          Clear
        </button>
      )}

      {open && matches.length > 0 && (
        <ul
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4,
            listStyle: 'none', padding: '0.25rem', margin: 0, minWidth: 240, maxHeight: 260,
            overflowY: 'auto', background: 'white', borderRadius: 8,
            border: '1px solid var(--glass-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {matches.map((m, i) => (
            <li key={m.name}>
              <button
                onMouseEnter={() => setHighlight(i)}
                // On mousedown, not click: the input keeps focus, so several
                // enzymes can be added without reaching for it again, and the
                // choice cannot be lost to a blur landing between the two.
                onMouseDown={e => { e.preventDefault(); add(m.name); }}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: '0.5rem', width: '100%',
                  padding: '0.28rem 0.45rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                  background: i === active ? 'var(--accent-blue-15)' : 'transparent',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '0.78rem', minWidth: 74 }}>{m.name}</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--accent-blue)' }}>{m.pattern}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: '0.7rem',
                  color: m.cuts === 1 ? 'var(--accent-green)' : 'var(--text-muted)',
                  fontWeight: m.cuts === 1 ? 700 : 400,
                }}>
                  {m.cuts === 1 ? 'unique' : `${m.cuts} cuts`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
