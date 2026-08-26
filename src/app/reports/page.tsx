import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Plus, FileText, Download, Edit } from 'lucide-react';
import { createReport } from '@/app/actions/reports';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  Draft: 'badge-orange',
  'In Progress': 'badge-purple',
  Completed: 'badge-green',
};

export default async function ReportsDashboard() {
  const reports = await prisma.report.findMany({
    include: {
      project: true,
      createdBy: true,
      sections: true,
      figures: true,
      tables: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const projects = await prisma.project.findMany({
    where: { report: null },   // projects without a report yet
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <FileText size={28} color="var(--accent-blue)" /> Report Dashboard
        </h1>

        {projects.length > 0 && (
          <form action={createReport} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select name="projectId" required className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
              <Plus size={16} /> New Report
            </button>
          </form>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <FileText size={40} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <p>No reports yet. Create a report for a project above.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['Report Title','Project','Status','Sections','Figures','Tables','Author','Updated','Actions'].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r, idx) => {
                const filledSections = r.sections.filter(s => s.content.trim()).length;
                return (
                  <tr key={r.id} style={{ borderBottom: idx < reports.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <Link href={`/reports/${r.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{r.title}</Link>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      <Link href={`/projects/${r.project.id}`} style={{ color: 'var(--accent-blue)' }}>{r.project.name}</Link>
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span className={`badge ${statusColor[r.status] ?? ''}`} style={{ fontSize: '0.72rem' }}>{r.status}</span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{filledSections}/{r.sections.length}</td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{r.figures.length}</td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{r.tables.length}</td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{r.createdBy.name}</td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <Link href={`/reports/${r.id}`} title="View" style={{ display: 'flex', padding: '0.3rem 0.6rem', borderRadius: 6, border: '1px solid var(--glass-border)', color: 'var(--text-muted)', background: 'var(--bg-primary)', fontSize: '0.75rem', alignItems: 'center', gap: '0.25rem' }}>
                          <FileText size={12} /> View
                        </Link>
                        <Link href={`/reports/${r.id}/edit`} title="Edit" style={{ display: 'flex', padding: '0.3rem 0.6rem', borderRadius: 6, border: '1px solid var(--glass-border)', color: 'var(--text-muted)', background: 'var(--bg-primary)', fontSize: '0.75rem', alignItems: 'center', gap: '0.25rem' }}>
                          <Edit size={12} /> Edit
                        </Link>
                        <a href={`/api/reports/${r.id}/export`} title="Download DOCX" style={{ display: 'flex', padding: '0.3rem 0.6rem', borderRadius: 6, border: '1px solid rgba(37,99,235,0.3)', color: 'var(--accent-blue)', background: 'var(--accent-blue-15)', fontSize: '0.75rem', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}>
                          <Download size={12} /> DOCX
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
