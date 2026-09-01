import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { NotebookPen } from 'lucide-react';
import { verifyEntry, canEdit, canWitness, type EntryStatus } from '@/lib/notebook';
import EntryClient from './client';

export const dynamic = 'force-dynamic';

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const entry = await prisma.notebookEntry.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      signedBy: { select: { name: true } },
      witnessedBy: { select: { name: true } },
      project: { select: { id: true, name: true } },
      links: true,
      supersedes: { select: { id: true, title: true } },
      supersededBy: { select: { id: true, title: true } },
    },
  });
  if (!entry) notFound();

  const [projects, signatures] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.signature.findMany({
      where: { model: 'NotebookEntry', recordId: id },
      orderBy: { at: 'asc' },
    }),
  ]);

  const status = entry.status as EntryStatus;
  const verification = verifyEntry({
    title: entry.title, body: entry.body, entryDate: entry.entryDate,
    contentHash: entry.contentHash, status,
  });
  const editable = canEdit({ status, authorId: entry.authorId }, user.id, user.role);
  const witnessable = canWitness(
    { status, authorId: entry.authorId, signedById: entry.signedById }, user.id,
  );

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <Link href="/notebook" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>&larr; Notebook</Link>
        <h1 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem', marginBottom: '0.2rem' }}>
          <NotebookPen size={20} /> {entry.title}
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          {entry.entryDate.toLocaleDateString()} &middot; {entry.author.name}
          {entry.project && <> &middot; <Link href={`/projects/${entry.project.id}`} style={{ color: 'var(--accent-blue)' }}>{entry.project.name}</Link></>}
        </p>
      </div>

      {entry.supersedes && (
        <div className="glass-panel" style={{ padding: '0.85rem 1.2rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.84rem', margin: 0, color: 'var(--text-secondary)' }}>
            This corrects{' '}
            <Link href={`/notebook/${entry.supersedes.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
              {entry.supersedes.title}
            </Link>
            , which remains readable.
          </p>
        </div>
      )}
      {entry.supersededBy.length > 0 && (
        <div className="glass-panel" style={{
          padding: '0.85rem 1.2rem', marginBottom: '1rem',
          border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.05)',
        }}>
          <p style={{ fontSize: '0.84rem', margin: 0, color: 'var(--text-secondary)' }}>
            Superseded by{' '}
            {entry.supersededBy.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ', '}
                <Link href={`/notebook/${s.id}`} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{s.title}</Link>
              </span>
            ))}
            . Read that before relying on this one.
          </p>
        </div>
      )}

      <EntryClient
        entry={{
          id: entry.id, title: entry.title, body: entry.body,
          entryDate: entry.entryDate.toISOString().slice(0, 10),
          projectId: entry.projectId, status,
        }}
        projects={projects}
        editable={editable}
        witnessable={witnessable}
        isAuthor={entry.authorId === user.id}
        verification={verification}
        links={entry.links}
        signatures={signatures.map(s => ({
          id: s.id, meaning: s.meaning, signerName: s.signerName,
          at: s.at.toLocaleString(), note: s.note,
        }))}
        signedByName={entry.signedBy?.name ?? null}
        witnessedByName={entry.witnessedBy?.name ?? null}
      />
    </div>
  );
}
