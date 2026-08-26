'use client';
import { useState, useTransition } from 'react';
import {
  blockUser, removeUser, restoreUser,
  promoteToAdmin, demoteToMember, regenerateConnectionCode,
} from '@/app/actions/auth';
import { Shield, UserX, UserCheck, RefreshCw, Copy, CheckCircle } from 'lucide-react';

type User = {
  id: string; name: string; email: string;
  role: string; status: string; createdAt: Date;
};

type Props = {
  users: User[];
  currentUserId: string;
  connectionCode: string | null;
  serverUrl: string | null;
  workspaceName: string;
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:  'var(--accent-green)',
  BLOCKED: 'var(--accent-orange)',
  REMOVED: 'var(--accent-red)',
};
const STATUS_BG: Record<string, string> = {
  ACTIVE:  'rgba(5,150,105,0.08)',
  BLOCKED: 'rgba(251,146,60,0.1)',
  REMOVED: 'rgba(239,68,68,0.1)',
};

export default function AdminClient({ users, currentUserId, connectionCode, serverUrl, workspaceName }: Props) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const act = (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>) => {
    startTransition(async () => {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => fd.append(k, v));
      await fn(fd);
    });
  };

  const inviteLink = serverUrl ? `${serverUrl}/connect` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* Connection Info */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Connection System
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          <InfoBlock label="Workspace" value={workspaceName} />
          <InfoBlock label="Server URL" value={serverUrl ?? 'Not configured'} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)', borderRadius: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Connection Code</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.18em', fontFamily: 'monospace', color: 'var(--accent-blue)' }}>
              {connectionCode ?? '—'}
            </div>
          </div>
          {connectionCode && (
            <button onClick={() => copy(connectionCode, 'code')} title="Copy code"
              style={{ background: 'none', border: '1px solid var(--accent-blue-glow)', borderRadius: '8px', padding: '0.5rem 0.75rem', cursor: 'pointer', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
              {copied === 'code' ? <CheckCircle size={14} /> : <Copy size={14} />}
              {copied === 'code' ? 'Copied!' : 'Copy'}
            </button>
          )}
          {inviteLink && (
            <button onClick={() => copy(inviteLink, 'link')} title="Copy invite link"
              style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '0.5rem 0.75rem', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
              {copied === 'link' ? <CheckCircle size={14} /> : <Copy size={14} />}
              {copied === 'link' ? 'Copied!' : 'Copy Link'}
            </button>
          )}
          <form action={regenerateConnectionCode}>
            <button type="submit" disabled={isPending} title="Regenerate code"
              style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '0.5rem 0.75rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
              <RefreshCw size={14} /> Regenerate
            </button>
          </form>
        </div>

        {inviteLink && (
          <div style={{ marginTop: '0.75rem', padding: '0.65rem 1rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)', fontSize: '0.8rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Invite link: </span>{inviteLink}?code={connectionCode}
          </div>
        )}
      </div>

      {/* User Management */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shield size={18} /> User Access Control
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {users.map(u => {
            const isMe = u.id === currentUserId;
            return (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                padding: '0.85rem 1.1rem',
                background: isMe ? 'var(--accent-blue-15)' : 'var(--bg-primary)',
                border: `1px solid ${isMe ? 'var(--accent-blue-glow)' : 'var(--glass-border)'}`,
                borderRadius: '10px', opacity: u.status === 'REMOVED' ? 0.6 : 1,
              }}>
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                  🧬
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {u.name}
                    {isMe && <span style={{ fontSize: '0.65rem', color: 'var(--accent-blue)' }}>(you)</span>}
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: u.role === 'ADMIN' ? 'var(--accent-purple)' : 'var(--text-muted)', background: u.role === 'ADMIN' ? 'rgba(124,58,237,0.1)' : 'var(--bg-primary)', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>
                      {u.role}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{u.email}</div>
                </div>

                {/* Status badge */}
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: STATUS_COLOR[u.status] ?? 'var(--text-muted)', background: STATUS_BG[u.status] ?? 'transparent', padding: '0.2rem 0.55rem', borderRadius: '4px', flexShrink: 0 }}>
                  {u.status}
                </span>

                {/* Actions — not for self */}
                {!isMe && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    {u.status === 'ACTIVE' && (
                      <ActionBtn
                        icon={<UserX size={13} />} label="Block" color="var(--accent-orange)"
                        onClick={() => act(blockUser, { userId: u.id })} disabled={isPending}
                      />
                    )}
                    {(u.status === 'BLOCKED' || u.status === 'REMOVED') && (
                      <ActionBtn
                        icon={<UserCheck size={13} />} label="Restore" color="var(--accent-green)"
                        onClick={() => act(restoreUser, { userId: u.id })} disabled={isPending}
                      />
                    )}
                    {u.status === 'ACTIVE' && (
                      <ActionBtn
                        icon={<UserX size={13} />} label="Remove" color="var(--accent-red)"
                        onClick={() => act(removeUser, { userId: u.id })} disabled={isPending}
                      />
                    )}
                    {u.role === 'MEMBER' && u.status === 'ACTIVE' && (
                      <ActionBtn
                        icon={<Shield size={13} />} label="Make Admin" color="var(--accent-purple)"
                        onClick={() => act(promoteToAdmin, { userId: u.id })} disabled={isPending}
                      />
                    )}
                    {u.role === 'ADMIN' && (
                      <ActionBtn
                        icon={<Shield size={13} />} label="Demote" color="var(--text-muted)"
                        onClick={() => act(demoteToMember, { userId: u.id })} disabled={isPending}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '0.65rem 0.9rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function ActionBtn({ icon, label, color, onClick, disabled }: {
  icon: React.ReactNode; label: string; color: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} style={{
      display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 600,
      padding: '0.3rem 0.6rem', borderRadius: '6px', cursor: 'pointer',
      border: `1px solid ${color}20`, background: `${color}10`, color,
      transition: 'all 0.15s', opacity: disabled ? 0.6 : 1,
    }}>
      {icon} {label}
    </button>
  );
}
