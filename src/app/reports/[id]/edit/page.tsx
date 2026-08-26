import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Eye } from 'lucide-react';
import ReportEditor from '@/components/ReportEditor';

export const dynamic = 'force-dynamic';

export default async function ReportEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      project: {
        include: {
          tasks: { include: { steps: true } },
        },
      },
      createdBy: true,
      sections:  { orderBy: [{ order: 'asc' } as any, { sectionKey: 'asc' }] },
      figures:   { orderBy: { order: 'asc' } },
      tables:    { orderBy: { order: 'asc' } },
      taskLinks: { include: { task: { include: { steps: true } } } },
    },
  });

  if (!report) notFound();

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        <Link href="/reports" style={{ color: 'var(--accent-blue)' }}>Reports</Link>
        <ChevronRight size={14} />
        <Link href={`/reports/${report.id}`} style={{ color: 'var(--accent-blue)' }}>{report.title}</Link>
        <ChevronRight size={14} />
        <span>Edit</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '1.8rem' }}>Editing: {report.title}</h1>
        <Link href={`/reports/${report.id}`} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
          <Eye size={15} /> Preview
        </Link>
      </div>

      <ReportEditor report={report as any} />
    </div>
  );
}
