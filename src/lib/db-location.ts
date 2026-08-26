import path from 'path';
import os from 'os';

/**
 * Where the SQLite database is allowed to live.
 *
 * Uploaded files and a cloud sync folder get along fine: a gel image is written
 * once and never touched again, so the sync client only ever sees a finished
 * file. A live SQLite database is the opposite case, and putting one inside
 * OneDrive, Dropbox, Google Drive or iCloud loses data in three separate ways:
 *
 *  1. A database is not one file. SQLite keeps -wal and -shm alongside it, and
 *     they are only meaningful as a set. A sync client uploads them
 *     independently, whenever each one happens to settle, so the copy that
 *     lands in the cloud is routinely a mix of two different moments.
 *
 *  2. SQLite's locking is filesystem-local. It cannot coordinate between two
 *     machines, so if two people open the same synced database at once, both
 *     write. The sync client resolves that the only way it can -- by keeping
 *     one and renaming the other to a conflict copy such as
 *     "genenet-DESKTOP-AB12.db". No error is shown. Whoever synced last wins,
 *     and the other person's experiments sit in a file nobody opens again.
 *
 *  3. Files On-Demand can evict a file that has not been touched recently,
 *     replacing it with a placeholder that has to be downloaded on access.
 *     A database being read mid-query does not survive that.
 *
 * So: files in the sync folder, database on the local disk. Backups are the
 * right thing to write into the sync folder, because a backup is a finished
 * file -- exactly the shape sync handles well.
 */

/** Path segments that mean "a sync client owns this directory". */
const CLOUD_SYNC_MARKERS = [
  'onedrive',
  'dropbox',
  'google drive',
  'googledrive',
  'my drive',
  'icloud drive',
  'com~apple~clouddocs',
  'box sync',
  'boxdrive',
  'pcloud',
  'mega',
  'sync.com',
  'nextcloud',
  'owncloud',
  'creative cloud files',
  'cloudstorage', // macOS puts every provider under ~/Library/CloudStorage
];

/** True if the path sits inside a folder a sync client manages. */
export function isCloudSynced(target: string): boolean {
  const p = target.replace(/^file:/, '').toLowerCase();
  return CLOUD_SYNC_MARKERS.some(m => p.includes(m));
}

/** Which provider it looks like, for a message a person can act on. */
export function cloudProvider(target: string): string | null {
  const p = target.replace(/^file:/, '').toLowerCase();
  if (p.includes('onedrive')) return 'OneDrive';
  if (p.includes('dropbox')) return 'Dropbox';
  if (p.includes('google drive') || p.includes('googledrive') || p.includes('my drive')) return 'Google Drive';
  if (p.includes('icloud') || p.includes('clouddocs')) return 'iCloud Drive';
  if (p.includes('box sync') || p.includes('boxdrive')) return 'Box';
  if (p.includes('nextcloud') || p.includes('owncloud')) return 'Nextcloud';
  return isCloudSynced(p) ? 'a cloud sync folder' : null;
}

/**
 * The per-machine data directory, following each platform's convention so the
 * file ends up somewhere backup tools already know about and sync clients do
 * not.
 */
export function appDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'GeneNet');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'GeneNet');
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'GeneNet');
  }
}

/** Where a new install should put its database. */
export function defaultDatabasePath(): string {
  return path.join(appDataDir(), 'genenet.db');
}

/** Where scheduled backups belong: a finished file, safe to sync. */
export function backupDirFor(storagePath: string | null): string {
  return storagePath ? path.join(storagePath, 'backups') : path.join(appDataDir(), 'backups');
}

/**
 * The warning shown when an existing install is already pointed at a synced
 * folder. Returns null when the location is fine.
 */
export function describeDatabaseLocationRisk(databaseUrl: string | undefined): string | null {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) return null; // Postgres etc.
  if (!isCloudSynced(databaseUrl)) return null;

  const provider = cloudProvider(databaseUrl) ?? 'a cloud sync folder';
  const file = databaseUrl.replace(/^file:/, '');
  return [
    '',
    '  ┌─────────────────────────────────────────────────────────────────────┐',
    '  │  The GeneNet database is inside a folder that syncs to the cloud.   │',
    '  └─────────────────────────────────────────────────────────────────────┘',
    `  Provider looks like: ${provider}`,
    `  Database file:       ${file}`,
    '',
    '  This will lose data. A live SQLite database is three files that only',
    '  make sense together, the sync client uploads them separately, and if two',
    '  machines open it at once the client silently keeps one copy and renames',
    '  the other to a conflict file. Nothing reports an error when that happens.',
    '',
    '  Move it to a local disk and point DATABASE_URL there:',
    `      ${defaultDatabasePath()}`,
    '',
    '  Uploaded files can stay in the sync folder -- those are written once and',
    '  sync handles them correctly. Only the live database has to move.',
    '',
  ].join('\n');
}
