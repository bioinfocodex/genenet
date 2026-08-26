import 'server-only';
import { createBackup, listBackups, pruneBackups } from '@/lib/backup';

/**
 * Automatic daily backup.
 *
 * A button an admin has to remember to press is not a backup strategy, and a
 * lab notebook is exactly the kind of software where nobody thinks about
 * backups until the morning they need one. This runs in the server process:
 * GeneNet is installed on a lab machine rather than deployed to a platform
 * with a scheduler, so there is nowhere else to put it.
 *
 * Deliberately unclever:
 *  - checks hourly, backs up only when the newest backup is over a day old,
 *    so restarting the server does not produce a pile of snapshots
 *  - skips when a backup is already running
 *  - unref()s the timer, so it never holds the process open on shutdown
 *  - failures are logged, never thrown; a failed backup must not take the
 *    server down with it
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;   // hourly
const BACKUP_AFTER_MS = 24 * 60 * 60 * 1000; // a day since the last one
const KEEP = 14;

const globalForSchedule = global as unknown as {
  genenetBackupTimer?: NodeJS.Timeout;
  genenetBackupRunning?: boolean;
};

async function backupIfDue() {
  if (globalForSchedule.genenetBackupRunning) return;
  globalForSchedule.genenetBackupRunning = true;
  try {
    const existing = await listBackups();
    const newest = existing[0];
    if (newest && Date.now() - newest.createdAt.getTime() < BACKUP_AFTER_MS) return;

    const file = await createBackup();
    const pruned = await pruneBackups(KEEP);
    console.log(
      `[genenet] backup ${file.name} (${(file.bytes / 1024).toFixed(0)} KB)` +
      (pruned ? `, pruned ${pruned} old` : ''),
    );
  } catch (e) {
    console.error('[genenet] automatic backup failed:', e instanceof Error ? e.message : e);
  } finally {
    globalForSchedule.genenetBackupRunning = false;
  }
}

/** Idempotent: safe to call on every request path or hot reload. */
export function startBackupSchedule() {
  if (globalForSchedule.genenetBackupTimer) return;

  const timer = setInterval(() => { void backupIfDue(); }, CHECK_EVERY_MS);
  timer.unref?.();
  globalForSchedule.genenetBackupTimer = timer;

  // One check shortly after boot, so a machine that is only switched on for a
  // few hours a day still gets backed up. Delayed so it does not compete with
  // startup work.
  const first = setTimeout(() => { void backupIfDue(); }, 60 * 1000);
  first.unref?.();
}
