import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Plus, Layers } from 'lucide-react';
import { getSession } from '@/lib/session';
import { createGel, deleteGel } from '@/app/actions/gels';

export const dynamic = 'force-dynamic';

export default async function GelsPage() {
  const gels = await prisma.gelSimulation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { createdBy: { select: { name: true } } },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          🧫 Gel Simulations
        </h1>
        <form action={createGel}>
          <input type="hidden" name="name" value="Untitled Gel" />
          <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} /> New Gel
          </button>
        </form>
      </div>

      {gels.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>🧫</div>
          <h2 style={{ marginBottom: '0.5rem' }}>No gel simulations yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Create a gel to visualize PCR products, restriction digests, and custom band patterns.</p>
          <form action={createGel}>
            <input type="hidden" name="name" value="Untitled Gel" />
            <button type="submit" className="btn btn-primary">+ New Gel</button>
          </form>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {gels.map(gel => {
            let laneCount = 0;
            try { laneCount = JSON.parse(gel.lanes).length; } catch {}
            return (
              <div key={gel.id} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Link href={`/gels/${gel.id}`} style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{gel.name}</Link>
                  <form action={deleteGel} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={gel.id} />
                    <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0' }}>✕</button>
                  </form>
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <Stat label="Agarose" value={`${gel.concentration}%`} />
                  <Stat label="Voltage" value={`${gel.voltage} V`} />
                  <Stat label="Run time" value={`${gel.runTime} min`} />
                  <Stat label="Lanes" value={`${laneCount}`} />
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  By {gel.createdBy.name} · {new Date(gel.updatedAt).toLocaleDateString()}
                </div>
                <Link href={`/gels/${gel.id}`} className="btn btn-secondary" style={{ fontSize: '0.82rem', textAlign: 'center' }}>Open Editor →</Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
