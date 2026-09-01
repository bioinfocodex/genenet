import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Plus, FolderKanban, CheckSquare, Lock } from 'lucide-react';
import { requireUser } from '@/lib/auth-guard';
import { visibleProjectFilter } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  ACTIVE: 'badge-green',
  COMPLETED: 'badge-purple',
  ON_HOLD: 'badge-orange',
};

export default async function ProjectsPage() {
  const user = await requireUser();
  // A list that forgets the filter leaks the names of restricted projects,
  // which is often the part most worth hiding.
  const projects = await prisma.project.findMany({
    where: visibleProjectFilter(user),
    include: { createdBy: true, tasks: true },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <FolderKanban size={28} color="var(--accent-blue)" /> Projects
        </h1>
        <Link href="/projects/new" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={18} /> New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <FolderKanban size={40} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <p>No projects yet. <Link href="/projects/new" style={{ color: 'var(--accent-blue)' }}>Create one.</Link></p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {projects.map(project => {
            const done = project.tasks.filter(t => t.status === 'DONE').length;
            const total = project.tasks.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <Link key={project.id} href={`/projects/${project.id}`} style={{ textDecoration: 'none' }}>
                <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer', height: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {project.restricted && (
                        <Lock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                          aria-label="Restricted to named members" />
                      )}
                      {project.name}
                    </h3>
                    <span className={`badge ${statusColor[project.status] ?? ''}`} style={{ fontSize: '0.72rem', flexShrink: 0 }}>{project.status.replace('_', ' ')}</span>
                  </div>
                  {project.description && (
                    <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{project.description}</p>
                  )}
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><CheckSquare size={12} /> {done}/{total} tasks</span>
                      <span>{pct}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : 'var(--accent-blue)', borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>by {project.createdBy.name}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
