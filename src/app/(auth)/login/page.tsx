'use client';
import { useActionState } from 'react';
import { login } from '@/app/actions/auth';
import Link from 'next/link';
import { Dna } from 'lucide-react';

type State = { error?: string } | undefined;

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', backgroundImage: 'radial-gradient(ellipse at top right, rgba(37,99,235,0.1), transparent 50%), radial-gradient(ellipse at bottom left, rgba(124,58,237,0.1), transparent 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 56, height: 56, borderRadius: '14px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <Dna size={28} color="white" />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'Outfit, sans-serif' }}>GeneNet</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Sign in to your lab workspace</p>
        </div>

        <form action={action} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {state?.error && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '0.88rem' }}>
              {state.error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Email</label>
            <input type="email" name="email" required className="input-control" placeholder="you@yourlab.com" autoComplete="email" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Password</label>
            <input type="password" name="password" required className="input-control" placeholder="••••••••" autoComplete="current-password" />
          </div>

          <button type="submit" disabled={pending} className="btn btn-primary" style={{ padding: '0.85rem', fontSize: '0.95rem' }}>
            {pending ? 'Signing in…' : 'Sign In'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
            Have an invite code?{' '}
            <Link href="/register" style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>Create account</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
