'use client';
import { Bell, Search, LogOut } from 'lucide-react';
import { useTransition } from 'react';
import { logout } from '@/app/actions/auth';

interface User { id: string; name: string; email: string; role: string; avatar: string | null; }

export default function Header({ user }: { user: User | null }) {
  const [, startTransition] = useTransition();
  const handleLogout = () => startTransition(() => { logout(); });

  return (
    <header className="glass-panel" style={{ height: '70px', borderRadius: 0, borderBottom: '1px solid var(--glass-border)', borderTop: 'none', borderLeft: 'none', borderRight: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2rem', position: 'sticky', top: 0, zIndex: 40, flexShrink: 0 }}>
      <div className="input-control" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '300px', padding: '0.5rem 1rem', borderRadius: '20px' }}>
        <Search size={16} color="var(--text-secondary)" />
        <input type="text" placeholder="Search experiments, tasks..." style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '0.9rem' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Bell size={20} />
          <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: 'var(--accent-red)', borderRadius: '50%', border: '1px solid white' }} />
        </button>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>
              {user.avatar ?? '🧬'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{user.name}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{user.role}</span>
            </div>
            <button onClick={handleLogout} title="Sign out" style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '6px', padding: '0.3rem 0.5rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginLeft: '0.25rem' }}>
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
