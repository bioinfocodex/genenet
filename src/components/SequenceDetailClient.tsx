'use client';
import React, { useState, useMemo, useTransition } from 'react';
import { Beaker, Dna, Scissors, Plus, Trash2, FlaskConical, Layers, Copy, CheckCheck } from 'lucide-react';
import {
  reverseComplement, calcGC, calcTm,
  simulatePCR, ligateFragments,
  LADDER_1KB, gelPosition,
  type PCRResult, type LigationResult,
} from '@/lib/simulation';
import { ENZYMES, findCutSites } from '@/lib/restrictionEnzymes';
import { addPrimer, deletePrimer, saveSimulation } from '@/app/actions/sequences';
import type { SequenceFeature } from './SequenceViewer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Primer {
  id: string;
  name: string;
  sequence: string;
  direction: string;
  tm: number | null;
  gcContent: number | null;
  notes: string | null;
}

interface ReSite {
  enzyme: string;
  cutPos: number;
  recognitionStart: number;
  recognitionLen: number;
  overhang: string;
  overhangType: string;
  color: string;
}

interface GeneSequenceData {
  id: string;
  name: string;
  sequence: string;
  size: number;
  type: string;
  description: string | null;
  tags: string | null;
  features: string | null;
  primers: Primer[];
}

type Tab = 'overview' | 'sequence' | 'primers' | 'pcr' | 'ligation';

const RE_COLORS = ['#ef4444','#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#f97316','#ec4899','#84cc16','#78716c'];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SequenceDetailClient({ seq }: { seq: GeneSequenceData }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

  const allReSites = useMemo((): ReSite[] => {
    const sites: ReSite[] = [];
    Object.values(ENZYMES).forEach((enzyme, i) => {
      findCutSites(seq.sequence, enzyme).forEach(cutPos => {
        sites.push({
          enzyme: enzyme.name,
          cutPos,
          recognitionStart: cutPos - enzyme.cutBefore,
          recognitionLen: enzyme.pattern.length,
          overhang: enzyme.overhang || 'blunt',
          overhangType: enzyme.overhangType,
          color: RE_COLORS[i % RE_COLORS.length],
        });
      });
    });
    return sites.sort((a, b) => a.cutPos - b.cutPos);
  }, [seq.sequence]);

  const reSitesByEnzyme = useMemo(() => {
    const map = new Map<string, ReSite[]>();
    allReSites.forEach(s => {
      if (!map.has(s.enzyme)) map.set(s.enzyme, []);
      map.get(s.enzyme)!.push(s);
    });
    return map;
  }, [allReSites]);

  let parsedFeatures: SequenceFeature[] = [];
  try { parsedFeatures = JSON.parse(seq.features ?? '[]'); } catch { parsedFeatures = []; }

  const tabs: [Tab, string, React.ReactNode][] = [
    ['overview',  'Overview',  <Dna key="o" size={14} />],
    ['sequence',  'Sequence',  <Layers key="s" size={14} />],
    ['primers',   'Primers',   <Beaker key="p" size={14} />],
    ['pcr',       'PCR Sim',   <FlaskConical key="r" size={14} />],
    ['ligation',  'Ligation',  <Scissors key="l" size={14} />],
  ];

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        {tabs.map(([t, label, icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.55rem 1.1rem', border: 'none', background: 'none',
              cursor: 'pointer', fontSize: '0.85rem',
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? 'var(--accent-blue)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t ? 'var(--accent-blue)' : 'transparent'}`,
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'overview'  && <OverviewTab seq={seq} reSitesByEnzyme={reSitesByEnzyme} allReSites={allReSites} features={parsedFeatures} selection={selection} onSelect={setSelection} />}
      {tab === 'sequence'  && <SequenceTab sequence={seq.sequence} features={parsedFeatures} reSites={allReSites} />}
      {tab === 'primers'   && <PrimersTab seq={seq} />}
      {tab === 'pcr'       && <PCRTab seq={seq} />}
      {tab === 'ligation'  && <LigationTab seq={seq} />}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ seq, reSitesByEnzyme, allReSites, features, selection, onSelect }: {
  seq: GeneSequenceData;
  reSitesByEnzyme: Map<string, ReSite[]>;
  allReSites: ReSite[];
  features: SequenceFeature[];
  selection: { start: number; end: number } | null;
  onSelect: (s: { start: number; end: number } | null) => void;
}) {
  const gc = calcGC(seq.sequence);
  const uniqueCutters = [...reSitesByEnzyme.entries()].filter(([, s]) => s.length === 1);
  const len = seq.sequence.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Length', value: `${len.toLocaleString()} bp` },
          { label: 'GC Content', value: `${gc}%` },
          { label: 'Type', value: seq.type === 'plasmid' ? 'Circular plasmid' : 'Linear gene' },
          { label: 'RE enzymes', value: `${reSitesByEnzyme.size} with sites` },
          { label: 'Unique cutters', value: `${uniqueCutters.length}` },
          { label: 'Features', value: `${features.length}` },
          { label: 'Primers', value: `${seq.primers.length}` },
        ].map(({ label, value }) => (
          <div key={label} className="glass-panel" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>{label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Linear map */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
          Sequence Map 
          {selection && (
            <span style={{ marginLeft: '1rem', color: 'var(--accent-blue)', textTransform: 'none' }}>
              ({selection.start.toLocaleString()} – {selection.end.toLocaleString()} bp · {selection.end - selection.start + 1} bp)
            </span>
          )}
        </h3>
        <LinearMapSVG 
          sequence={seq.sequence} 
          features={features} 
          reSites={allReSites} 
          isCircular={seq.type === 'plasmid'} 
          selection={selection} 
          onSelect={onSelect} 
        />
      </div>
    </div>
  );
}

// ─── Sequence Tab ─────────────────────────────────────────────────────────────

function SequenceTab({ sequence, features, reSites }: { sequence: string; features: SequenceFeature[]; reSites: ReSite[] }) {
  const BASES_PER_LINE = 60;
  const GROUP = 10;
  const [copied, setCopied] = useState(false);

  const rc = reverseComplement(sequence);

  const charStyle = useMemo(() => {
    const style: ({ bg: string; border?: string } | null)[] = new Array(sequence.length).fill(null);
    reSites.forEach(s => {
      const start = Math.max(0, s.recognitionStart);
      const end = Math.min(sequence.length, s.recognitionStart + s.recognitionLen);
      for (let i = start; i < end; i++) {
        if (!style[i]) style[i] = { bg: '#fef08a', border: '#ca8a04' };
      }
    });
    features.forEach(feat => {
      for (let i = feat.start - 1; i < feat.end && i < sequence.length; i++) {
        style[i] = { bg: feat.color + '33', border: feat.color };
      }
    });
    return style;
  }, [sequence, features, reSites]);

  const lines = [];
  for (let i = 0; i < sequence.length; i += BASES_PER_LINE) {
    lines.push({ start: i, text: sequence.substring(i, i + BASES_PER_LINE) });
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(sequence);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleCopy} className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {copied ? <><CheckCheck size={13} /> Copied!</> : <><Copy size={13} /> Copy sequence</>}
        </button>
        <button onClick={() => navigator.clipboard.writeText(rc)} className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Copy size={13} /> Copy RC
        </button>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          GC: {calcGC(sequence)}% &nbsp;·&nbsp; {sequence.length.toLocaleString()} bp
        </span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 12, height: 10, background: '#fef08a', border: '1px solid #ca8a04', display: 'inline-block', borderRadius: '1px' }} />
          RE recognition
        </span>
        {features.map(f => (
          <span key={f.id} style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
            <span style={{ width: 12, height: 10, background: f.color + '33', border: `1px solid ${f.color}`, display: 'inline-block', borderRadius: '1px' }} />
            {f.name}
          </span>
        ))}
      </div>

      {/* Sequence display */}
      <div style={{ fontFamily: 'monospace', fontSize: '0.76rem', lineHeight: 1.9, overflowX: 'auto', background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
        {lines.map(({ start, text }) => (
          <div key={start} style={{ display: 'flex', gap: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 52, textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>{start + 1}</span>
            <div>
              {Array.from({ length: Math.ceil(text.length / GROUP) }, (_, gi) => {
                const gStart = gi * GROUP;
                const group = text.substring(gStart, gStart + GROUP);
                return (
                  <span key={gi} style={{ marginRight: '0.45rem' }}>
                    {group.split('').map((base, bi) => {
                      const abs = start + gStart + bi;
                      const s = charStyle[abs];
                      return (
                        <span key={bi} style={{ background: s?.bg ?? 'transparent', borderBottom: s?.border ? `2px solid ${s.border}` : 'none', padding: '0 0.5px', borderRadius: '1px' }}>
                          {base}
                        </span>
                      );
                    })}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Primers Tab ──────────────────────────────────────────────────────────────

function PrimersTab({ seq }: { seq: GeneSequenceData }) {
  const [primers, setPrimers] = useState<Primer[]>(seq.primers);
  const [name, setName] = useState('');
  const [primerSeq, setPrimerSeq] = useState('');
  const [direction, setDirection] = useState('forward');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  const previewTm = primerSeq ? calcTm(primerSeq.toUpperCase().replace(/[^ACGT]/g, '')) : null;
  const previewGC = primerSeq ? calcGC(primerSeq.toUpperCase().replace(/[^ACGT]/g, '')) : null;

  const handleAdd = () => {
    if (!name || !primerSeq) return;
    const fd = new FormData();
    fd.append('geneSequenceId', seq.id);
    fd.append('name', name);
    fd.append('sequence', primerSeq);
    fd.append('direction', direction);
    fd.append('notes', notes);
    startTransition(async () => {
      await addPrimer(fd);
      // Optimistic update
      const clean = primerSeq.toUpperCase().replace(/[^ACGT]/g, '');
      setPrimers(prev => [...prev, {
        id: `tmp-${Date.now()}`,
        name, sequence: clean, direction,
        tm: calcTm(clean), gcContent: calcGC(clean),
        notes: notes || null,
      }]);
      setName(''); setPrimerSeq(''); setNotes('');
    });
  };

  const handleDelete = (id: string, geneSequenceId: string) => {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('geneSequenceId', geneSequenceId);
    startTransition(async () => {
      await deletePrimer(fd);
      setPrimers(prev => prev.filter(p => p.id !== id));
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Add primer */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>Add Primer</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. GFP-F" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Sequence
              {primerSeq && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)' }}>Tm: {previewTm}°C · GC: {previewGC}%</span>}
            </label>
            <input
              value={primerSeq}
              onChange={e => setPrimerSeq(e.target.value)}
              className="input-control"
              style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace' }}
              placeholder="ATGGTGAGCAAGGGCGAG…"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Direction</label>
            <select value={direction} onChange={e => setDirection(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.5rem', fontSize: '0.82rem' }}>
              <option value="forward">Forward</option>
              <option value="reverse">Reverse</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. adds XhoI site" />
          </div>
          <button className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '0.45rem 1.2rem' }} onClick={handleAdd} disabled={!name || !primerSeq || isPending}>
            <Plus size={14} style={{ marginRight: '0.3rem' }} /> Add
          </button>
        </div>
      </div>

      {/* Primer list */}
      {primers.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Beaker size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <p style={{ fontSize: '0.9rem' }}>No primers yet. Add one above.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['Name', 'Direction', 'Sequence', 'Length', 'Tm (°C)', 'GC%', 'Notes', ''].map(h => (
                  <th key={h} style={{ padding: '0.6rem 0.9rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {primers.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: i < primers.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                  <td style={{ padding: '0.65rem 0.9rem', fontWeight: 600, fontSize: '0.88rem' }}>{p.name}</td>
                  <td style={{ padding: '0.65rem 0.9rem' }}>
                    <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600, background: p.direction === 'forward' ? 'rgba(5,150,105,0.1)' : 'rgba(139,92,246,0.1)', color: p.direction === 'forward' ? 'var(--accent-green)' : 'var(--accent-purple)' }}>
                      {p.direction === 'forward' ? '→ Fwd' : '← Rev'}
                    </span>
                  </td>
                  <td style={{ padding: '0.65rem 0.9rem', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.sequence}</td>
                  <td style={{ padding: '0.65rem 0.9rem', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.sequence.length} bp</td>
                  <td style={{ padding: '0.65rem 0.9rem', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--accent-blue)' }}>{p.tm ?? '—'}</td>
                  <td style={{ padding: '0.65rem 0.9rem', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.gcContent ?? '—'}</td>
                  <td style={{ padding: '0.65rem 0.9rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.notes ?? '—'}</td>
                  <td style={{ padding: '0.65rem 0.9rem' }}>
                    <button onClick={() => handleDelete(p.id, seq.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PCR Simulation Tab ───────────────────────────────────────────────────────

function PCRTab({ seq }: { seq: GeneSequenceData }) {
  const [fwdSeq, setFwdSeq] = useState('');
  const [revSeq, setRevSeq] = useState('');
  const [result, setResult] = useState<PCRResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const fwdPrimers = seq.primers.filter(p => p.direction === 'forward');
  const revPrimers = seq.primers.filter(p => p.direction === 'reverse');

  const runPCR = () => {
    const r = simulatePCR(seq.sequence, fwdSeq, revSeq);
    setResult(r);
    setSaved(false);
  };

  const handleSave = () => {
    if (!result) return;
    const fd = new FormData();
    fd.append('type', 'PCR');
    fd.append('name', `PCR on ${seq.name}`);
    fd.append('inputData', JSON.stringify({ template: seq.id, fwd: fwdSeq, rev: revSeq }));
    fd.append('outputData', JSON.stringify(result));
    fd.append('geneSequenceId', seq.id);
    startTransition(async () => {
      await saveSimulation(fd);
      setSaved(true);
    });
  };

  const bands = result?.success ? [{ size: result.size, label: `${result.size} bp (amplicon)`, color: 'var(--accent-blue)' }] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Inputs */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>PCR Parameters</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <PrimerInput label="Forward Primer (5'→3')" value={fwdSeq} onChange={setFwdSeq} suggestions={fwdPrimers} />
          <PrimerInput label="Reverse Primer (5'→3')" value={revSeq} onChange={setRevSeq} suggestions={revPrimers} />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={runPCR} disabled={!fwdSeq || !revSeq} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FlaskConical size={14} /> Run PCR
          </button>
          {result && !saved && (
            <button className="btn btn-secondary" onClick={handleSave} disabled={isPending} style={{ fontSize: '0.82rem' }}>
              {isPending ? 'Saving…' : '💾 Save simulation'}
            </button>
          )}
          {saved && <span style={{ fontSize: '0.82rem', color: 'var(--accent-green)' }}>✓ Saved</span>}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* Gel */}
          <div className="glass-panel" style={{ padding: '1rem', width: 140 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>Gel</div>
            <GelLane bands={bands} />
          </div>

          {/* Info */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: result.success ? 'var(--accent-green)' : 'var(--accent-red)', display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: '0.92rem', color: result.success ? 'var(--accent-green)' : 'var(--accent-red)' }}>{result.message}</span>
            </div>
            {result.success && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '2rem' }}>
                  <Stat label="Amplicon size" value={`${result.size} bp`} />
                  <Stat label="Fwd binding" value={`pos ${result.fwdPos + 1}`} />
                  <Stat label="Rev binding" value={`pos ${result.revPos + 1}`} />
                  <Stat label="GC%" value={`${calcGC(result.product)}%`} />
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase' }}>Product sequence</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: 'white', border: '1px solid var(--glass-border)', padding: '0.6rem 0.9rem', borderRadius: '6px', overflowX: 'auto', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    {result.product.length > 120 ? result.product.slice(0, 60) + '…' + result.product.slice(-60) : result.product}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ligation Tab ─────────────────────────────────────────────────────────────

function LigationTab({ seq }: { seq: GeneSequenceData }) {
  const [insertSeq, setInsertSeq] = useState('');
  const [insertName, setInsertName] = useState('insert');
  const [result, setResult] = useState<LigationResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const runLigation = () => {
    const r = ligateFragments(seq.sequence, insertSeq);
    setResult(r);
    setSaved(false);
  };

  const handleSave = () => {
    if (!result) return;
    const fd = new FormData();
    fd.append('type', 'LIGATION');
    fd.append('name', `${insertName} → ${seq.name}`);
    fd.append('inputData', JSON.stringify({ vector: seq.id, insert: insertName, insertSeq: insertSeq.slice(0, 200) }));
    fd.append('outputData', JSON.stringify(result));
    fd.append('geneSequenceId', seq.id);
    startTransition(async () => {
      await saveSimulation(fd);
      setSaved(true);
    });
  };

  const bands = result?.success ? [{ size: result.size, label: `${result.size} bp (construct)`, color: 'var(--accent-purple)' }] : [];
  const vectorBand = [{ size: seq.size, label: `${seq.size} bp (vector)`, color: 'var(--accent-blue)' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>Ligation (simple concatenation)</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>VECTOR</span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--accent-blue)' }}>{seq.name}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{seq.size.toLocaleString()} bp</span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Insert name</label>
              <input value={insertName} onChange={e => setInsertName(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', width: '100%' }} placeholder="insert" />
            </div>
            <div style={{ flex: 3 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                Insert sequence
                {insertSeq && <span style={{ marginLeft: '0.4rem', color: 'var(--accent-blue)' }}>{insertSeq.replace(/[^ACGT]/gi,'').length} bp</span>}
              </label>
              <input value={insertSeq} onChange={e => setInsertSeq(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace', width: '100%' }} placeholder="Paste insert sequence…" />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={runLigation} disabled={!insertSeq} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Scissors size={14} /> Ligate
          </button>
          {result && !saved && (
            <button className="btn btn-secondary" onClick={handleSave} disabled={isPending} style={{ fontSize: '0.82rem' }}>
              {isPending ? 'Saving…' : '💾 Save simulation'}
            </button>
          )}
          {saved && <span style={{ fontSize: '0.82rem', color: 'var(--accent-green)' }}>✓ Saved</span>}
        </div>
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* Multi-lane gel */}
          <div className="glass-panel" style={{ padding: '1rem', width: 200 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>Gel</div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <LabeledLane label="Ladder" bands={LADDER_1KB.map(s => ({ size: s, label: `${s >= 1000 ? s/1000 + 'k' : s}`, color: '#94a3b8' }))} isLadder />
              <LabeledLane label="Vector" bands={vectorBand} />
              <LabeledLane label="Construct" bands={bands} />
            </div>
          </div>

          {/* Info */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: result.success ? 'var(--accent-green)' : 'var(--accent-red)', display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: '0.92rem', color: result.success ? 'var(--accent-green)' : 'var(--accent-red)' }}>{result.message}</span>
            </div>
            {result.success && (
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                <Stat label="Construct size" value={`${result.size} bp`} />
                <Stat label="Vector" value={`${seq.size} bp`} />
                <Stat label="Insert" value={`${insertSeq.replace(/[^ACGT]/gi,'').length} bp`} />
                <Stat label="GC%" value={`${calcGC(result.product)}%`} />
                <Stat label="Form" value="Circular plasmid" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Primer Input with suggestion dropdown ────────────────────────────────────

function PrimerInput({ label, value, onChange, suggestions }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: Primer[];
}) {
  const tm = value ? calcTm(value.toUpperCase().replace(/[^ACGT]/g, '')) : null;
  const gc = value ? calcGC(value.toUpperCase().replace(/[^ACGT]/g, '')) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {label}
        {tm !== null && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)' }}>Tm: {tm}°C · GC: {gc}%</span>}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input-control"
        style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace' }}
        placeholder="ACGTACGT…"
        list={`primers-${label}`}
      />
      {suggestions.length > 0 && (
        <datalist id={`primers-${label}`}>
          {suggestions.map(p => <option key={p.id} value={p.sequence} label={p.name} />)}
        </datalist>
      )}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {suggestions.map(p => (
            <button key={p.id} onClick={() => onChange(p.sequence)} style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', color: 'var(--text-muted)' }}>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Gel Lane ─────────────────────────────────────────────────────────────────

function GelLane({ bands }: { bands: { size: number; label: string; color: string }[] }) {
  const GEL_H = 300;
  const LANE_W = 60;
  const ladderBands = LADDER_1KB.map(s => ({ size: s, color: '#94a3b8' }));

  return (
    <svg width={LANE_W * 2 + 20} height={GEL_H + 24} style={{ display: 'block' }}>
      {/* Ladder lane */}
      {ladderBands.map((b, i) => {
        const y = gelPosition(b.size) * GEL_H + 4;
        return (
          <g key={i}>
            <rect x={4} y={y - 2} width={LANE_W - 8} height={4} fill={b.color} opacity={0.5} rx={1} />
            <text x={LANE_W - 2} y={y + 1} fontSize={6} fill="#94a3b8" textAnchor="end" dominantBaseline="middle">
              {b.size >= 1000 ? `${b.size / 1000}k` : b.size}
            </text>
          </g>
        );
      })}
      {/* Sample lane */}
      {bands.map((b, i) => {
        const y = gelPosition(b.size) * GEL_H + 4;
        return (
          <g key={i}>
            <rect x={LANE_W + 8} y={y - 3} width={LANE_W - 12} height={6} fill={b.color} opacity={0.9} rx={1} />
            <text x={LANE_W + 8 + (LANE_W - 12) / 2} y={y + 12} fontSize={7} fill={b.color} textAnchor="middle">{b.size} bp</text>
          </g>
        );
      })}
    </svg>
  );
}

function LabeledLane({ label, bands, isLadder = false }: { label: string; bands: { size: number; label: string; color: string }[]; isLadder?: boolean }) {
  const GEL_H = 240;
  const LANE_W = 44;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
      <svg width={LANE_W} height={GEL_H + 4} style={{ display: 'block' }}>
        {bands.map((b, i) => {
          const y = gelPosition(b.size) * GEL_H + 2;
          return (
            <g key={i}>
              <rect x={4} y={y - 2} width={LANE_W - 8} height={isLadder ? 3 : 5} fill={b.color} opacity={isLadder ? 0.5 : 0.9} rx={1} />
              {isLadder && (
                <text x={2} y={y} fontSize={6} fill="#94a3b8" dominantBaseline="middle">{b.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Linear Map SVG ───────────────────────────────────────────────────────────

function assignRows(features: SequenceFeature[]): Map<string, number> {
  const sorted = [...features].sort((a, b) => a.start - b.start);
  const rowEnds: number[] = [];
  const map = new Map<string, number>();
  for (const f of sorted) {
    let row = rowEnds.findIndex(e => e < f.start);
    if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = f.end;
    map.set(f.id, row);
  }
  return map;
}

function LinearMapSVG({ sequence, features, reSites, isCircular, selection, onSelect }: { 
  sequence: string; 
  features: SequenceFeature[]; 
  reSites: ReSite[]; 
  isCircular: boolean;
  selection?: { start: number; end: number } | null;
  onSelect?: (s: { start: number; end: number } | null) => void;
}) {
  const len = sequence.length;
  const W = 680;
  const padL = 20; const padR = 40;
  const mapW = W - padL - padR;
  const toX = (pos: number) => padL + (pos / len) * mapW;
  const fromX = (x: number) => Math.round(Math.max(0, Math.min(len, ((x - padL) / mapW) * len)));

  const [dragStart, setDragStart] = React.useState<number | null>(null);

  const featureRows = assignRows(features);
  const maxRow = features.length > 0 ? Math.max(...featureRows.values()) + 1 : 0;
  const featH = maxRow * 24;
  const bbY = featH + (featH > 0 ? 15 : 10);
  const svgH = bbY + 30 + 40;

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const bp = fromX(x);
    setDragStart(bp);
    onSelect?.({ start: bp, end: bp });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStart === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const bp = fromX(x);
    onSelect?.({ start: Math.min(dragStart, bp), end: Math.max(dragStart, bp) });
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg 
        width={W} height={svgH} 
        style={{ display: 'block', minWidth: W, cursor: 'text', userSelect: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragStart(null)}
        onMouseLeave={() => setDragStart(null)}
      >
        {/* Selection overlay */}
        {selection && (
          <rect 
            x={toX(selection.start)} 
            y={0} 
            width={toX(selection.end) - toX(selection.start)} 
            height={svgH} 
            fill="var(--accent-blue-15)" 
            opacity={0.3} 
          />
        )}

        {features.map(feat => {
          const row = featureRows.get(feat.id) ?? 0;
          const y = 8 + row * 24;
          const x1 = toX(feat.start - 1);
          const x2 = toX(feat.end);
          const w = Math.max(x2 - x1, 4);
          const arrowW = Math.min(8, w * 0.3);
          return (
            <g key={feat.id}>
              {feat.strand === 1
                ? <path d={`M${x1},${y} L${x2 - arrowW},${y} L${x2},${y + 9} L${x2 - arrowW},${y + 18} L${x1},${y + 18} Z`} fill={feat.color} opacity={0.88} />
                : <path d={`M${x1 + arrowW},${y} L${x2},${y} L${x2},${y + 18} L${x1 + arrowW},${y + 18} L${x1},${y + 9} Z`} fill={feat.color} opacity={0.88} />}
              {w > 30 && (
                <text x={x1 + w / 2} y={y + 12} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="white" fontWeight="600">
                  {feat.name.length > Math.floor(w / 6) ? feat.name.slice(0, Math.floor(w / 6) - 1) + '…' : feat.name}
                </text>
              )}
            </g>
          );
        })}

        <rect x={padL} y={bbY} width={mapW} height={8} fill="#e2e8f0" rx={2} />
        <rect x={padL} y={bbY} width={mapW} height={2} fill="#94a3b8" rx={1} transform={`translate(0, 3)`} />
        
        {isCircular && <text x={padL + mapW + 8} y={bbY + 7} fontSize={12} fill="#94a3b8">↺</text>}

        {/* RE Sites with labels */}
        {reSites.map((s, i) => {
          const x = toX(s.cutPos);
          // Alternate label heights to avoid overlap
          const labelY = (i % 2 === 0) ? bbY + 22 : bbY + 34;
          return (
            <g key={i}>
              <line x1={x} y1={bbY - 8} x2={x} y2={bbY + 16} stroke={s.color} strokeWidth={1.5} opacity={0.8} />
              <text 
                x={x} y={labelY} 
                fontSize={9} fill={s.color} fontWeight="700" 
                textAnchor="middle"
              >
                {s.enzyme}
              </text>
            </g>
          );
        })}

        {/* Ruler */}
        {Array.from({ length: 11 }, (_, i) => {
          const pos = Math.round((i / 10) * len);
          const x = toX(pos);
          return (
            <g key={i}>
              <line x1={x} y1={bbY + 10} x2={x} y2={bbY + 14} stroke="#94a3b8" strokeWidth={1} />
              <text x={x} y={bbY - 14} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="monospace">
                {pos >= 1000 ? `${(pos / 1000).toFixed(1)}k` : pos}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
