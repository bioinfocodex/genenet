'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Hand, PackageCheck, AlertTriangle } from 'lucide-react';
import { describeCustody, overdueBy, problemWithDueDate, type Custody } from '@/lib/custody';
import { checkOutSample, checkInSample } from '@/app/actions/samples';

/**
 * Where the tube really is.
 *
 * A shelf and a box are the right answer until somebody is holding it. Then
 * the shelf is wrong, and the next person walks to the freezer and finds a
 * gap -- which is how an inventory stops being believed.
 */
export default function CustodyPanel({ id, custody, where }: {
  id: string;
  custody: Custody;
  /** Where it lives when it is in, for the line that says it is. */
  where: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const out = custody.heldBy !== null;
  const late = overdueBy(custody);
  const sentence = describeCustody(custody);
  const dueProblem = due ? problemWithDueDate(due) : null;

  const run = (fn: () => Promise<{ error?: string } | { ok: true }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r && 'error' in r && r.error) { setError(r.error); return; }
      setDue('');
      router.refresh();
    });
  };

  return (
    <div className="glass-panel" style={{
      padding: '1rem 1.25rem', marginTop: '1.25rem',
      borderLeft: late !== null ? '3px solid #b91c1c' : out ? '3px solid #a3560a' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.5rem' }}>
        {out ? <Hand size={16} /> : <PackageCheck size={16} />}
        <h2 style={{ fontSize: '0.95rem', margin: 0, flex: 1 }}>Where it is</h2>
      </div>

      <p style={{ fontSize: '0.86rem', margin: '0 0 0.75rem', color: late !== null ? '#b91c1c' : undefined }}>
        {late !== null && <AlertTriangle size={13} style={{ verticalAlign: '-2px' }} />}{' '}
        {out
          ? sentence
          : where
            ? <>In the freezer — {where}</>
            : 'In the freezer. No position recorded.'}
      </p>

      {out ? (
        <button className="btn btn-primary" style={{ fontSize: '0.8rem' }} disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.append('id', id);
                  run(() => checkInSample(fd));
                }}>
          {pending ? 'Putting it back…' : 'Put it back'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Back by (optional)
            </span>
            <input type="date" value={due} onChange={e => setDue(e.target.value)}
                   className="input-control" style={{ fontSize: '0.8rem', padding: '0.26rem 0.4rem' }} />
          </label>
          <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
                  disabled={pending || !!dueProblem}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append('id', id);
                    fd.append('dueBack', due);
                    run(() => checkOutSample(fd));
                  }}>
            {pending ? 'Taking it…' : 'Take it out'}
          </button>
          {dueProblem && <span style={{ fontSize: '0.78rem', color: '#a3560a' }}>{dueProblem}</span>}
        </div>
      )}

      {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '0.5rem 0 0' }}>{error}</p>}
    </div>
  );
}
