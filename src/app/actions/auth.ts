'use server';
import { prisma } from '@/lib/prisma';
import { createSession, deleteSession, getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomBytes, randomInt } from 'crypto';
import { hashPassword, verifyPassword } from '@/lib/password';
import { persistStoragePath } from '@/lib/storage';
import { getCurrentUser, requireAdmin as sharedRequireAdmin } from '@/lib/auth-guard';
import { headers } from 'next/headers';
import {
  POLICIES, checkLimit, recordFailure, recordSuccess,
  failureDelay, describeWait, clientKey, logAttempt,
} from '@/lib/rate-limit';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateInviteCode(): string {
  return randomBytes(4).toString('hex').toUpperCase(); // e.g. "A3F2B1C9"
}

function generateSystemId(): string {
  return 'SYS-' + randomBytes(3).toString('hex').toUpperCase(); // e.g. SYS-A3F2B1
}

function generateConnectionCode(): string {
  // randomInt, not Math.random: Math.random is not a cryptographic generator,
  // and its output is predictable from prior values. This code is what stands
  // between the network and knowing where the workspace is.
  const num = randomInt(10000, 100000);
  return `LAB-${num}`; // e.g. LAB-48291
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Used internally by pages to get the logged-in user. */
/**
 * The signed-in user, or null. Delegates to getCurrentUser so that a blocked or
 * removed member stops being "signed in" on their next request rather than when
 * their seven-day token expires.
 *
 * Named getMockUser when the app used a hard-coded user; it does real work now.
 */
export async function getMockUser() {
  return getCurrentUser();
}

export async function getAllUsers() {
  return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
}

// ─── First-run setup ─────────────────────────────────────────────────────────

export async function isSetupComplete(): Promise<boolean> {
  const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
  return !!ws?.isSetupComplete;
}

export async function setupWorkspace(_prevState: { error?: string } | undefined, formData: FormData) {
  const workspaceName = (formData.get('workspaceName') as string).trim();
  const adminName     = (formData.get('adminName') as string).trim();
  const email         = (formData.get('email') as string).trim().toLowerCase();
  const password      = formData.get('password') as string;
  const storageType   = (formData.get('storageType') as string | null) || 'local';
  const storagePath   = (formData.get('storagePath') as string | null)?.trim() || null;
  const storageNote   = (formData.get('storageNote') as string | null)?.trim() || null;
  const serverUrl     = (formData.get('serverUrl') as string | null)?.trim() || null;
  const plan          = (formData.get('plan') as string | null) || 'starter';
  const seatLimit     = parseInt((formData.get('seatLimit') as string | null) ?? '5') || 5;

  if (!workspaceName || !adminName || !email || !password) {
    return { error: 'All fields are required.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const existing = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
  if (existing?.isSetupComplete) {
    return { error: 'Workspace is already set up.' };
  }

  const passwordHash     = hashPassword(password);
  const systemId         = generateSystemId();
  const connectionCode   = generateConnectionCode();

  const admin = await prisma.user.create({
    data: { name: adminName, email, passwordHash, role: 'ADMIN', avatar: '👩‍🔬' },
  });

  await prisma.workspaceSettings.upsert({
    where:  { id: 'workspace' },
    create: { id: 'workspace', workspaceName, adminId: admin.id, isSetupComplete: true, storageNote, storageType, storagePath, systemId, connectionCode, serverUrl, plan, seatLimit },
    update: { workspaceName, adminId: admin.id, isSetupComplete: true, storageNote, storageType, storagePath, systemId, connectionCode, serverUrl, plan, seatLimit },
  });

  // If OneDrive/network path given, write it to .env and create folder structure
  if (storagePath && (storageType === 'onedrive' || storageType === 'network')) {
    await persistStoragePath(storagePath);
  }

  await createSession(admin.id, 'ADMIN');
  redirect('/');
}


export async function getWorkspaceSettings() {
  return prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const email    = (formData.get('email') as string).trim().toLowerCase();
  const password = formData.get('password') as string;

  // Same reasoning as the connection code: an unauthenticated endpoint that
  // says yes or no to a secret has to cost something to get wrong.
  const key = clientKey(await headers(), 'login');
  const gate = checkLimit(key, POLICIES.login);
  if (!gate.allowed) {
    logAttempt('login', key, 'locked');
    return { error: `Too many sign-in attempts. Try again in ${describeWait(gate.retryAfterMs)}.` };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    const after = recordFailure(key, POLICIES.login);
    logAttempt('login', key, after.allowed ? 'failed' : 'locked');
    await failureDelay();
    return {
      error: after.allowed
        ? 'Invalid email or password.'
        : `Invalid email or password. Too many attempts -- try again in ${describeWait(after.retryAfterMs)}.`,
    };
  }

  recordSuccess(key);

  if (user.status === 'BLOCKED') {
    return { error: 'Access revoked by admin. Contact your lab administrator.' };
  }
  if (user.status === 'REMOVED') {
    return { error: 'Your account has been removed. Request a new invite code from your admin.' };
  }

  await createSession(user.id, user.role);
  redirect('/');
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout() {
  await deleteSession();
  redirect('/login');
}

// ─── Register with invite code ────────────────────────────────────────────────

export async function register(_prevState: { error?: string } | undefined, formData: FormData) {
  const name     = (formData.get('name') as string).trim();
  const email    = (formData.get('email') as string).trim().toLowerCase();
  const password = formData.get('password') as string;
  const code     = (formData.get('inviteCode') as string).trim().toUpperCase();

  if (!name || !email || !password || !code) {
    return { error: 'All fields are required.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  // Validate invite code. A correct guess here creates a real account, which
  // makes it the most valuable thing on the server to guess at.
  const key = clientKey(await headers(), 'invite-code');
  const gate = checkLimit(key, POLICIES.inviteCode);
  if (!gate.allowed) {
    logAttempt('invite-code', key, 'locked');
    return { error: `Too many attempts. Try again in ${describeWait(gate.retryAfterMs)}.` };
  }

  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite) {
    const after = recordFailure(key, POLICIES.inviteCode);
    logAttempt('invite-code', key, after.allowed ? 'failed' : 'locked');
    await failureDelay();
    return {
      error: after.allowed
        ? 'Invalid invite code.'
        : `Invalid invite code. Too many attempts -- try again in ${describeWait(after.retryAfterMs)}.`,
    };
  }
  recordSuccess(key);
  if (invite.usedAt) return { error: 'This invite code has already been used.' };
  if (invite.expiresAt && invite.expiresAt < new Date()) return { error: 'This invite code has expired.' };

  // Enforce seat limit
  const [ws, activeUserCount] = await Promise.all([
    prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } }),
    prisma.user.count({ where: { status: { not: 'REMOVED' } } }),
  ]);
  if (ws && activeUserCount >= ws.seatLimit) {
    return { error: `This workspace is set to ${ws.seatLimit} members and is full. Ask your lab administrator to raise the team size.` };
  }

  // Check email not already taken
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: 'An account with this email already exists.' };

  const passwordHash = hashPassword(password);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: 'MEMBER', avatar: '🧬' },
  });

  await prisma.invite.update({
    where: { code },
    data: { usedAt: new Date(), usedByName: name },
  });

  await createSession(user.id, user.role);
  redirect('/');
}

// ─── Invite management (admin only) ──────────────────────────────────────────

export async function createInvite(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== 'ADMIN') throw new Error('Unauthorized.');

  const email     = (formData.get('email') as string | null)?.trim().toLowerCase() || null;
  const expiresIn = formData.get('expiresIn') as string; // "7d" | "30d" | "never"

  let expiresAt: Date | null = null;
  if (expiresIn === '7d')  expiresAt = new Date(Date.now() + 7  * 24 * 60 * 60 * 1000);
  if (expiresIn === '30d') expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.invite.create({
    data: {
      code: generateInviteCode(),
      email: email || null,
      expiresAt,
      createdById: actor.id,
    },
  });

  revalidatePath('/settings');
}

export async function revokeInvite(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== 'ADMIN') throw new Error('Unauthorized.');
  const id = formData.get('id') as string;
  await prisma.invite.delete({ where: { id } });
  revalidatePath('/settings');
}

export async function getWorkspaceInfo() {
  return prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
}

// ─── Admin: User Access Control ───────────────────────────────────────────────

// Read the role from the database, and refuse a blocked admin: the shared
// guard does both.
async function requireAdmin() {
  const user = await sharedRequireAdmin();
  return { userId: user.id, role: user.role };
}

export async function blockUser(formData: FormData) {
  await requireAdmin();
  const userId = formData.get('userId') as string;
  await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
  revalidatePath('/admin');
}

export async function removeUser(formData: FormData) {
  await requireAdmin();
  const userId = formData.get('userId') as string;
  await prisma.user.update({ where: { id: userId }, data: { status: 'REMOVED' } });
  revalidatePath('/admin');
}

export async function restoreUser(formData: FormData) {
  await requireAdmin();
  const userId = formData.get('userId') as string;
  await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  revalidatePath('/admin');
}

export async function promoteToAdmin(formData: FormData) {
  await requireAdmin();
  const userId = formData.get('userId') as string;
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  revalidatePath('/admin');
}

export async function demoteToMember(formData: FormData) {
  const session = await requireAdmin();
  const userId = formData.get('userId') as string;
  if (userId === session.userId) throw new Error('Cannot demote yourself.');
  await prisma.user.update({ where: { id: userId }, data: { role: 'MEMBER' } });
  revalidatePath('/admin');
}

// ─── Connection code validation (for /connect page) ──────────────────────────

export async function validateConnectionCode(formData: FormData) {
  const code = (formData.get('code') as string).trim().toUpperCase();
  const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
  if (!ws?.connectionCode || ws.connectionCode !== code) {
    return { error: 'Invalid connection code.' };
  }
  return { success: true, serverUrl: ws.serverUrl, workspaceName: ws.workspaceName };
}

export async function regenerateConnectionCode() {
  await requireAdmin();
  // Was a second copy of the generator, still on Math.random, so every code an
  // admin rotated to was weaker than the one setup produced. Call the one
  // implementation instead.
  const code = generateConnectionCode();
  await prisma.workspaceSettings.update({ where: { id: 'workspace' }, data: { connectionCode: code } });
  revalidatePath('/admin');
  revalidatePath('/settings');
}
