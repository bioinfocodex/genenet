'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import type { SequenceFeature } from '@/lib/features';
import { codingChanges, isCoding, readingOrder, type Effect } from '@/lib/point-mutation';
import {
  q5Primers, quikChangePrimers, codonSwap, kindOf, validateMutation,
  type Mutation, type MutagenesisDesign, type MutagenicPrimer,
} from '@/lib/mutagenesis-primers';
import { replaceRange, insertBases } from '@/lib/edit';
import { saveConstruct } from '@/app/actions/sequences';

/**
 * Design the primers for a site-directed change, and see what it does.
 *
 * The change can be asked for the way people think of it -- residue 45 of
 * this gene to alanine -- or as bases: a substitution, an insertion or a
 * deletion. Either way it ends as one replacement on the top strand, which the
 * primer designers and the protein reading both work from.
 */

type Mode = 'aa' | 'substitution' | 'insertion' | 'deletion';
type Method = 'q5' | 'quikchange';

const AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY*'.split('');

const EFFECT_LABEL: Record<Effect, string> = {
  silent: 'silent', missense: 'missense', nonsense: 'nonsense', 'stop-loss': 'stop lost', 'start-loss': 'start lost',
};

export interface NewPrimer { name: string; sequence: string; direction: 'forward' | 'reverse'; notes: string }

export default function MutagenesisPanel({
  sequenceId, sequenceName, sequence, circular, selection, features, onSavePrimers,
}: {
  sequenceId: string;
  sequenceName: string;
  sequence: string;
  circular: boolean;
  selection: { start: number; end: number } | null;
  features: SequenceFeature[];
  onSavePrimers: (primers: NewPrimer[]) => void;
}) {
  const cdsList = useMemo(() => features.filter(f => isCoding(f.type)), [features]);
  const [mode, setMode] = useState<Mode>(cdsList.length ? 'aa' : 'substitution');
  const [method, setMethod] = useState<Method>(circular ? 'q5' : 'quikchange');

  const [cdsId, setCdsId] = useState(cdsList[0]?.id ?? '');
  const [residue, setResidue] = useState(2);
  const [targetAA, setTargetAA] = useState('A');

  const [start, setStart] = useState(selection?.start ?? 1);
  const [end, setEnd] = useState(selection?.end ?? selection?.start ?? 1);
  const [bases, setBases] = useState('');

  const [saved, setSaved] = useState<string | null>(null);
  const [mutantSaved, setMutantSaved] = useState<{ id: string; features: number } | { error: string } | null>(null);
  const [pending, start_] = useTransition();

  // Everything below derives from one Mutation.
  const plan = useMemo((): { mutation: Mutation; label: string } | { error: string } => {
    try {
      if (mode === 'aa') {
        const cds = cdsList.find(f => f.id === cdsId);
        if (!cds) return { error: 'This sequence has no annotated CDS; describe the change as bases instead.' };
        const swap = codonSwap(sequence, cds, residue, targetAA);
        return { mutation: swap.mutation, label: `${cds.name} ${swap.notation} (${swap.originalCodon} → ${swap.newCodon})` };
      }
      const m: Mutation =
        mode === 'substitution' ? { start, end, replacement: bases }
        : mode === 'insertion' ? { start, end: start - 1, replacement: bases }
        : { start, end, replacement: '' };
      const problem = validateMutation(sequence, m);
      if (problem) return { error: problem };
      return { mutation: m, label: describe(m, sequence) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [mode, cdsList, cdsId, residue, targetAA, start, end, bases, sequence]);

  const design = useMemo((): MutagenesisDesign | { error: string } | null => {
    if ('error' in plan) return null;
    try {
      return method === 'q5'
        ? q5Primers(sequence, circular, plan.mutation)
        : quikChangePrimers(sequence, circular, plan.mutation);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [plan, method, sequence, circular]);

  // What it does to any protein it touches.
  const proteinNotes = useMemo(() => {
    if ('error' in plan) return [];
    const m = plan.mutation;
    const out: string[] = [];
    const net = m.replacement.length - Math.max(0, m.end - m.start + 1);
    for (const cds of cdsList) {
      const order = readingOrder(cds);
      const touched = order.some(p => p >= m.start && p <= Math.max(m.end, m.start));
      if (!touched) continue;
      if (net % 3 !== 0) {
        out.push(`${cds.name}: shifts the reading frame (${net > 0 ? '+' : ''}${net} bp). Everything downstream of the change is a different protein.`);
      } else if (net !== 0) {
        out.push(`${cds.name}: ${Math.abs(net / 3)} residue${Math.abs(net) === 3 ? '' : 's'} ${net > 0 ? 'added' : 'removed'}, frame kept.`);
      }
    }
    if (kindOf(m) === 'substitution' && m.replacement.length === 1) {
      for (const c of codingChanges(sequence, cdsList, m.start, m.replacement)) {
        out.push(`${c.feature}: ${c.notation} (${EFFECT_LABEL[c.effect]}, ${c.originalCodon} → ${c.mutantCodon})`);
      }
    }
    return out;
  }, [plan, cdsList, sequence]);

  const ready = design && !('error' in design) ? design : null;

  const primerNotes = ready ? `${ready.method === 'q5' ? 'Q5 SDM' : 'QuikChange'}: ${'label' in plan ? plan.label : ''}` : '';

  const savePrimers = () => {
    if (!ready) return;
    onSavePrimers([
      { name: ready.forward.name, sequence: ready.forward.sequence, direction: 'forward', notes: primerNotes },
      { name: ready.reverse.name, sequence: ready.reverse.sequence, direction: 'reverse', notes: primerNotes },
    ]);
    setSaved('Saved to this sequence’s primers.');
  };

  const saveMutant = () => {
    if (!ready || 'error' in plan) return;
    const m = plan.mutation;
    // Move the annotations with the change, so the mutant's map is right.
    const edited = m.end >= m.start
      ? replaceRange(sequence, features, m.start, m.end, m.replacement)
      : insertBases(sequence, features, m.start - 1, m.replacement);
    start_(async () => {
      const fd = new FormData();
      fd.append('name', `${sequenceName} ${'label' in plan ? shortLabel(plan.label) : 'mutant'}`);
      fd.append('sequence', edited.sequence);
      fd.append('method', 'site-directed mutagenesis');
      fd.append('topology', circular ? 'circular' : 'linear');
      fd.append('parents', JSON.stringify([{ id: sequenceId, name: sequenceName }]));
      fd.append('features', JSON.stringify(edited.features));
      setMutantSaved(await saveConstruct(fd));
    });
  };

  return (
    <div>
      <div style={{ marginBottom: '0.9rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Site-Directed Mutagenesis</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Describe the change and get the primers to order. Q5 uses two back-to-back primers and suits insertions and
          deletions of any size; QuikChange uses two complementary primers with the change in the middle.
        </p>
      </div>

      <Segmented
        value={mode}
        onChange={v => { setMode(v); setSaved(null); setMutantSaved(null); }}
        options={[
          ...(cdsList.length ? [['aa', 'Amino acid'] as const] : []),
          ['substitution', 'Substitute'], ['insertion', 'Insert'], ['deletion', 'Delete'],
        ]}
      />

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '0.75rem 0' }}>
        {mode === 'aa' && <>
          <Field label="Gene">
            <select value={cdsId} onChange={e => setCdsId(e.target.value)} className="input-control" style={input}>
              {cdsList.map(f => <option key={f.id} value={f.id}>{f.name}{f.strand === -1 ? ' (−)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Residue"><input type="number" min={1} value={residue} onChange={e => setResidue(parseInt(e.target.value) || 1)} className="input-control" style={{ ...input, width: 80 }} /></Field>
          <Field label="Change to">
            <select value={targetAA} onChange={e => setTargetAA(e.target.value)} className="input-control" style={input}>
              {AMINO_ACIDS.map(a => <option key={a} value={a}>{a === '*' ? 'stop (*)' : a}</option>)}
            </select>
          </Field>
        </>}
        {mode !== 'aa' && <>
          <Field label={mode === 'insertion' ? 'Insert before base' : 'From base'}>
            <input type="number" min={1} max={sequence.length} value={start} onChange={e => setStart(parseInt(e.target.value) || 1)} className="input-control" style={{ ...input, width: 100 }} />
          </Field>
          {mode !== 'insertion' && (
            <Field label="To base">
              <input type="number" min={1} max={sequence.length} value={end} onChange={e => setEnd(parseInt(e.target.value) || 1)} className="input-control" style={{ ...input, width: 100 }} />
            </Field>
          )}
          {mode !== 'deletion' && (
            <Field label={mode === 'insertion' ? 'Bases to insert' : 'New bases'}>
              <input value={bases} onChange={e => setBases(e.target.value.toUpperCase().replace(/[^ACGT]/g, ''))} className="input-control" style={{ ...input, width: 200, fontFamily: 'monospace' }} placeholder="e.g. GCT" />
            </Field>
          )}
        </>}
        <Field label="Method">
          <select value={method} onChange={e => setMethod(e.target.value as Method)} className="input-control" style={input}>
            <option value="q5" disabled={!circular}>Q5 SDM (NEB){circular ? '' : ' — needs a plasmid'}</option>
            <option value="quikchange">QuikChange (Agilent)</option>
          </select>
        </Field>
      </div>

      {'error' in plan ? (
        <Message tone="muted">{plan.error}</Message>
      ) : (
        <>
          <div style={{ fontSize: '0.82rem', marginBottom: '0.4rem' }}><strong>{plan.label}</strong></div>
          {proteinNotes.map(n => <div key={n} style={{ fontSize: '0.8rem', color: /shifts/.test(n) ? '#b91c1c' : 'var(--text-secondary)' }}>{n}</div>)}
          {mode !== 'aa' && proteinNotes.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Not inside an annotated CDS.</div>
          )}
        </>
      )}

      {design && 'error' in design && <Message tone="error">{design.error}</Message>}

      {ready && (
        <div style={{ marginTop: '0.85rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>{['Primer', 'Sequence 5′→3′', 'Length', ready.method === 'q5' ? 'Anneal Tm' : 'Tm (Agilent)'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--glass-border)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {[ready.forward, ready.reverse].map(p => (
                <tr key={p.name} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <td style={cell}>{p.name}</td>
                  <td style={{ ...cell, fontFamily: 'monospace', wordBreak: 'break-all' }}><Highlighted primer={p} /></td>
                  <td style={cell}>{p.sequence.length} nt</td>
                  <td style={cell}>{p.tm}°C</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            {ready.kind === 'deletion' ? 'The deleted bases are on neither primer.' : 'Red bases are the change.'} {ready.method === 'q5' ? 'Tm is for the bases that anneal 3′ of it, in a standard PCR buffer.' : ''} Suggested annealing: <strong>{ready.annealingTemp} °C</strong>.
          </div>
          {[...ready.notes].map(n => <div key={n} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{n}</div>)}
          {ready.warnings.map(w => <Message key={w} tone="warn">{w}</Message>)}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" style={{ fontSize: '0.8rem' }} onClick={savePrimers}>Save primers to this sequence</button>
            <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={saveMutant} disabled={pending}>
              {pending ? 'Saving…' : 'Save the mutant as a new sequence'}
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={() => navigator.clipboard.writeText(`${ready.forward.name}\t${ready.forward.sequence}\n${ready.reverse.name}\t${ready.reverse.sequence}`)}
            >
              <Copy size={13} /> Copy for ordering
            </button>
          </div>
          {saved && <div style={{ fontSize: '0.78rem', color: 'var(--accent-green)', marginTop: '0.35rem' }}>{saved}</div>}
          {mutantSaved && ('error' in mutantSaved
            ? <Message tone="error">{mutantSaved.error}</Message>
            : <div style={{ fontSize: '0.78rem', color: 'var(--accent-green)', marginTop: '0.35rem' }}>
                Saved with {mutantSaved.features} annotation{mutantSaved.features === 1 ? '' : 's'} carried over. <Link href={`/sequences/${mutantSaved.id}`}>Open the mutant →</Link>
              </div>)}
        </div>
      )}
    </div>
  );
}

function describe(m: Mutation, sequence: string): string {
  const kind = kindOf(m);
  if (kind === 'deletion') return `Delete ${m.start}–${m.end} (${m.end - m.start + 1} bp)`;
  if (kind === 'insertion') return `Insert ${m.replacement} (${m.replacement.length} bp) before ${m.start}`;
  const old = sequence.slice(m.start - 1, m.end).toUpperCase();
  return m.start === m.end ? `${old}${m.start}${m.replacement}` : `${m.start}–${m.end}: ${old} → ${m.replacement}`;
}

/** The notation part of a label, for naming the saved mutant. */
function shortLabel(label: string): string {
  const aa = label.match(/\b[A-Z*]\d+[A-Z*]\b/);
  return aa ? aa[0] : label.split(' (')[0];
}

function Highlighted({ primer }: { primer: MutagenicPrimer }) {
  const [a, b] = primer.changed;
  const s = primer.sequence;
  return <>{s.slice(0, a)}<span style={{ color: '#dc2626', fontWeight: 800 }}>{s.slice(a, b)}</span>{s.slice(b)}</>;
}

function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[];
}) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={value === v ? 'btn btn-primary' : 'btn btn-secondary'} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
  );
}

function Message({ tone, children }: { tone: 'warn' | 'error' | 'muted'; children: React.ReactNode }) {
  const c = tone === 'error' ? '#b91c1c' : tone === 'warn' ? 'var(--accent-orange)' : 'var(--text-muted)';
  return <div style={{ fontSize: '0.8rem', color: c, marginTop: '0.3rem' }}>{tone === 'warn' ? '⚠ ' : ''}{children}</div>;
}

const input: React.CSSProperties = { padding: '0.35rem 0.5rem', fontSize: '0.82rem' };
const cell: React.CSSProperties = { padding: '0.35rem 0.5rem', verticalAlign: 'top' };
