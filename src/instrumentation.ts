/**
 * Runs once when the server process starts.
 *
 * The guard matters: this file is also evaluated for the edge runtime, where
 * neither timers of this kind nor the Prisma client belong. The import is
 * dynamic so nothing server-only is pulled into a bundle that cannot use it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Before anything else touches the database: journal mode is persistent, so
  // this is a one-off that every later connection inherits.
  const { applySqliteTuning } = await import('@/lib/sqlite-tuning');
  await applySqliteTuning();

  const { startBackupSchedule } = await import('@/lib/backup-schedule');
  startBackupSchedule();
}
