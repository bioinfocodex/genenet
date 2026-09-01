'use client';
import { useState, useTransition } from 'react';
import { Users, Lock, Globe, ShieldCheck } from 'lucide-react';
import { setProjectRestricted, addProjectMember, removeProjectMember } from '@/app/actions/permissions';
import { LEVELS, LEVEL_LABELS, LEVEL_DESCRIPTIONS, type MemberView } from '@/lib/permissions';

/**
 * Who can reach this project.
 *
 * The open/restricted switch leads, because it is the thing that decides
 * whether anything below it matters. Listing members above it would suggest the
 * list is doing work while a project is still open to the whole workspace.
 */
export default function ProjectAccess({
  projectId, restricted, members, candidates, canManage,
}: {
  projectId: string;
  restricted: boolean;
  members: MemberView[];
  candidates: { id: string; name: string; email: string }[];
  canManage: boolean;
}) {
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<string>('VIEW');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<{ ok: true } | { error: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if ('error' in r) setError(r.error);
    });
  };

  const notMembers = candidates.filter(c => !members.some(m => m.userId === c.id && !m.implicit));

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Users size={16} /> Access
      </h2>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.7rem', padding: '0.9rem 1.1rem',
        borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--bg-primary)',
        marginBottom: members.length > 0 || canManage ? '1.1rem' : 0,
      }}>
        {restricted ? <Lock size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                    : <Globe size={16} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-muted)' }} />}
        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: '0.9rem' }}>
            {restricted ? 'Restricted to the people listed' : 'Open to the whole workspace'}
          </strong>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0', lineHeight: 1.55 }}>
            {restricted
              ? 'Only the people below, and workspace admins, can see this project and its records.'
              : 'Any workspace member can see and edit this project. Restrict it when a student or an outside collaborator should see only part of the lab.'}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => act(() => {
              const fd = new FormData();
              fd.append('projectId', projectId);
              fd.append('restricted', restricted ? 'no' : 'yes');
              return setProjectRestricted(fd);
            })}
            disabled={pending}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            {restricted ? 'Open it up' : 'Restrict it'}
          </button>
        )}
      </div>

      {members.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: canManage ? '1.1rem' : 0 }}>
          {members.map(m => (
            <div key={m.userId} style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.45rem 0.7rem', borderRadius: 7,
              border: '1px solid var(--glass-border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.87rem', fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.email}
                </div>
              </div>
              <span style={{
                fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: 4,
                background: 'var(--bg-primary)', border: '1px solid var(--glass-border)',
                color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: '0.25rem',
              }}>
                {m.implicit && <ShieldCheck size={11} />}
                {LEVEL_LABELS[m.level]}
              </span>
              {m.implicit ? (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                  title="Workspace admins hold access without a membership row">
                  admin
                </span>
              ) : canManage ? (
                <button
                  onClick={() => act(() => {
                    const fd = new FormData();
                    fd.append('projectId', projectId);
                    fd.append('userId', m.userId);
                    return removeProjectMember(fd);
                  })}
                  disabled={pending}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: '0.75rem', fontFamily: 'inherit' }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={userId} onChange={e => setUserId(e.target.value)}
            className="input-control" style={{ flex: 1, minWidth: 180, fontSize: '0.83rem', padding: '0.36rem 0.55rem' }}>
            <option value="">Add someone…</option>
            {notMembers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={level} onChange={e => setLevel(e.target.value)}
            title={LEVEL_DESCRIPTIONS[level as keyof typeof LEVEL_DESCRIPTIONS]}
            className="input-control" style={{ fontSize: '0.83rem', padding: '0.36rem 0.55rem' }}>
            {LEVELS.map(l => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
          </select>
          <button
            onClick={() => act(async () => {
              const fd = new FormData();
              fd.append('projectId', projectId);
              fd.append('userId', userId);
              fd.append('level', level);
              const r = await addProjectMember(fd);
              if (!('error' in r)) setUserId('');
              return r;
            })}
            disabled={pending || !userId}
            className="btn btn-primary"
            style={{ fontSize: '0.82rem' }}
          >
            Add
          </button>
        </div>
      )}

      {canManage && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.6rem 0 0', lineHeight: 1.5 }}>
          {LEVEL_DESCRIPTIONS[level as keyof typeof LEVEL_DESCRIPTIONS]}
        </p>
      )}

      {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
    </div>
  );
}
