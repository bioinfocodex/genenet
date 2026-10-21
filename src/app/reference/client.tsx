'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReferenceVector, StandardPrimer } from '@/lib/reference-content';
import { importReferenceVectors, addStandardPrimers, type ReferenceStatus, type VectorImport } from '@/app/actions/reference';

export default function ReferenceClient({ vectors, primers, status }: {
  vectors: ReferenceVector[];
  primers: StandardPrimer[];
  status: ReferenceStatus;
}) {
  const router = useRouter();
  const missing = vectors.filter(v => !status.vectors[v.accession]).map(v => v.accession);
  const [picked, setPicked] = useState<string[]>(missing);
  const [result, setResult] = useState<VectorImport | null>(null);
  const [primerResult, setPrimerResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const missingPrimers = primers.filter(p => !status.primers[p.name]);

  const importVectors = () => start(async () => {
    setResult(await importReferenceVectors(picked));
    router.refresh();
  });
  const importPrimers = () => start(async () => {
    const r = await addStandardPrimers();
    setPrimerResult(r.added.length ? `Added ${r.added.length}: ${r.added.map(a => a.code).join(', ')}` : 'All already in the collection.');
    router.refresh();
  });

  return (
    <>
      <section className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Vectors ({vectors.length - missing.length} of {vectors.length} in the library)</h2>
          {missing.length > 0 && (
            <button className="btn btn-primary" style={{ fontSize: '0.84rem' }} disabled={pending || picked.length === 0} onClick={importVectors}>
              {pending ? `Fetching from GenBank…` : `Import ${picked.length} from GenBank`}
            </button>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
          <tbody>
            {vectors.map(v => {
              const id = status.vectors[v.accession];
              return (
                <tr key={v.accession} style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <td style={cell}>
                    {id ? '✓' : (
                      <input type="checkbox" checked={picked.includes(v.accession)}
                        onChange={e => setPicked(p => e.target.checked ? [...p, v.accession] : p.filter(a => a !== v.accession))} />
                    )}
                  </td>
                  <td style={{ ...cell, fontWeight: 600 }}>{id ? <Link href={`/sequences/${id}`}>{v.name}</Link> : v.name}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{v.use}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>
                    <a href={`https://www.ncbi.nlm.nih.gov/nuccore/${v.accession}`} target="_blank" rel="noreferrer">{v.accession}</a>
                  </td>
                  <td style={{ ...cell, color: 'var(--text-muted)', fontSize: '0.76rem' }}>{v.note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {result && (
          <div style={{ fontSize: '0.8rem', marginTop: '0.6rem' }}>
            {result.imported.length > 0 && (
              <div style={{ color: 'var(--accent-green)' }}>
                {`Imported ${result.imported.length}; ${result.imported.reduce((n, i) => n + i.detected, 0)} features added by auto-annotation where the GenBank record had none. Filed in the “Reference vectors” collection.`}
              </div>
            )}
            {result.failed.map(f => <div key={f.accession} style={{ color: '#b91c1c' }}>{f.accession}: {f.error}</div>)}
          </div>
        )}
      </section>

      <section className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Universal primers ({primers.length - missingPrimers.length} of {primers.length} in the oligo collection)</h2>
          {missingPrimers.length > 0 && (
            <button className="btn btn-primary" style={{ fontSize: '0.84rem' }} disabled={pending} onClick={importPrimers}>
              Add {missingPrimers.length} to the oligo collection
            </button>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <tbody>
            {primers.map(p => (
              <tr key={p.name} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ ...cell, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.name}</td>
                <td style={{ ...cell, fontFamily: 'monospace' }}>{p.sequence}</td>
                <td style={{ ...cell, color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                  {p.verifiedOn.map(a => vectors.find(v => v.accession === a)?.name ?? a).join(', ')}
                </td>
                <td style={{ ...cell, fontFamily: 'monospace', color: 'var(--accent-green)' }}>{status.primers[p.name] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {primerResult && <div style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginTop: '0.5rem' }}>{primerResult}</div>}
      </section>
    </>
  );
}

const cell: React.CSSProperties = { padding: '0.4rem 0.5rem', verticalAlign: 'top' };
