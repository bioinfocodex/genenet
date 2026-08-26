import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Plus, FlaskConical, Trash2 } from 'lucide-react';
import { deleteProtein } from '@/app/actions/proteins';

export const dynamic = 'force-dynamic';

export default async function ProteinsPage() {
  const proteins = await prisma.protein.findMany({
    orderBy: { createdAt: 'desc' },
    include: { geneSequence: { select: { name: true } } },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <FlaskConical size={28} color="var(--accent-purple)" /> Protein Library
        </h1>
        <Link href="/proteins/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={18} /> Add Protein
        </Link>
      </div>

      {proteins.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <FlaskConical size={40} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <h2 style={{ marginBottom: '0.5rem' }}>No proteins yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
            Add a protein sequence manually or translate a gene from the sequence library.
          </p>
          <Link href="/proteins/new" className="btn btn-primary">+ Add Protein</Link>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['Name', 'Length', 'MW (kDa)', 'pI', 'GRAVY', 'Source Gene', 'Tags', 'Added', ''].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proteins.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: i < proteins.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link href={`/proteins/${p.id}`} style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{p.name}</Link>
                    {p.description && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{p.description}</div>}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.sequence.length} aa</td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--accent-blue)' }}>{p.mw?.toFixed(1) ?? '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--accent-purple)' }}>{p.isoelectric?.toFixed(2) ?? '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: (p.gravy ?? 0) >= 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{p.gravy?.toFixed(3) ?? '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {p.geneSequence ? (
                      <Link href={`/sequences/${p.geneSequenceId}`} style={{ color: 'var(--accent-blue)', fontSize: '0.8rem' }}>{p.geneSequence.name}</Link>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {p.tags ? p.tags.split(',').map(t => (
                      <span key={t} style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid var(--glass-border)', marginRight: '0.25rem' }}>{t.trim()}</span>
                    )) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <form action={deleteProtein}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
                        <Trash2 size={14} />
                      </button>
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
