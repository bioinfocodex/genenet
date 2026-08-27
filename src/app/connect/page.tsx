'use client';
import { useState, useTransition } from 'react';
import { validateConnectionCode } from '@/app/actions/auth';
import Link from 'next/link';
import { Dna, CheckCircle, ArrowRight } from 'lucide-react';

export default function ConnectPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ workspaceName: string; serverUrl?: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      const fd = new FormData();
      fd.append('code', code);
      const res = await validateConnectionCode(fd);
      if ('error' in res) {
        setError(res.error ?? 'Connection failed.');
      } else {
        setResult({ workspaceName: res.workspaceName ?? 'Lab', serverUrl: res.serverUrl });
      }
    });
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <Dna size={30} color="var(--accent-blue)" />
            <span className="title-gradient" style={{ fontSize: '1.75rem', fontWeight: 800 }}>GeneNet</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Connect to your lab system</p>
        </div>

        {!result ? (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Join a Lab</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.75rem' }}>
              Enter the connection code given to you by your lab administrator.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Connection Code
                </label>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="LAB-XXXXX"
                  required
                  className="input-control"
                  style={{
                    width: '100%', padding: '0.65rem 0.9rem', fontSize: '1.2rem',
                    fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.15em',
                    textAlign: 'center',
                  }}
                />
              </div>

              {error && (
                <div style={{ padding: '0.65rem 0.9rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '0.85rem' }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={!code.trim() || isPending} className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', fontSize: '0.95rem' }}>
                {isPending ? 'Verifying…' : <><ArrowRight size={16} /> Connect to Lab</>}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Already have an account?{' '}
              <Link href="/login" style={{ color: 'var(--accent-blue)' }}>Sign in</Link>
            </div>
          </div>
        ) : (
          <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <CheckCircle size={48} color="var(--accent-green)" style={{ marginBottom: '1rem' }} />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>Connected!</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              You&rsquo;re connected to <strong>{result.workspaceName}</strong>.
            </p>
            {result.serverUrl && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1.75rem' }}>
                Server: {result.serverUrl}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <Link href="/register" className="btn btn-primary" style={{ textAlign: 'center', padding: '0.75rem', fontSize: '0.9rem' }}>
                Create Account
              </Link>
              <Link href="/login" className="btn btn-secondary" style={{ textAlign: 'center', padding: '0.65rem', fontSize: '0.85rem' }}>
                Sign in to existing account
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
