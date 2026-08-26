import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { FlaskConical, Plus, Search } from 'lucide-react';

export const dynamic = 'force-dynamic';

const TYPE_COLOR: Record<string, string> = {
  PLASMID:        'var(--accent-blue)',
  LINEAR_DNA:     'var(--accent-green)',
  GLYCEROL_STOCK: 'var(--accent-purple)',
  OTHER:          'var(--text-muted)',
};
const STATUS_BADGE: Record<string, string> = {
  ACTIVE:   'badge-green',
  USED:     'badge-orange',
  DEPLETED: 'badge-red',
  ARCHIVED: '',
};

export default async function SamplesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const where = q ? {
    OR: [
      { name:     { contains: q } },
      { sampleId: { contains: q } },
      { type:     { contains: q } },
      { project:  { name: { contains: q } } },
    ],
  } : {};

  const samples = await prisma.sample.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      freezer:      { select: { name: true, temperature: true } },
      task:         { select: { id: true, title: true } },
      project:      { select: { id: true, name: true } },
      geneSequence: { select: { id: true, name: true } },
      createdBy:    { select: { name: true } },
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <FlaskConical size={28} /> Sample Inventory
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
            {samples.length} sample{samples.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <Link href="/freezers" className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>🧊 Freezers</Link>
          <Link href="/samples/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <Plus size={15} /> Register Sample
          </Link>
        </div>
      </div>

      {/* Search */}
      <form method="GET" style={{ marginBottom: '1.5rem' }}>
        <div style={{ position: 'relative', maxWidth: 400 }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input name="q" defaultValue={q} className="input-control" placeholder="Search by name, ID, type, project…" style={{ paddingLeft: '2.1rem', padding: '0.55rem 0.75rem 0.55rem 2.1rem', fontSize: '0.85rem', width: '100%' }} />
        </div>
      </form>

      {samples.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧪</div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No samples yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.88rem' }}>Register stored samples to track plasmid DNA, glycerol stocks, and more.</p>
          <Link href="/samples/new" className="btn btn-primary">Register First Sample</Link>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['Sample ID', 'Name', 'Type', 'Storage', 'Location', 'Linked To', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: i < samples.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: TYPE_COLOR[s.type] ?? 'var(--text-primary)', fontSize: '0.82rem' }}>{s.sampleId}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link href={`/samples/${s.id}`} style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>{s.name}</Link>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ fontSize: '0.75rem', color: TYPE_COLOR[s.type], background: `${TYPE_COLOR[s.type]}18`, padding: '0.2rem 0.55rem', borderRadius: 4, fontWeight: 600 }}>
                      {s.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {s.freezer ? `${s.freezer.name} (${s.freezer.temperature}°C)` : '—'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {[s.rack && `Rack ${s.rack}`, s.box && `Box ${s.box}`, s.position].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {s.task && <div><Link href={`/tasks/${s.task.id}`} style={{ color: 'var(--accent-blue)' }}>📋 {s.task.title}</Link></div>}
                    {s.project && <div style={{ marginTop: '0.15rem' }}>📁 {s.project.name}</div>}
                    {s.geneSequence && <div style={{ marginTop: '0.15rem' }}><Link href={`/sequences/${s.geneSequence.id}`} style={{ color: 'var(--accent-green)' }}>🧬 {s.geneSequence.name}</Link></div>}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={`badge ${STATUS_BADGE[s.status] ?? ''}`} style={{ fontSize: '0.68rem' }}>{s.status}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link href={`/samples/${s.id}`} style={{ fontSize: '0.78rem', color: 'var(--accent-blue)' }}>View →</Link>
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
