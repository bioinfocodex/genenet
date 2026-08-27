import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth-guard';
import { searchWorkspace } from '@/lib/search';
import type { ResultKind } from '@/lib/search';
import {
  FlaskConical, Dna, ClipboardList, FolderKanban, CheckSquare,
  FileText, Microscope, Atom, Snowflake, Library, Ruler, Search as SearchIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const ICONS: Record<ResultKind, React.ReactNode> = {
  sample: <FlaskConical size={15} />,
  sequence: <Dna size={15} />,
  procedure: <ClipboardList size={15} />,
  project: <FolderKanban size={15} />,
  task: <CheckSquare size={15} />,
  report: <FileText size={15} />,
  experiment: <Microscope size={15} />,
  protein: <Atom size={15} />,
  freezer: <Snowflake size={15} />,
  collection: <Library size={15} />,
  primer: <Ruler size={15} />,
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  await requireUser();
  const { q = '', all } = await searchParams;
  const results = await searchWorkspace(q);

  // A scanned barcode or a typed sample ID goes straight to the record. ?all=1
  // is how the results page stays reachable when that is not what was wanted.
  if (results.jumpTo && !all) redirect(results.jumpTo.href);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.75rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.8rem' }}>Search</h1>
        {q.trim().length >= 2 ? (
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
            {results.total === 0
              ? <>Nothing matches <strong>{q}</strong>.</>
              : <>{results.total} match{results.total === 1 ? '' : 'es'} for <strong>{q}</strong></>}
          </p>
        ) : (
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
            Search samples, sequences, procedures, projects, tasks, reports and more.
            Type a sample ID such as <code>PLA-001</code> to go straight to it.
          </p>
        )}
      </header>

      {q.trim().length >= 2 && results.total === 0 && (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
          <SearchIcon size={26} style={{ color: 'var(--text-muted)', marginBottom: '0.6rem' }} />
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
            No samples, sequences, procedures, projects, tasks, reports, experiments,
            proteins, freezers, collections or primers match that.
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Searching matches on names, descriptions, notes and identifiers.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {results.groups.map(group => (
          <section key={group.kind} className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
            <h2 style={{
              fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.85rem',
            }}>
              {ICONS[group.kind]} {group.label}
              <span style={{ fontWeight: 500 }}>({group.hits.length})</span>
            </h2>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {group.hits.map(hit => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <Link
                    href={hit.href}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: '0.65rem',
                      padding: '0.55rem 0.65rem', borderRadius: 8,
                      textDecoration: 'none', color: 'inherit',
                    }}
                  >
                    {hit.ref && (
                      <code style={{
                        fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
                        color: hit.exact ? 'var(--accent-green)' : 'var(--text-muted)',
                      }}>
                        {hit.ref}
                      </code>
                    )}
                    <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{hit.title}</span>
                    {hit.subtitle && (
                      <span style={{
                        fontSize: '0.78rem', color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {hit.subtitle}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
