import { prisma } from '@/lib/prisma';
import { getMockUser, getWorkspaceSettings } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import AdminClient from './client';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [me, wsSettings, allUsers] = await Promise.all([
    getMockUser(),
    getWorkspaceSettings(),
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);

  if (!me || me.role !== 'ADMIN') redirect('/');

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem' }}>Admin Panel</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
          Manage user access · {allUsers.length} member{allUsers.length !== 1 ? 's' : ''}
        </p>
      </div>

      <AdminClient
        users={allUsers}
        currentUserId={me.id}
        connectionCode={wsSettings?.connectionCode ?? null}
        serverUrl={wsSettings?.serverUrl ?? null}
        workspaceName={wsSettings?.workspaceName ?? 'GeneNet Lab'}
      />
    </div>
  );
}
