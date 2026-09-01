'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, CheckCheck, AlertTriangle, ShieldCheck, PenLine, Trash2 } from 'lucide-react';
import { saveEntry, signEntry, witnessEntry, superseedEntry, deleteDraft } from '@/app/actions/notebook';
import { linkHref, extractLinks, LINK_KINDS, type EntryStatus } from '@/lib/notebook';

/**
 * Reading, writing and signing one entry.
 *
 * A signed entry renders read-only with no edit control anywhere — not a
 * disabled one. Showing a greyed-out button implies the restriction is about
 * permission, when it is about what a signature means.
 */

interface Verification { intact: boolean; reason: string }

/** Render the body with [[kind:id|label]] turned into links. */
function Body({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[\[([a-z]+):([A-Za-z0-9_-]+)(?:\|([^\]]*))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = linkHref(m[1], m[2]);
    const label = (m[3] ?? m[2]).trim() || m[2];
    parts.push(
      href
        ? <Link key={n++} href={href} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{label}</Link>
        // An unknown kind renders as its label rather than as raw markup: the
        // reader is not the person who needs to know the syntax was wrong.
        : <span key={n++}>{label}</span>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));

  return (
    <div style={{ fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
      {parts}
    </div>
  );
}

export default function EntryClient({
  entry, projects, editable, witnessable, isAuthor, verification, links, signatures,
  signedByName, witnessedByName,
}: {
  entry: { id: string; title: string; body: string; entryDate: string; projectId: string | null; status: EntryStatus };
  projects: { id: string; name: string }[];
  editable: { allowed: boolean; reason: string };
  witnessable: { allowed: boolean; reason: string };
  isAuthor: boolean;
  verification: Verification;
  links: { id: string; kind: string; targetId: string; label: string }[];
  signatures: { id: string; meaning: string; signerName: string; at: string; note: string | null }[];
  signedByName: string | null;
  witnessedByName: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [entryDate, setEntryDate] = useState(entry.entryDate);
  const [projectId, setProjectId] = useState(entry.projectId ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const draft = entry.status === 'DRAFT';
  const detected = extractLinks(body);

  const act = (fn: () => Promise<{ error?: string } & Record<string, unknown>>, then?: () => void) => {
    setError(null); setSaved(false);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      then?.();
      router.refresh();
    });
  };

  const save = () => act(() => {
    const fd = new FormData();
    fd.append('id', entry.id);
    fd.append('title', title);
    fd.append('body', body);
    fd.append('entryDate', entryDate);
    fd.append('projectId', projectId);
    return saveEntry(fd) as Promise<{ error?: string } & Record<string, unknown>>;
  }, () => setSaved(true));

  const sign = () => {
    if (!confirm('Signing fixes this entry. It cannot be edited afterwards — corrections are made as a new entry. Sign it?')) return;
    act(() => {
      const fd = new FormData();
      fd.append('id', entry.id);
      fd.append('note', note);
      return signEntry(fd) as Promise<{ error?: string } & Record<string, unknown>>;
    });
  };

  return (
    <>
      {!verification.intact && (
        <div className="glass-panel" style={{
          padding: '1rem 1.25rem', marginBottom: '1rem',
          border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.3rem' }}>
            <AlertTriangle size={15} color="#b91c1c" />
            <strong style={{ fontSize: '0.9rem', color: '#b91c1c' }}>This entry does not verify.</strong>
          </div>
          <p style={{ fontSize: '0.84rem', margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            {verification.reason}
          </p>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        {draft && editable.allowed ? (
          <>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              className="input-control"
              style={{ width: '100%', fontSize: '1rem', fontWeight: 600, padding: '0.45rem 0.6rem', marginBottom: '0.7rem' }}
            />
            <textarea
              value={body} onChange={e => setBody(e.target.value)}
              placeholder={'What happened. Link records with [[sequence:id|name]], [[sample:id|name]], [[plate:id|name]].'}
              style={{
                width: '100%', height: 320, fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.65,
                padding: '0.75rem', border: '1px solid var(--glass-border)', borderRadius: 8,
                background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.7rem' }}>
              <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
                className="input-control" style={{ fontSize: '0.83rem', padding: '0.35rem 0.55rem' }} />
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                className="input-control" style={{ fontSize: '0.83rem', padding: '0.35rem 0.55rem' }}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={save} disabled={pending} className="btn btn-secondary" style={{ fontSize: '0.83rem' }}>
                {pending ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
              </button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.6rem 0 0', lineHeight: 1.5 }}>
              {detected.length > 0
                ? `${detected.length} link${detected.length === 1 ? '' : 's'} recognised: ${detected.map(l => l.label).join(', ')}.`
                : `Link records inline with [[kind:id|label]] — kinds are ${LINK_KINDS.join(', ')}.`}
            </p>
          </>
        ) : (
          <Body text={entry.body || '(empty)'} />
        )}
      </div>

      {links.length > 0 && !draft && (
        <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }}>
          <div style={{
            fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem',
          }}>
            Records mentioned
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {links.map(l => {
              const href = linkHref(l.kind, l.targetId);
              return href ? (
                <Link key={l.id} href={href} style={{
                  fontSize: '0.78rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: 5,
                  border: '1px solid var(--glass-border)', color: 'var(--accent-blue)', textDecoration: 'none',
                }}>
                  {l.label}
                </Link>
              ) : (
                <span key={l.id} style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l.label}</span>
              );
            })}
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          {entry.status === 'WITNESSED' ? <CheckCheck size={16} color="var(--accent-green)" />
            : entry.status === 'SIGNED' ? <Lock size={15} color="var(--accent-blue)" />
            : <PenLine size={15} />}
          Signatures
        </h2>

        {signatures.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
            Not signed. A draft is a working document; nothing is claimed about it.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1rem' }}>
            {signatures.map(s => (
              <div key={s.id} style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                <strong>{s.signerName}</strong>
                <span style={{ color: 'var(--text-muted)' }}> — {s.meaning}, {s.at}</span>
                {s.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{s.note}</div>}
              </div>
            ))}
            {verification.intact && entry.status !== 'DRAFT' && (
              <div style={{ fontSize: '0.8rem', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                <ShieldCheck size={13} /> {verification.reason}
              </div>
            )}
          </div>
        )}

        {draft && isAuthor && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="Note on the signature (optional)"
              className="input-control"
              style={{ flex: 1, minWidth: 200, fontSize: '0.83rem', padding: '0.38rem 0.55rem' }}
            />
            <button onClick={sign} disabled={pending} className="btn btn-primary" style={{ fontSize: '0.83rem' }}>
              {pending ? 'Signing…' : 'Sign this entry'}
            </button>
          </div>
        )}

        {witnessable.allowed && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: draft ? '0.6rem' : 0 }}>
            <input
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="Note on the witness signature (optional)"
              className="input-control"
              style={{ flex: 1, minWidth: 200, fontSize: '0.83rem', padding: '0.38rem 0.55rem' }}
            />
            <button
              onClick={() => act(() => {
                const fd = new FormData();
                fd.append('id', entry.id);
                fd.append('note', note);
                return witnessEntry(fd) as Promise<{ error?: string } & Record<string, unknown>>;
              })}
              disabled={pending} className="btn btn-primary" style={{ fontSize: '0.83rem' }}
            >
              Witness it
            </button>
          </div>
        )}

        {!draft && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem', lineHeight: 1.6 }}>
              {editable.reason}
              {signedByName && ` Signed by ${signedByName}.`}
              {witnessedByName && ` Witnessed by ${witnessedByName}.`}
            </p>
            <button
              onClick={() => act(async () => {
                const fd = new FormData();
                fd.append('id', entry.id);
                const r = await superseedEntry(fd);
                if ('ok' in r) router.push(`/notebook/${r.id}`);
                return r as { error?: string } & Record<string, unknown>;
              })}
              disabled={pending} className="btn btn-secondary" style={{ fontSize: '0.83rem' }}
            >
              Start a correction
            </button>
          </div>
        )}

        {draft && isAuthor && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
            <button
              onClick={() => {
                if (!confirm('Delete this draft? A draft is not part of the record, so it goes for good.')) return;
                act(async () => {
                  const fd = new FormData();
                  fd.append('id', entry.id);
                  const r = await deleteDraft(fd);
                  if ('ok' in r) router.push('/notebook');
                  return r as { error?: string } & Record<string, unknown>;
                });
              }}
              disabled={pending}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Trash2 size={13} /> Delete draft
            </button>
          </div>
        )}

        {error && <div style={{ fontSize: '0.83rem', color: '#b91c1c', marginTop: '0.7rem' }}>{error}</div>}
      </div>
    </>
  );
}
