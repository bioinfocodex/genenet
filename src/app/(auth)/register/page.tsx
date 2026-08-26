'use client';
import { useActionState } from 'react';
import { register } from '@/app/actions/auth';
import Link from 'next/link';
import { Dna } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function RegisterForm() {
  const [state, action, pending] = useActionState(register, undefined);
  const params = useSearchParams();
  const codeFromUrl = params.get('code')?.toUpperCase() ?? '';

  return (
    <form action={action} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {state?.error && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '0.88rem' }}>
          {state.error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Invite Code</label>
        <input
          type="text" name="inviteCode" required className="input-control"
          defaultValue={codeFromUrl}
          readOnly={!!codeFromUrl}
          placeholder="e.g. LAB-AB123"
          style={{
            fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '1rem',
            background: codeFromUrl ? 'var(--accent-blue-15)' : undefined,
            color: codeFromUrl ? 'var(--accent-blue)' : undefined,
            border: codeFromUrl ? '1px solid var(--accent-blue-glow)' : undefined,
          }}
          autoComplete="off"
        />
        {codeFromUrl
          ? <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)' }}>✓ Invite code auto-filled from your invite link.</span>
          : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Ask your lab admin for an invite code.</span>
        }
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Your Name</label>
        <input type="text" name="name" required className="input-control" placeholder="e.g. Dr. Alice Chen" autoComplete="name" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Email</label>
        <input type="email" name="email" required className="input-control" placeholder="you@yourlab.com" autoComplete="email" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Password</label>
        <input type="password" name="password" required className="input-control" placeholder="Min. 8 characters" autoComplete="new-password" />
      </div>

      <button type="submit" disabled={pending} className="btn btn-primary" style={{ padding: '0.85rem', fontSize: '0.95rem' }}>
        {pending ? 'Creating account…' : 'Create Account'}
      </button>

      <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
        Already have an account?{' '}
        <Link href="/login" style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>Sign in</Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', backgroundImage: 'radial-gradient(ellipse at top right, rgba(37,99,235,0.1), transparent 50%), radial-gradient(ellipse at bottom left, rgba(124,58,237,0.1), transparent 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 56, height: 56, borderRadius: '14px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <Dna size={28} color="white" />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'Outfit, sans-serif' }}>Join the Lab</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Enter the invite code shared by your lab admin
          </p>
        </div>
        <Suspense fallback={<div>Loading…</div>}>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
