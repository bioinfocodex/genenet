import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Plus, Activity } from 'lucide-react';
import { deleteRun } from '@/app/actions/bioreactors';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  RUNNING: 'badge-green',
  COMPLETED: 'badge-blue',
  FAILED: 'badge-red',
  PAUSED: 'badge-orange',
};

export default async function BioreactorsPage() {
  const runs = await prisma.bioreactorRun.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { readings: true } } },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Activity size={28} color="var(--accent-green)" /> Bioreactor Runs
        </h1>
        <Link href="/bioreactors/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={18} /> New Run
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <Activity size={40} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <h2 style={{ marginBottom: '0.5rem' }}>No bioreactor runs</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Start tracking your 2L or 10L bioreactor runs with time-series pH, DO, and temperature data.</p>
          <Link href="/bioreactors/new" className="btn btn-primary">+ New Run</Link>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['Name', 'Vessel', 'Organism', 'Status', 'Readings', 'Started', 'Ended', ''].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr key={run.id} style={{ borderBottom: i < runs.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link href={`/bioreactors/${run.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{run.name}</Link>
                    {run.medium && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{run.medium}</div>}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--accent-blue)', fontWeight: 600 }}>{run.vesselSize}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{run.organism ?? '—'}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={`badge ${STATUS_COLORS[run.status] ?? ''}`} style={{ fontSize: '0.72rem' }}>{run.status}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{run._count.readings}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(run.startedAt).toLocaleDateString()}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{run.endedAt ? new Date(run.endedAt).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <form action={deleteRun}>
                      <input type="hidden" name="id" value={run.id} />
                      <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>✕</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
