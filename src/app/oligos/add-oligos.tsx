'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ClipboardList } from 'lucide-react';
import { createOligo, importOligos, type ImportOutcome } from '@/app/actions/oligos';

type Mode = 'closed' | 'one' | 'list';

export default function AddOligos() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('closed');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, start] = useTransition();

  if (mode === 'closed') {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button onClick={() => setMode('one')} className="btn btn-primary" style={button}><Plus size={15} /> Add oligo</button>
        <button onClick={() => setMode('list')} className="btn btn-secondary" style={button}><ClipboardList size={15} /> Paste a list</button>
      </div>
    );
  }

  const close = () => { setMode('closed'); setError(null); setOutcome(null); };

  const submitOne = (form: HTMLFormElement) => {
    setError(null);
    start(async () => {
      const r = await createOligo(new FormData(form));
      if ('error' in r) { setError(r.error); return; }
      router.push(`/oligos/${r.id}`);
    });
  };

  const submitList = (form: HTMLFormElement) => {
    setError(null);
    start(async () => {
      const r = await importOligos(new FormData(form));
      if ('error' in r) { setError(r.error); return; }
      setOutcome(r);
      router.refresh();
    });
  };

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.25rem', width: 420, flexShrink: 0 }}>
      {mode === 'one' ? (
        <form onSubmit={e => { e.preventDefault(); submitOne(e.currentTarget); }} style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>New oligo</div>
          <Field label="Name"><input name="name" required className="input-control" style={input} placeholder="M13 forward" /></Field>
          <Field label="Sequence 5′→3′">
            <textarea name="sequence" required className="input-control" style={{ ...input, fontFamily: 'monospace', minHeight: 60 }} placeholder="GTAAAACGACGGCCAGT" />
          </Field>
          <Field label="Modifications"><input name="modifications" className="input-control" style={input} placeholder="5′ phosphate, HPLC" /></Field>
          <Field label="Location"><input name="location" className="input-control" style={input} placeholder="Oligo box 2, C4" /></Field>
          <Field label="Notes"><input name="notes" className="input-control" style={input} /></Field>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={close} className="btn btn-secondary" style={button}>Cancel</button>
            <button disabled={pending} className="btn btn-primary" style={button}>{pending ? 'Saving…' : 'Add to collection'}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); submitList(e.currentTarget); }} style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Paste a list</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
            One per line: name, then sequence, separated by a tab, comma or space. A third column is kept as notes.
            Copying two columns out of a spreadsheet works as it is. Sequences already in the collection are skipped.
          </p>
          <textarea name="list" required className="input-control" style={{ ...input, fontFamily: 'monospace', minHeight: 140 }} placeholder={'M13F\tGTAAAACGACGGCCAGT\nT7\tTAATACGACTCACTATAGGG'} />
          {error && <div style={errorStyle}>{error}</div>}
          {outcome && (
            <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ color: 'var(--accent-green)' }}>
                Added {outcome.added.length}{outcome.added.length ? `: ${outcome.added.map(a => a.code).join(', ')}` : ''}
              </div>
              {outcome.skipped.map(s => (
                <div key={s.name} style={{ color: 'var(--text-muted)' }}>Skipped {s.name}: same sequence as {s.existing}</div>
              ))}
              {outcome.problems.map(p => (
                <div key={p.line} style={{ color: '#b91c1c' }}>Line {p.line}: {p.message}</div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={close} className="btn btn-secondary" style={button}>{outcome ? 'Done' : 'Cancel'}</button>
            <button disabled={pending} className="btn btn-primary" style={button}>{pending ? 'Adding…' : 'Add all'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const button: React.CSSProperties = { fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' };
const input: React.CSSProperties = { padding: '0.45rem 0.65rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' };
const errorStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#b91c1c' };
