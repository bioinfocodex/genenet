import 'server-only';
import path from 'path';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { backupDirFor, isCloudSynced } from '@/lib/db-location';

/**
 * Backups and export.
 *
 * Two different jobs, deliberately kept apart:
 *
 *   A backup is for getting this workspace running again after the disk dies
 *   or someone deletes the wrong thing. It has to be restorable, so it is a
 *   real SQLite file.
 *
 *   An export is for reading the lab's records without GeneNet -- moving to
 *   another tool, handing data to a collaborator, or satisfying a funder who
 *   wants the records in an open format. It is JSON, because a .db file is not
 *   something a person can open.
 *
 * Snapshots use SQLite's VACUUM INTO rather than copying the file. Copying a
 * live database is the mistake db-location.ts exists to prevent: the -wal and
 * -shm files carry committed data that has not landed in the main file yet, so
 * a plain copy can be a database that was never in that state. VACUUM INTO
 * asks SQLite for a consistent snapshot and writes one file, safe to take
 * while people are working.
 */

const BACKUP_PREFIX = 'genenet-';
const BACKUP_SUFFIX = '.db';

export interface BackupFile {
  name: string;
  path: string;
  bytes: number;
  createdAt: Date;
}

/** The configured storage root, or null when everything is local. */
async function storageRoot(): Promise<string | null> {
  if (process.env.ONEDRIVE_PATH) return process.env.ONEDRIVE_PATH;
  try {
    const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
    return ws?.storagePath ?? null;
  } catch {
    return null;
  }
}

export async function backupDir(): Promise<string> {
  const dir = backupDirFor(await storageRoot());
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Newest first. */
export async function listBackups(): Promise<BackupFile[]> {
  const dir = await backupDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter(n => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX))
      .map(async n => {
        const full = path.join(dir, n);
        const s = await stat(full);
        return { name: n, path: full, bytes: s.size, createdAt: s.mtime };
      }),
  );
  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Take a consistent snapshot. Returns the file written.
 *
 * SQLite will not VACUUM INTO a path that already exists, which also means two
 * backups started in the same second cannot silently overwrite one another.
 */
export async function createBackup(): Promise<BackupFile> {
  const dir = await backupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`);

  // VACUUM INTO takes a string literal, not a bound parameter. The path is
  // built here from a timestamp and configured directory, never user input,
  // and the quote-doubling keeps a directory with an apostrophe from breaking
  // the statement.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const s = await stat(target);
  return { name: path.basename(target), path: target, bytes: s.size, createdAt: s.mtime };
}

/** Delete all but the newest `keep`. Returns how many went. */
export async function pruneBackups(keep = 14): Promise<number> {
  const all = await listBackups();
  const doomed = all.slice(keep);
  for (const f of doomed) {
    try { await unlink(f.path); } catch { /* already gone */ }
  }
  return doomed.length;
}

/** Every model that holds workspace data, in a sensible reading order. */
const EXPORTED_MODELS = [
  'workspaceSettings', 'user', 'project', 'experiment', 'task', 'taskStep',
  'taskComment', 'procedure', 'procedureStep', 'procedureMaterial',
  'procedureEquipment', 'procedureVersion', 'report', 'reportSection',
  'reportFigure', 'reportTable', 'reportTaskLink', 'geneSequence', 'primer',
  'simulation', 'protein', 'collection', 'collectionItem', 'freezer', 'sample',
  'gelSimulation', 'gelImage', 'bioreactorRun', 'bioreactorReading', 'activity',
  'invite',
] as const;

export interface WorkspaceExport {
  exportedAt: string;
  application: string;
  note: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/**
 * Everything in the workspace as JSON.
 *
 * Password hashes are removed. They are of no use in another tool, and an
 * export is the copy most likely to be emailed around or dropped in a shared
 * folder, so it should not carry credentials.
 */
export async function exportWorkspace(): Promise<WorkspaceExport> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const model of EXPORTED_MODELS) {
    const delegate = (prisma as unknown as Record<string, { findMany?: () => Promise<unknown[]> }>)[model];
    if (!delegate?.findMany) continue;
    try {
      const rows = await delegate.findMany();
      const cleaned = model === 'user'
        ? (rows as Record<string, unknown>[]).map(({ passwordHash: _drop, ...rest }) => rest)
        : rows;
      data[model] = cleaned;
      counts[model] = cleaned.length;
    } catch {
      // A model that is not in this database yet should not sink the export.
      data[model] = [];
      counts[model] = 0;
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    application: 'GeneNet',
    note:
      'Complete workspace export. One key per record type, each an array of rows, ' +
      'with the field names used by the application. Password hashes are omitted. ' +
      'Uploaded files (gel images and sequence attachments) are not inside this ' +
      'file; they live in the uploads folder of the configured storage location.',
    counts,
    data,
  };
}

/** For the admin screen: where backups go, and whether that is a sane place. */
export async function backupLocationInfo() {
  const dir = await backupDir();
  return {
    dir,
    synced: isCloudSynced(dir),
    // A backup is a finished file, so a sync folder is a good home for it --
    // the opposite of the live database.
    note: isCloudSynced(dir)
      ? 'Backups are written to your cloud sync folder, so they leave this machine automatically.'
      : 'Backups are written to this machine only. Copy them somewhere else as well.',
  };
}
