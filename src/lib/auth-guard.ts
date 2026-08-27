import 'server-only';
import { cache } from 'react';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';

/**
 * Authorisation, resolved against the database rather than the session token.
 *
 * The session is a 7-day JWT carrying `userId` and `role`. Trusting the claims
 * inside it means an admin who is demoted stays an admin, and a member who is
 * blocked keeps working, until their token happens to expire. The workspace
 * admin panel offers "block", "remove" and "promote" as if they take effect
 * immediately, so the token can be trusted for identity only -- role and status
 * are read fresh on every request.
 *
 * Everything that reads or writes lab data goes through one of these.
 */

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * The signed-in, still-active user -- or null. Never throws.
 *
 * Memoised for the lifetime of one request with React's cache(). Every guarded
 * action already calls this once; the audit trail now calls it again on every
 * mutation, and without memoisation that would be a session verify plus a user
 * lookup per write.
 */
export const getCurrentUser = cache(async function getCurrentUser() {
  const session = await getSession();
  if (!session?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, status: true, avatar: true },
  });

  // Deleted between issuing the token and using it.
  if (!user) return null;

  // BLOCKED and REMOVED lose access on their next request, not in seven days.
  if (user.status !== 'ACTIVE') return null;

  return user;
});

/** For server actions: the active user, or an exception that aborts the action. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  return user;
}

/** For server actions that only admins may run. */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new Error('Admins only.');
  return user;
}

/**
 * For route handlers, which must answer with a status code rather than throw.
 * Returns either the user or the response to send back, so a caller reads:
 *
 *   const auth = await requireApiUser();
 *   if ('response' in auth) return auth.response;
 *   // auth.user is active
 */
export async function requireApiUser(): Promise<
  { user: CurrentUser } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json(
        { error: 'Sign in to use this endpoint.' },
        { status: 401 },
      ),
    };
  }
  return { user };
}

/** Route-handler variant for admin-only endpoints. */
export async function requireApiAdmin(): Promise<
  { user: CurrentUser } | { response: NextResponse }
> {
  const auth = await requireApiUser();
  if ('response' in auth) return auth;
  if (auth.user.role !== 'ADMIN') {
    return {
      response: NextResponse.json({ error: 'Admins only.' }, { status: 403 }),
    };
  }
  return auth;
}
