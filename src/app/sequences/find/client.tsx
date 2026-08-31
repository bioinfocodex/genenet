'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ScanSearch, CheckCircle2 } from 'lucide-react';
import { buildIndex, searchLibrary, type LibrarySequence, type Hit } from '@/lib/library-search';

/**
 * "Do we already have this?"
 *
 * The answer people want is a name, not a table, so a near-identical
 * full-length match is stated in a sentence at the top. Everything else is a
 * list of where the query turns up, which is the other real question: what else
 * in the freezer carries this promoter.
 */
export default function FindClient({ sequences }: { sequences: LibrarySequence[] }) {
  const [query, setQuery] = useState('');
  const [minIdentity, setMinIdentity] = useState(0.9);
  const [ran, setRan] = useState(false);
  const [result, setResult] = useState<{ hits: Hit[]; alreadyHave?: { id: string; name: string; identity: number; coverage: number } } | null>(null);

  // Built once for the whole library and reused for every search: indexing is
  // the expensive half, and doing it per keystroke would be the obvious way to
  // make a fast search feel slow.
  const index = useMemo(() => buildIndex(sequences), [sequences]);

  const clean = query.toUpperCase().replace(/[^ACGTN]/g, '');

  const run = () => {
    setRan(true);
    setResult(clean.length >= 11 ? searchLibrary(index, clean, { minIdentity }) : { hits: [] });
  };

  return (
    <>
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <label style={{
          display: 'block', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem',
        }}>
          Query
        </label>
        <textarea
          value={query}
          onChange={e => { setQuery(e.target.value); setRan(false); }}
          placeholder="Paste a gene, a promoter, a fragment — FASTA headers are ignored"
          style={{
            width: '100%', height: 130, fontFamily: 'monospace', fontSize: '0.75rem',
            padding: '0.7rem', border: '1px solid var(--glass-border)', borderRadius: 8,
            background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.45rem 0 0.9rem' }}>
          {clean.length.toLocaleString()} bp &middot; searching {sequences.length} sequence{sequences.length === 1 ? '' : 's'}
          {index.masked > 0 && ` · ${index.masked} repetitive k-mers masked`}
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            Minimum identity
            <select
              value={minIdentity}
              onChange={e => { setMinIdentity(Number(e.target.value)); setRan(false); }}
              className="input-control"
              style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
            >
              <option value={0.8}>80%</option>
              <option value={0.9}>90%</option>
              <option value={0.95}>95%</option>
              <option value={1}>exact</option>
            </select>
          </label>
          <button onClick={run} disabled={clean.length < 11} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ScanSearch size={15} /> Search
          </button>
        </div>
      </div>

      {result?.alreadyHave && (
        <div className="glass-panel" style={{
          padding: '1.2rem 1.4rem', marginBottom: '1rem',
          border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <CheckCircle2 size={17} color="var(--accent-green)" />
            <strong style={{ fontSize: '0.95rem' }}>You already have this.</strong>
          </div>
          <p style={{ fontSize: '0.86rem', margin: 0, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            <Link href={`/sequences/${result.alreadyHave.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
              {result.alreadyHave.name}
            </Link>
            {' '}matches {(result.alreadyHave.identity * 100).toFixed(1)}% across{' '}
            {(result.alreadyHave.coverage * 100).toFixed(0)}% of what you pasted.
          </p>
        </div>
      )}

      {ran && result && result.hits.length === 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.88rem', margin: 0, lineHeight: 1.6 }}>
            {clean.length < 11
              ? 'Paste at least 11 bases — shorter than that and a match means nothing.'
              : 'No match in the library at this identity. Lowering it to 80% is worth a try before concluding it is new.'}
          </p>
        </div>
      )}

      {result && result.hits.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', margin: '0 0 0.85rem' }}>
            {result.hits.length} hit{result.hits.length === 1 ? '' : 's'}
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.78rem', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Sequence', 'Query', 'Subject', 'Strand', 'Length', 'Identity'].map(h => (
                    <th key={h} style={{
                      textAlign: ['Length', 'Identity'].includes(h) ? 'right' : 'left',
                      padding: '0.3rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600,
                      fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                      borderBottom: '1px solid var(--glass-border)', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.hits.map((h, i) => (
                  <tr key={i}>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <Link href={`/sequences/${h.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                        {h.name}
                      </Link>
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {h.queryStart.toLocaleString()}&ndash;{h.queryEnd.toLocaleString()}
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {h.subjectStart.toLocaleString()}&ndash;{h.subjectEnd.toLocaleString()}
                      {h.wrapsOrigin && (
                        <span style={{ color: 'var(--text-muted)' }} title="runs through position 1 of the circle"> &#8635;</span>
                      )}
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace' }}>{h.strand}</td>
                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {h.length.toLocaleString()}
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {(h.identity * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.85rem 0 0', lineHeight: 1.55 }}>
            Matches are extended without gaps, so a hit spanning an insertion appears as two segments
            on the same sequence with contiguous subject coordinates. There is no E-value: that number
            describes the odds of a chance hit in a database of a given size, and it would not mean
            anything for a library of {sequences.length}.
          </p>
        </div>
      )}
    </>
  );
}
