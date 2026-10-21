'use client';
import Link from 'next/link';
import { Hand, AlertTriangle } from 'lucide-react';
import { describeCustody, overdueBy, type Custody } from '@/lib/custody';

/**
 * The tubes that are not where the map says they are.
 *
 * Shown above the shelves, because somebody standing in front of an empty
 * slot is asking "who has it", not "what else is in this box".
 */
export default function OutOfFreezer({ samples }: {
  samples: { id: string; code: string; name: string; from: string | null; custody: Custody }[];
}) {
  if (samples.length === 0) return null;

  const late = samples.filter(s => overdueBy(s.custody) !== null);

  return (
    <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.6rem' }}>
        <Hand size={16} />
        <h2 style={{ fontSize: '0.95rem', margin: 0 }}>
          Out of the freezer
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {samples.length}</span>
        </h2>
        {late.length > 0 && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, padding: '0.08rem 0.4rem', borderRadius: 8,
            background: 'rgba(185,28,28,0.12)', color: '#b91c1c',
          }}>
            {late.length} overdue
          </span>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <tbody>
          {samples.map(s => {
            const isLate = overdueBy(s.custody) !== null;
            return (
              <tr key={s.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '0.3rem 0.5rem 0.3rem 0', whiteSpace: 'nowrap' }}>
                  <Link href={`/samples/${s.id}`} style={{ fontFamily: 'monospace' }}>{s.code}</Link>
                </td>
                <td style={{ padding: '0.3rem 0.5rem' }}>{s.name}</td>
                <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-muted)' }}>
                  {s.from ? `from ${s.from}` : ''}
                </td>
                <td style={{ padding: '0.3rem 0 0.3rem 0.5rem', color: isLate ? '#b91c1c' : 'var(--text-secondary)' }}>
                  {isLate && <AlertTriangle size={12} style={{ verticalAlign: '-2px' }} />}{' '}
                  {describeCustody(s.custody)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
