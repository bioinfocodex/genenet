import React from 'react';
import { prisma } from '@/lib/prisma';
import SignaturePanel from '@/components/SignaturePanel';
import { signaturesFor } from '@/lib/signature';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Edit, Download, FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  Draft: 'badge-orange',
  'In Progress': 'badge-purple',
  Completed: 'badge-green',
};

const SECTION_ORDER = [
  'project_info','gene_info','gene_map','plasmid_map',
  'expected_results','obtained_results','procedures',
  'findings','discussion','conclusion',
];

export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      project: true,
      createdBy: true,
      sections: true,
      figures:  { orderBy: { order: 'asc' } },
      tables:   { orderBy: { order: 'asc' } },
      taskLinks: { include: { task: { include: { procedure: true } } } },
    },
  });

  if (!report) notFound();


  const signatures = await signaturesFor('Report', report.id);

  const sectionMap = Object.fromEntries(report.sections.map(s => [s.sectionKey, s]));
  const orderedSections = SECTION_ORDER.map(k => sectionMap[k]).filter(Boolean).filter(s => s.content.trim());

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        <Link href="/reports" style={{ color: 'var(--accent-blue)' }}>Reports</Link>
        <ChevronRight size={14} />
        <span>{report.title}</span>
      </div>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
              <span className={`badge ${statusColor[report.status] ?? ''}`}>{report.status}</span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Last updated {new Date(report.updatedAt).toLocaleDateString()}</span>
            </div>
            <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>{report.title}</h1>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Project: <Link href={`/projects/${report.project.id}`} style={{ color: 'var(--accent-blue)' }}>{report.project.name}</Link>
              &nbsp;·&nbsp; Author: {report.createdBy.name}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <Link href={`/reports/${report.id}/edit`} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <Edit size={15} /> Edit
            </Link>
            <a href={`/api/reports/${report.id}/export`} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', textDecoration: 'none' }}>
              <Download size={15} /> Export DOCX
            </a>
          </div>
        </div>

        {report.abstract && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Abstract</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{report.abstract}</p>
          </div>
        )}
      </div>

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {orderedSections.length === 0 && (
          <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <FileText size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ fontSize: '0.9rem' }}>No content yet. <Link href={`/reports/${report.id}/edit`} style={{ color: 'var(--accent-blue)' }}>Start editing →</Link></p>
          </div>
        )}
        {orderedSections.map((section, i) => (
          <div key={section.id} className="glass-panel" style={{ padding: '1.5rem 2rem' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-blue)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              {section.title}
            </h2>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{section.content}</div>
          </div>
        ))}

        {/* Figures */}
        {report.figures.length > 0 && (
          <div className="glass-panel" style={{ padding: '1.5rem 2rem' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)' }}>Figures</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {report.figures.map((fig, i) => (
                <div key={fig.id}>
                  {fig.imageUrl && (
                    <div style={{ marginBottom: '0.5rem', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'var(--bg-primary)', maxHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src={fig.imageUrl} alt={fig.title || `Figure ${i + 1}`} style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain' }} />
                    </div>
                  )}
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>Figure {i + 1}{fig.title ? `: ${fig.title}` : ''}</div>
                  {fig.legend && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5 }}>{fig.legend}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tables */}
        {report.tables.length > 0 && (
          <div className="glass-panel" style={{ padding: '1.5rem 2rem' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)' }}>Tables</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {report.tables.map((tbl, i) => {
                const rows: string[][] = JSON.parse(tbl.tableData || '[]');
                return (
                  <div key={tbl.id}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Table {i + 1}{tbl.title ? `: ${tbl.title}` : ''}</div>
                    {rows.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                          <tbody>
                            {rows.map((row, ri) => (
                              <tr key={ri} style={{ background: ri === 0 ? 'var(--accent-blue-15)' : ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                                {row.map((cell, ci) => (
                                  <td key={ci} style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--glass-border)', fontWeight: ri === 0 ? 700 : 400, color: ri === 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {tbl.legend && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.4rem' }}>{tbl.legend}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      
    <SignaturePanel model="Report" recordId={report.id} signatures={signatures} />

  </div>
    </div>
  );
}
