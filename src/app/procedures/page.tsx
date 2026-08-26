import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Plus, BookOpen, Archive, Copy, Edit } from 'lucide-react';
import { archiveProcedure, duplicateProcedure } from '@/app/actions/procedures';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  Draft: 'badge-orange',
  Review: 'badge-purple',
  Approved: 'badge-green',
  Archived: '',
};

export default async function ProceduresPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string }> }) {
  const { q, status, category } = await searchParams;

  const procedures = await prisma.procedure.findMany({
    where: {
      isArchived: status === 'Archived' ? true : status ? false : undefined,
      ...(status && status !== 'Archived' ? { status } : {}),
      ...(category ? { category } : {}),
      ...(q ? { name: { contains: q } } : {}),
    },
    include: { author: true, steps: true },
    orderBy: { updatedAt: 'desc' },
  });

  const categories = await prisma.procedure.findMany({ select: { category: true }, distinct: ['category'] });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BookOpen size={28} color="var(--accent-blue)" /> Procedure Library
        </h1>
        <Link href="/procedures/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={18} /> New Procedure
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input name="q" defaultValue={q} placeholder="Search procedures…" className="input-control" style={{ flex: 1, minWidth: 200, padding: '0.5rem 0.9rem', fontSize: '0.88rem' }} />
        <select name="status" defaultValue={status ?? ''} className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.88rem' }}>
          <option value="">All Statuses</option>
          {['Draft','Review','Approved','Archived'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="category" defaultValue={category ?? ''} className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.88rem' }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.category} value={c.category}>{c.category}</option>)}
        </select>
        <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.88rem' }}>Filter</button>
        {(q || status || category) && <Link href="/procedures" className="btn btn-secondary" style={{ fontSize: '0.88rem' }}>Clear</Link>}
      </form>

      {procedures.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <BookOpen size={40} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <p>No procedures found. <Link href="/procedures/new" style={{ color: 'var(--accent-blue)' }}>Create the first one.</Link></p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['ID','Name','Category','Status','Version','Steps','Author','Updated','Actions'].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {procedures.map((p, idx) => (
                <tr key={p.id} style={{ borderBottom: idx < procedures.length - 1 ? '1px solid var(--glass-border)' : 'none', opacity: p.isArchived ? 0.55 : 1 }}>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{p.procedureId}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link href={`/procedures/${p.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{p.name}</Link>
                    {p.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.category}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={`badge ${statusColor[p.status] ?? ''}`} style={{ fontSize: '0.72rem' }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{p.version}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{p.steps.length}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.author.name}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {!p.isArchived && (
                        <Link href={`/procedures/${p.id}/edit`} title="Edit" style={{ display: 'flex', padding: '0.3rem', borderRadius: 6, border: '1px solid var(--glass-border)', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
                          <Edit size={13} />
                        </Link>
                      )}
                      <form action={duplicateProcedure} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" title="Duplicate" style={{ display: 'flex', padding: '0.3rem', borderRadius: 6, border: '1px solid var(--glass-border)', color: 'var(--text-muted)', background: 'var(--bg-primary)', cursor: 'pointer' }}>
                          <Copy size={13} />
                        </button>
                      </form>
                      {!p.isArchived && (
                        <form action={archiveProcedure} style={{ display: 'inline' }}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" title="Archive" style={{ display: 'flex', padding: '0.3rem', borderRadius: 6, border: '1px solid rgba(220,38,38,0.2)', color: 'var(--accent-red)', background: 'rgba(220,38,38,0.06)', cursor: 'pointer' }}>
                            <Archive size={13} />
                          </button>
                        </form>
                      )}
                    </div>
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
