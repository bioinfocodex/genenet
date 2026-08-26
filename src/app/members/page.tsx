import { prisma } from '@/lib/prisma';
import { Mail, CheckSquare, Beaker } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const users = await prisma.user.findMany({
    where: { status: { not: 'REMOVED' } },
    include: {
      tasksAssigned: true,
      experiments: true
    }
  });

  return (
    <div>
      <h1 className="title-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>Lab Members Directory</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
         {users.map(user => (
           <div key={user.id} className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', background: 'var(--accent-blue-15)', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 {user.avatar}
              </div>
              <h3 style={{ fontSize: '1.25rem', margin: 0, color: 'var(--text-primary)' }}>{user.name}</h3>
              <span className="badge badge-blue" style={{ marginTop: '0.5rem' }}>{user.role}</span>
              
              <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                 <Mail size={14} /> {user.email}
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem', padding: '1rem 0', width: '100%', borderTop: '1px solid var(--glass-border)', justifyContent: 'center' }}>
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
                       <CheckSquare size={16} /> Tasks
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-blue)' }}>
                       {user.tasksAssigned.length}
                    </div>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
                       <Beaker size={16} /> Logs
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-purple)' }}>
                       {user.experiments.length}
                    </div>
                 </div>
              </div>
           </div>
         ))}
      </div>
    </div>
  );
}
