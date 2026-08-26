import { prisma } from '@/lib/prisma';
import { Activity, Beaker, CheckCircle, BookOpen, FolderKanban } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [activities, recentExperiments, activeTasks, activeProjects, procedureCount] = await Promise.all([
    prisma.activity.findMany({ include: { user: true }, orderBy: { timestamp: 'desc' }, take: 10 }),
    prisma.experiment.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.task.count({ where: { status: { not: 'DONE' } } }),
    prisma.project.count({ where: { status: 'ACTIVE' } }),
    prisma.procedure.count({ where: { isArchived: false } }),
  ]);

  return (
    <div>
      <h1 className="title-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>Lab Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
         <Link href="/tasks" style={{ textDecoration: 'none' }}>
           <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }}>
             <h3 style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Active Tasks</h3>
             <div style={{ fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <CheckCircle color="var(--accent-green)" size={28} /> {activeTasks}
             </div>
           </div>
         </Link>
         <Link href="/projects" style={{ textDecoration: 'none' }}>
           <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }}>
             <h3 style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Active Projects</h3>
             <div style={{ fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <FolderKanban color="var(--accent-blue)" size={28} /> {activeProjects}
             </div>
           </div>
         </Link>
         <Link href="/procedures" style={{ textDecoration: 'none' }}>
           <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }}>
             <h3 style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Procedures</h3>
             <div style={{ fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <BookOpen color="var(--accent-purple)" size={28} /> {procedureCount}
             </div>
           </div>
         </Link>
         <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Lab Activities Today</h3>
            <div style={{ fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <Activity color="var(--accent-orange)" size={28} /> {activities.length}
            </div>
         </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
         {/* Activities Feed */}
         <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <Activity size={20} color="var(--accent-blue)" /> Lab Activity Feed
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
               {activities.map(act => (
                  <div key={act.id} className="glass-card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                     <div style={{ fontSize: '1.5rem', background: 'var(--bg-primary)', padding: '0.5rem', borderRadius: '50%' }}>{act.user.avatar}</div>
                     <div>
                       <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                         <strong style={{ fontWeight: 600 }}>{act.user.name}</strong> {act.action} <strong style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{act.target}</strong>
                       </div>
                       <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                         {new Date(act.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                       </div>
                     </div>
                  </div>
               ))}
               {activities.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No recent activity.</p>}
            </div>
         </div>

         {/* Recent Experiments */}
         <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <Beaker size={20} color="var(--accent-purple)" /> Recent Protocols
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
               {recentExperiments.map(exp => (
                  <div key={exp.id} style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
                     <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exp.title}</span>
                        <span className={`badge ${exp.status === 'COMPLETED' ? 'badge-green' : exp.status === 'IN_PROGRESS' ? 'badge-purple' : 'badge-orange'}`}>
                           {exp.status.replace('_', ' ')}
                        </span>
                     </div>
                     <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                        <span>Protocol: <strong>{exp.protocol}</strong></span>
                        <span>{exp.user.name}</span>
                     </div>
                  </div>
               ))}
               {recentExperiments.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No experiments logged.</p>}
            </div>
         </div>
      </div>
    </div>
  );
}
