'use server';
import { prisma } from '@/lib/prisma';
import { createSession, deleteSession, getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { persistStoragePath } from '@/lib/storage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const buf = scryptSync(password, salt, 64);
  return timingSafeEqual(buf, Buffer.from(hash, 'hex'));
}

function generateInviteCode(): string {
  return randomBytes(4).toString('hex').toUpperCase(); // e.g. "A3F2B1C9"
}

function generateSystemId(): string {
  return 'SYS-' + randomBytes(3).toString('hex').toUpperCase(); // e.g. SYS-A3F2B1
}

function generateConnectionCode(): string {
  const num = Math.floor(10000 + Math.random() * 90000);
  return `LAB-${num}`; // e.g. LAB-48291
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Used internally by pages to get the logged-in user. */
export async function getMockUser() {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
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

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { error: 'Invalid email or password.' };
  }

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

  // Validate invite code
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite) return { error: 'Invalid invite code.' };
  if (invite.usedAt) return { error: 'This invite code has already been used.' };
  if (invite.expiresAt && invite.expiresAt < new Date()) return { error: 'This invite code has expired.' };

  // Enforce seat limit
  const [ws, activeUserCount] = await Promise.all([
    prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } }),
    prisma.user.count({ where: { status: { not: 'REMOVED' } } }),
  ]);
  if (ws && activeUserCount >= ws.seatLimit) {
    return { error: `User limit reached (${ws.seatLimit} seats). Contact your lab administrator to upgrade.` };
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
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') throw new Error('Unauthorized.');

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
      createdById: session.userId,
    },
  });

  revalidatePath('/settings');
}

export async function revokeInvite(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') throw new Error('Unauthorized.');
  const id = formData.get('id') as string;
  await prisma.invite.delete({ where: { id } });
  revalidatePath('/settings');
}

export async function getWorkspaceInfo() {
  return prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
}

// ─── Admin: User Access Control ───────────────────────────────────────────────

async function requireAdmin() {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized.');
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.role !== 'ADMIN') throw new Error('Unauthorized.');
  return { ...session, role: user.role };
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
  const num = Math.floor(10000 + Math.random() * 90000);
  const code = `LAB-${num}`;
  await prisma.workspaceSettings.update({ where: { id: 'workspace' }, data: { connectionCode: code } });
  revalidatePath('/admin');
  revalidatePath('/settings');
}
