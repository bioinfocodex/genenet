import { prisma } from '@/lib/prisma';
import { getMockUser } from '@/app/actions/auth';
import { getSeatInfo } from '@/app/actions/team';
import { redirect } from 'next/navigation';
import TeamClient from './client';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const me = await getMockUser();
  if (!me || me.role !== 'ADMIN') redirect('/');

  const [seats, users, invites] = await Promise.all([
    getSeatInfo(),
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.invite.findMany({
      where: { usedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } },
    }),
  ]);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem' }}>Team Management</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
          Manage members · Invite new users · Control seat usage
        </p>
      </div>
      <TeamClient
        seats={seats}
        users={users}
        invites={invites as any}
        currentUserId={me.id}
      />
    </div>
  );
}
