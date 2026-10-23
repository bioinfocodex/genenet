'use client';
import { useSearchParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';

/**
 * Sign in with the institution instead of a password.
 *
 * Offered alongside the password form rather than instead of it. A lab that
 * turns on single sign-on still has people its provider does not know --
 * a visiting student, a shared instrument account -- and an installation that
 * could only be reached one way would lock them out the first time the
 * provider had an outage.
 */
export default function SsoButton({ label }: { label: string }) {
  const params = useSearchParams();
  const from = params.get('from') ?? '';
  const error = params.get('sso_error');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      {error && (
        <div style={{
          padding: '0.7rem 0.9rem', background: 'rgba(220,38,38,0.07)',
          border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8,
          color: 'var(--accent-red)', fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
        or
        <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
      </div>

      <a
        href={`/api/auth/sso/start${from ? `?from=${encodeURIComponent(from)}` : ''}`}
        className="btn btn-secondary"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontSize: '0.9rem', padding: '0.6rem' }}
      >
        <KeyRound size={15} /> Sign in with {label}
      </a>
    </div>
  );
}
