'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Upload, Download, Check, X, Pencil } from 'lucide-react';
import { previewSampleImport, commitSampleImport } from '@/app/actions/samples';
import { sampleTemplate, describeSample, type ImportedSample } from '@/lib/sample-import';
import type { Plan } from '@/lib/csv';

/**
 * Importing a box of tubes from the spreadsheet it already lives in.
 *
 * The file is read and shown before anything is written, line by line, with
 * the line numbers of the spreadsheet so a rejected row can be found in it.
 * An import that reports "47 rows imported" afterwards is one nobody can
 * check; this one can be read before it happens and argued with.
 */
export default function ImportClient() {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<Plan<ImportedSample> | null>(null);
  const [unknownFreezers, setUnknownFreezers] = useState<string[]>([]);
  const [done, setDone] = useState<{ created: number; updated: number; rejected: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const read = (raw: string) => {
    setText(raw); setPlan(null); setDone(null); setError(null);
  };

  const preview = () => start(async () => {
    setError(null);
    const fd = new FormData();
    fd.append('text', text);
    const r = await previewSampleImport(fd);
    if ('error' in r) { setError(r.error!); return; }
    setPlan(r.plan!);
    setUnknownFreezers(r.unknownFreezers ?? []);
  });

  const commit = () => start(async () => {
    const fd = new FormData();
    fd.append('text', text);
    const r = await commitSampleImport(fd);
    if ('error' in r) { setError(r.error!); return; }
    setDone({ created: r.created!, updated: r.updated!, rejected: r.rejected! });
    setPlan(null);
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>Import samples</h1>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                onClick={() => download('sample-template.csv', sampleTemplate())}>
          <Download size={13} /> Template
        </button>
        <Link href="/samples" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>← Samples</Link>
      </div>

      <div className="glass-panel" style={{ padding: '1.1rem 1.35rem' }}>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          A CSV from Excel, Numbers or Google Sheets. Commas, semicolons and tabs are all read, and the
          columns are matched by name — a sheet with <code>Sample ID</code>, <code>sample_id</code> or
          <code> Tube</code> all work. Nothing is written until the preview has been read.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" style={{ fontSize: '0.82rem' }}
                 onChange={async e => {
                   const f = e.target.files?.[0];
                   if (f) read(await f.text());
                 }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>or paste below</span>
        </div>

        <textarea
          value={text}
          onChange={e => read(e.target.value)}
          placeholder={'Sample ID,Name,Type,Freezer,Box,Position,Amount,Concentration\nPLA-001,pEGFP-N1,Plasmid,Minus 20,B2,A1,50 uL,200 ng/uL'}
          spellCheck={false}
          style={{
            width: '100%', minHeight: 150, fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.78rem', padding: '0.6rem', borderRadius: 8,
            border: '1px solid var(--glass-border)', resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }}
                  disabled={pending || !text.trim()} onClick={preview}>
            {pending && !plan ? 'Reading…' : 'Read the file'}
          </button>
          {plan && plan.counts.create + plan.counts.update > 0 && (
            <button className="btn btn-primary" style={{ fontSize: '0.82rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                    disabled={pending} onClick={commit}>
              <Upload size={14} />
              Import {plan.counts.create + plan.counts.update} row{plan.counts.create + plan.counts.update === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {error && <p style={{ fontSize: '0.82rem', color: '#b91c1c' }}>{error}</p>}

        {done && (
          <p style={{ fontSize: '0.86rem', marginTop: '0.9rem' }}>
            <Check size={14} style={{ verticalAlign: '-2px', color: '#15803d' }} />{' '}
            {done.created} created, {done.updated} updated
            {done.rejected > 0 && `, ${done.rejected} left out`}.{' '}
            <Link href="/samples">Open the inventory</Link>
          </p>
        )}
      </div>

      {plan && <Preview plan={plan} unknownFreezers={unknownFreezers} />}
    </div>
  );
}

function Preview({ plan, unknownFreezers }: { plan: Plan<ImportedSample>; unknownFreezers: string[] }) {
  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '0.6rem' }}>
        <Tally n={plan.counts.create} label="to create" tone="#15803d" />
        <Tally n={plan.counts.update} label="to update" tone="#1d4ed8" />
        <Tally n={plan.counts.reject} label="left out" tone="#b91c1c" />
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          read as {plan.delimiter === '\t' ? 'tab' : plan.delimiter === ';' ? 'semicolon' : plan.delimiter === '|' ? 'pipe' : 'comma'}-separated
        </span>
      </div>

      {plan.missing.length > 0 && (
        <Note tone="bad">The file has no {plan.missing.map(m => m.label).join(' or ')} column, so nothing can be read from it.</Note>
      )}
      {plan.unmatched.length > 0 && (
        <Note tone="warn">
          Nothing reads {plan.unmatched.map(u => `"${u}"`).join(', ')}. If that column matters, rename it to one of the
          names in the template.
        </Note>
      )}
      {plan.ragged.length > 0 && (
        <Note tone="warn">
          {plan.ragged.length} row{plan.ragged.length === 1 ? '' : 's'} ha{plan.ragged.length === 1 ? 's' : 've'} a
          different number of columns from the header (line{plan.ragged.length === 1 ? '' : 's'}{' '}
          {plan.ragged.slice(0, 5).map(r => r.line).join(', ')}
          {plan.ragged.length > 5 && ' and more'}). That is usually an unquoted comma inside a field.
        </Note>
      )}
      {unknownFreezers.length > 0 && (
        <Note tone="warn">
          No freezer called {unknownFreezers.map(f => `"${f}"`).join(', ')}. Those tubes will be filed without one.
        </Note>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '0.5rem' }}>
        <thead>
          <tr>
            {['Line', '', 'Code', 'What it is', 'Notes'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--glass-border)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plan.rows.map(row => (
            <tr key={row.line} style={{ borderBottom: '1px solid var(--glass-border)', opacity: row.verdict === 'reject' ? 0.75 : 1 }}>
              <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{row.line}</td>
              <td style={cell}><Verdict verdict={row.verdict} /></td>
              <td style={{ ...cell, fontFamily: 'monospace' }}>{row.key ?? <span style={{ color: 'var(--text-muted)' }}>new</span>}</td>
              <td style={cell}>{row.value ? describeSample(row.value) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
              <td style={{ ...cell, color: row.verdict === 'reject' ? '#b91c1c' : 'var(--text-muted)' }}>{row.notes.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Verdict({ verdict }: { verdict: 'create' | 'update' | 'reject' }) {
  if (verdict === 'create') return <Check size={13} style={{ color: '#15803d' }} />;
  if (verdict === 'update') return <Pencil size={13} style={{ color: '#1d4ed8' }} />;
  return <X size={13} style={{ color: '#b91c1c' }} />;
}

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span style={{ fontSize: '0.86rem' }}>
      <strong style={{ color: tone, fontSize: '1.1rem' }}>{n}</strong>{' '}
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </span>
  );
}

function Note({ tone, children }: { tone: 'bad' | 'warn'; children: React.ReactNode }) {
  return <p style={{ fontSize: '0.8rem', color: tone === 'bad' ? '#b91c1c' : '#a3560a', margin: '0.3rem 0' }}>{children}</p>;
}

function download(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const cell: React.CSSProperties = { padding: '0.3rem 0.5rem', verticalAlign: 'top' };
