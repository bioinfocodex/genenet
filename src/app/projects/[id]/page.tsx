import React from 'react';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, CheckSquare, Clock, AlertCircle, BookOpen } from 'lucide-react';
import { updateProjectStatus } from '@/app/actions/projects';
import TaskCreateForm from '@/components/TaskCreateForm';
import ProjectAccess from '@/components/ProjectAccess';
import { requireUser } from '@/lib/auth-guard';
import { checkAccess, effectiveMembers } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const priorityColor: Record<string, string> = { HIGH: 'badge-red', MEDIUM: 'badge-orange', LOW: '' };
const statusIcon: Record<string, React.ReactNode> = {
  TODO: <AlertCircle size={14} color="var(--text-muted)" />,
  IN_PROGRESS: <Clock size={14} color="var(--accent-orange)" />,
  DONE: <CheckSquare size={14} color="var(--accent-green)" />,
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      createdBy: true,
      tasks: {
        include: { assignedTo: true, procedure: true },
        orderBy: { createdAt: 'desc' },
      },
      members: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  if (!project) notFound();

  // A restricted project a person is not in should not be distinguishable from
  // one that does not exist: telling them it exists but is closed leaks the
  // project's name, which is often the part worth hiding.
  const membership = project.members.find(m => m.userId === user.id) ?? null;
  const access = checkAccess(
    { project: { id: project.id, restricted: project.restricted }, membership, user },
    'VIEW',
  );
  if (!access.allowed) notFound();

  const canManage = checkAccess(
    { project: { id: project.id, restricted: project.restricted }, membership, user },
    'MANAGE',
  ).allowed;

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const [workspaceMembers, admins] = await Promise.all([
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { status: 'ACTIVE', role: 'ADMIN' },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const memberView = effectiveMembers(project.members, admins);
  const procedures = await prisma.procedure.findMany({ where: { isArchived: false, status: 'Approved' }, select: { id: true, name: true, procedureId: true } });

  const done = project.tasks.filter(t => t.status === 'DONE').length;
  const total = project.tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const groupedTasks = {
    TODO: project.tasks.filter(t => t.status === 'TODO'),
    IN_PROGRESS: project.tasks.filter(t => t.status === 'IN_PROGRESS'),
    DONE: project.tasks.filter(t => t.status === 'DONE'),
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        <Link href="/projects" style={{ color: 'var(--accent-blue)' }}>Projects</Link>
        <ChevronRight size={14} />
        <span>{project.name}</span>
      </div>

      {/* Project Header */}
      <div className="glass-panel" style={{ padding: '1.75rem 2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>{project.name}</h1>
            {project.description && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{project.description}</p>}
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Created by {project.createdBy.name} · {new Date(project.createdAt).toLocaleDateString()}</div>
          </div>
          <form action={updateProjectStatus}>
            <input type="hidden" name="id" value={project.id} />
            <select name="status" defaultValue={project.status} onChange={undefined} className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
              onBlur={undefined}>
              {['ACTIVE','ON_HOLD','COMPLETED'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <button type="submit" className="btn btn-secondary" style={{ marginLeft: '0.5rem', fontSize: '0.82rem' }}>Update</button>
          </form>
        </div>

        {/* Progress */}
        <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            <span>{done} of {total} tasks complete</span>
            <span style={{ fontWeight: 600, color: pct === 100 ? 'var(--accent-green)' : 'var(--text-primary)' }}>{pct}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      {/* Add Task */}
      <ProjectAccess
        projectId={project.id}
        restricted={project.restricted}
        members={memberView}
        candidates={workspaceMembers}
        canManage={canManage}
      />

      <TaskCreateForm projectId={project.id} users={users} procedures={procedures} />

      {/* Task Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
        {(['TODO','IN_PROGRESS','DONE'] as const).map(col => (
          <div key={col} className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              {statusIcon[col]} {col.replace('_', ' ')}
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)' }}>{groupedTasks[col].length}</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {groupedTasks[col].map(task => (
                <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none' }}>
                  <div className="glass-card" style={{ padding: '0.9rem', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>{task.title}</div>
                    {task.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.description}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {task.procedure && <span style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><BookOpen size={10} /> {task.procedure.procedureId}</span>}
                      <span className={`badge ${priorityColor[task.priority] ?? ''}`} style={{ fontSize: '0.68rem', marginLeft: 'auto' }}>{task.priority}</span>
                    </div>
                    {task.assignedTo && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>→ {task.assignedTo.name}</div>}
                    {task.dueDate && <div style={{ fontSize: '0.72rem', color: new Date(task.dueDate) < new Date() && col !== 'DONE' ? 'var(--accent-red)' : 'var(--text-muted)', marginTop: '0.2rem' }}>Due {new Date(task.dueDate).toLocaleDateString()}</div>}
                  </div>
                </Link>
              ))}
              {groupedTasks[col].length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>No tasks</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
