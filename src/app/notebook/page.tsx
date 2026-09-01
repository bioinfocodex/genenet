import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { NotebookPen, Lock, CheckCheck } from 'lucide-react';
import { excerpt } from '@/lib/notebook';
import NewEntry from './new-entry';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, { colour: string; label: string }> = {
  DRAFT: { colour: 'var(--text-muted)', label: 'Draft' },
  SIGNED: { colour: 'var(--accent-blue)', label: 'Signed' },
  WITNESSED: { colour: 'var(--accent-green)', label: 'Witnessed' },
};

export default async function NotebookPage() {
  await requireUser();

  const [entries, projects] = await Promise.all([
    prisma.notebookEntry.findMany({
      include: {
        author: { select: { name: true } },
        project: { select: { id: true, name: true } },
        supersedes: { select: { id: true, title: true } },
        _count: { select: { links: true, supersededBy: true } },
      },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <NotebookPen size={26} /> Notebook
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
          Procedures describe what was planned. An entry records what happened, dated to the day of
          the work rather than the day it was typed. Once signed it stops being editable &mdash; a
          signature over content that can still change is not a signature &mdash; and corrections are
          made as a new entry that supersedes it, with both left readable.
        </p>
      </div>

      <NewEntry projects={projects} />

      {entries.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', marginTop: '1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>No entries yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '1.5rem' }}>
          {entries.map(e => {
            const s = STATUS_STYLE[e.status] ?? STATUS_STYLE.DRAFT;
            return (
              <Link key={e.id} href={`/notebook/${e.id}`} className="glass-panel" style={{
                padding: '1.1rem 1.35rem', textDecoration: 'none', color: 'inherit', display: 'block',
                borderLeft: `3px solid ${s.colour}`,
                opacity: e._count.supersededBy > 0 ? 0.72 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.96rem' }}>{e.title}</strong>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase', color: s.colour,
                    display: 'flex', alignItems: 'center', gap: '0.25rem',
                  }}>
                    {e.status === 'SIGNED' && <Lock size={11} />}
                    {e.status === 'WITNESSED' && <CheckCheck size={12} />}
                    {s.label}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {e.entryDate.toLocaleDateString()} &middot; {e.author.name}
                  {e.project && <> &middot; {e.project.name}</>}
                  {e._count.links > 0 && <> &middot; {e._count.links} link{e._count.links === 1 ? '' : 's'}</>}
                </div>
                {e.body && (
                  <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0', lineHeight: 1.55 }}>
                    {excerpt(e.body)}
                  </p>
                )}
                {e.supersedes && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
                    Corrects &ldquo;{e.supersedes.title}&rdquo;
                  </div>
                )}
                {e._count.supersededBy > 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#a3560a', marginTop: '0.45rem' }}>
                    Superseded by a later correction.
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
