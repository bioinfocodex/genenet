'use client';
import { useState, useTransition } from 'react';
import { PenLine, ShieldCheck, AlertTriangle, X } from 'lucide-react';
import { signRecord } from '@/app/actions/signatures';
import { MEANINGS, type Meaning, type SignatureView } from '@/lib/signature-types';

type Props = {
  model: 'Procedure' | 'Experiment' | 'Report';
  recordId: string;
  signatures: SignatureView[];
};

const ORDER: Meaning[] = ['authored', 'reviewed', 'approved', 'witnessed'];

function when(d: Date | string): string {
  // Signature times are shown in full, with the zone. "3 days ago" is not
  // something you can put in front of a reviewer.
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

export default function SignaturePanel({ model, recordId, signatures }: Props) {
  const [open, setOpen] = useState(false);
  const [meaning, setMeaning] = useState<Meaning>('reviewed');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const superseded = signatures.filter(s => !s.current).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set('model', model);
    fd.set('recordId', recordId);
    fd.set('meaning', meaning);
    fd.set('password', password);
    fd.set('note', note);
    startTransition(async () => {
      const r = await signRecord(fd);
      if ('error' in r) { setError(r.error); return; }
      setPassword(''); setNote(''); setOpen(false);
    });
  };

  return (
    <section style={{
      border: '1px solid var(--glass-border)', borderRadius: 12,
      background: 'var(--bg-secondary)', padding: '1.25rem', marginTop: '1.5rem',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.9rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent-green)' }} />
          Signatures
        </h2>
        <button onClick={() => { setOpen(true); setError(null); }} className="btn btn-secondary"
          style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <PenLine size={14} /> Sign
        </button>
      </header>

      {signatures.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
          Not signed. A signature records who took responsibility for this record,
          what for, and when.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {signatures.map(s => (
            <li key={s.id} style={{
              display: 'flex', gap: '0.7rem', alignItems: 'flex-start',
              padding: '0.7rem 0.85rem', borderRadius: 9,
              background: 'var(--bg-primary)',
              border: `1px solid ${s.current ? 'var(--glass-border)' : 'rgba(251,146,60,0.35)'}`,
            }}>
              {s.current
                ? <ShieldCheck size={15} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: 2 }} />
                : <AlertTriangle size={15} style={{ color: 'var(--accent-orange)', flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {s.signerName} <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>— {s.meaningText.toLowerCase()}</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {s.signerEmail} · {when(s.at)}
                </div>
                {s.note && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{s.note}</div>
                )}
                {!s.current && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent-orange)', marginTop: '0.3rem' }}>
                    This record has been edited since it was signed. The signature
                    applies to the earlier version, not the text above.
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {superseded > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--accent-orange)', marginTop: '0.8rem', marginBottom: 0 }}>
          {superseded} of {signatures.length} signature{signatures.length === 1 ? '' : 's'} no longer
          {superseded === 1 ? 's' : ''} match the current content. Sign again to endorse this version.
        </p>
      )}

      {open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: 460, padding: '1.75rem', position: 'relative' }}>
            <button onClick={() => setOpen(false)} aria-label="Cancel"
              style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={16} />
            </button>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>Sign this {model.toLowerCase()}</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.1rem', lineHeight: 1.55 }}>
              Your name, the time and what the signature means are recorded permanently
              against this record. Re-entering your password confirms it is you signing.
            </p>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <legend style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                  This signature means
                </legend>
                {ORDER.map(m => (
                  <label key={m} style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
                    padding: '0.5rem 0.7rem', borderRadius: 8,
                    border: `1px solid ${meaning === m ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                    background: meaning === m ? 'var(--accent-blue-15)' : 'transparent',
                  }}>
                    <input type="radio" name="meaning" value={m} checked={meaning === m}
                      onChange={() => setMeaning(m)} style={{ accentColor: 'var(--accent-blue)' }} />
                    <span style={{ fontSize: '0.84rem' }}>{MEANINGS[m]}</span>
                  </label>
                ))}
              </fieldset>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Remark (optional)</span>
                <input value={note} onChange={e => setNote(e.target.value)} className="input-control"
                  placeholder="e.g. approved with the deviation noted in step 4" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Your password</span>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="input-control" autoComplete="current-password" required autoFocus />
              </label>

              {error && (
                <p style={{ fontSize: '0.8rem', color: 'var(--accent-red)', margin: 0 }}>{error}</p>
              )}

              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={isPending} className="btn btn-primary">
                  {isPending ? 'Signing…' : 'Sign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
