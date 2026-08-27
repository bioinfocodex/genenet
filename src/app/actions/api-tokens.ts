'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guard';
import { generateToken } from '@/lib/api-auth';

/**
 * API tokens are admin-managed. A token can read or write everything the API
 * exposes, so handing one out is a decision about the whole workspace.
 */

export async function listApiTokens() {
  await requireAdmin();
  const rows = await prisma.apiToken.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(t => ({
    id: t.id, name: t.name, prefix: t.prefix, scope: t.scope,
    ownerEmail: t.ownerEmail,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    revoked: !!t.revokedAt,
  }));
}

export async function createApiToken(formData: FormData):
  Promise<{ ok: true; token: string; name: string } | { error: string }> {
  const admin = await requireAdmin();

  const name = ((formData.get('name') as string) ?? '').trim();
  const scope = (formData.get('scope') as string) === 'write' ? 'write' : 'read';
  const days = Number(formData.get('expiresInDays') ?? 0);

  if (!name) return { error: 'Give the token a name, so you know what to revoke later.' };

  const { token, hash, prefix } = generateToken();
  await prisma.apiToken.create({
    data: {
      name, tokenHash: hash, prefix, scope,
      ownerId: admin.id, ownerEmail: admin.email,
      expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
    },
  });

  revalidatePath('/admin');
  // The only time the plaintext exists outside the caller's script.
  return { ok: true, token, name };
}

export async function revokeApiToken(formData: FormData) {
  await requireAdmin();
  const id = (formData.get('id') as string) ?? '';
  if (!id) return { error: 'No token specified.' };
  // Revoked rather than deleted: the audit trail refers to it, and knowing a
  // token existed and was withdrawn is part of the record.
  await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  revalidatePath('/admin');
  return { ok: true as const };
}
