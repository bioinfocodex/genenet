/**
 * Runs once when the server process starts.
 *
 * The guard matters: this file is also evaluated for the edge runtime, where
 * neither timers of this kind nor the Prisma client belong. The import is
 * dynamic so nothing server-only is pulled into a bundle that cannot use it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startBackupSchedule } = await import('@/lib/backup-schedule');
  startBackupSchedule();
}
