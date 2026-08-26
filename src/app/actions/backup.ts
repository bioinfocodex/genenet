'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth-guard';
import {
  createBackup, listBackups, pruneBackups, backupLocationInfo,
} from '@/lib/backup';

/**
 * Backups are an admin action: a snapshot contains every record in the
 * workspace, so taking one, listing them, or reading where they are kept is
 * not something a member should be able to do.
 */

export async function getBackupState() {
  await requireAdmin();
  const [backups, location] = await Promise.all([listBackups(), backupLocationInfo()]);
  return {
    location,
    backups: backups.map(b => ({
      name: b.name,
      bytes: b.bytes,
      createdAt: b.createdAt.toISOString(),
    })),
  };
}

export async function backUpNow(): Promise<{ ok: true; name: string; bytes: number } | { error: string }> {
  await requireAdmin();
  try {
    const file = await createBackup();
    await pruneBackups();
    revalidatePath('/admin');
    revalidatePath('/settings');
    return { ok: true, name: file.name, bytes: file.bytes };
  } catch (e) {
    // Surface the reason. "Backup failed" with no cause is the kind of message
    // that gets ignored until the day it matters.
    return { error: e instanceof Error ? e.message : 'Backup failed for an unknown reason.' };
  }
}
