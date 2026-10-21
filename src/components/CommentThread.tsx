'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Trash2, AtSign } from 'lucide-react';
import { segments, type Person } from '@/lib/mentions';
import { addComment, deleteComment } from '@/app/actions/comments';

/**
 * The argument about a record, kept next to the record.
 *
 * Dropped onto a page with its kind and id; everything else is the same
 * everywhere, which is the point. A thread that looks different on a construct
 * from how it looks on a plate is two features to learn.
 */

export interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export default function CommentThread({
  kind, targetId, label, comments, people, me,
}: {
  kind: string;
  targetId: string;
  /** The record's name, stored with the comment so it still reads if deleted. */
  label: string;
  comments: CommentRow[];
  /** Everybody who can be mentioned. */
  people: Person[];
  me: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /*
   * Who this comment would tell, worked out as it is typed.
   *
   * Shown before it is posted, because "@Jane" that matches nobody looks
   * exactly like one that does, and finding out that a question reached
   * nobody takes as long as waiting for an answer.
   */
  const willTell = segments(body, people)
    .filter((s): s is { kind: 'mention'; text: string; person: Person } => s.kind === 'mention')
    .map(s => s.person)
    .filter((p, i, all) => all.findIndex(x => x.id === p.id) === i && p.id !== me);

  const post = () => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('targetId', targetId);
      fd.append('label', label);
      fd.append('body', body);
      const r = await addComment(fd);
      if ('error' in r) { setError(r.error!); return; }
      setBody('');
      router.refresh();
    });
  };

  return (
    <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.75rem' }}>
        <MessageSquare size={16} />
        <h2 style={{ fontSize: '0.95rem', margin: 0 }}>
          Comments
          {comments.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {comments.length}</span>}
        </h2>
      </div>

      {comments.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
          Nothing yet. Name somebody with @ to tell them.
        </p>
      )}

      {comments.map(c => (
        <div key={c.id} style={{ borderTop: '1px solid var(--glass-border)', padding: '0.6rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
            <strong style={{ fontSize: '0.84rem' }}>{c.authorName}</strong>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {new Date(c.createdAt).toLocaleString()}
            </span>
            <span style={{ flex: 1 }} />
            {c.authorId === me && (
              <button
                title="Remove this comment"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                disabled={pending}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('id', c.id);
                  await deleteComment(fd);
                  router.refresh();
                })}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <p style={{ fontSize: '0.86rem', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {segments(c.body, people).map((s, i) => (
              s.kind === 'mention'
                ? (
                  <span key={i} style={{
                    color: 'var(--accent-blue)', fontWeight: 600,
                    background: 'var(--accent-blue-15, rgba(37,99,235,0.1))',
                    borderRadius: 4, padding: '0 0.15rem',
                  }}>
                    {s.text}
                  </span>
                )
                : <span key={i}>{s.text}</span>
            ))}
          </p>
        </div>
      ))}

      <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What is worth saying about this? Name somebody with @ to tell them."
          rows={3}
          style={{
            width: '100%', fontSize: '0.86rem', padding: '0.5rem 0.6rem', borderRadius: 8,
            border: '1px solid var(--glass-border)', resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
                  disabled={pending || !body.trim()} onClick={post}>
            {pending ? 'Posting…' : 'Post'}
          </button>
          {willTell.length > 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <AtSign size={12} /> tells {willTell.map(p => p.name).join(', ')}
            </span>
          )}
          {body.includes('@') && willTell.length === 0 && (
            <span style={{ fontSize: '0.78rem', color: '#a3560a' }}>
              No name here matches anybody, so this tells nobody.
            </span>
          )}
        </div>
        {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '0.4rem 0 0' }}>{error}</p>}
      </div>
    </div>
  );
}

/** For a page that wants the thread's own link, e.g. from a notification. */
export function CommentLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} style={{ fontSize: '0.82rem' }}>{children}</Link>;
}
