'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Hash } from 'lucide-react';
import { backfillSequenceCodes } from '@/app/actions/sequences';

/**
 * The one-off that gives every construct made before codes existed one.
 *
 * Shown only while there is something to do, and it says how many. Running it
 * again is harmless -- anything already carrying a code is left alone -- but a
 * button that is always there invites somebody to wonder whether they should
 * press it.
 */
export default function BackfillCodes({ uncoded }: { uncoded: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  if (uncoded === 0 && done === null) return null;

  if (done !== null) {
    return (
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
        {done} construct{done === 1 ? '' : 's'} given a code.
      </p>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
      padding: '0.6rem 0.9rem', marginBottom: '1rem', borderRadius: 8,
      border: '1px solid var(--glass-border)', background: 'var(--bg-secondary)',
    }}>
      <Hash size={15} style={{ color: 'var(--text-muted)' }} />
      <span style={{ fontSize: '0.84rem', flex: 1 }}>
        {uncoded} construct{uncoded === 1 ? ' has' : 's have'} no code yet. Codes are issued oldest first,
        so the numbers run in the order the lab made them.
      </span>
      <button
        className="btn btn-secondary" style={{ fontSize: '0.78rem' }}
        disabled={pending}
        onClick={() => start(async () => {
          const r = await backfillSequenceCodes();
          setDone(r.issued);
          router.refresh();
        })}
      >
        {pending ? 'Issuing…' : 'Issue codes'}
      </button>
    </div>
  );
}
