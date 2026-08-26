import path from 'path';
import { mkdir, copyFile, writeFile as fsWriteFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { isCloudSynced, defaultDatabasePath, backupDirFor } from '@/lib/db-location';

/** Get the configured storage base path.
 *  Priority: ONEDRIVE_PATH env var → storagePath from DB → local public/ fallback */
export async function getStorageBase(): Promise<string> {
  if (process.env.ONEDRIVE_PATH) {
    return process.env.ONEDRIVE_PATH;
  }
  // Read from DB if env not set
  try {
    const { prisma } = await import('@/lib/prisma');
    const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
    if (ws?.storagePath && existsSync(ws.storagePath)) {
      return ws.storagePath;
    }
  } catch { /* DB not ready yet */ }
  return path.join(process.cwd(), 'public');
}

/** Ensure a directory exists */
export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

/** Write a file to the configured storage + copy to public/ for serving */
export async function storeFile(
  bytes: Buffer,
  storedName: string,
  subDir: 'gels' | 'sequences'
): Promise<{ storagePath: string; publicPath: string }> {
  const base = await getStorageBase();
  const storageDir = path.join(base, 'uploads', subDir);
  await ensureDir(storageDir);

  const storagePath = path.join(storageDir, storedName);
  await fsWriteFile(storagePath, bytes);

  // Mirror to public/ so Next.js <img src> works
  const publicDir = path.join(process.cwd(), 'public', 'uploads', subDir);
  await ensureDir(publicDir);
  const publicFilePath = path.join(publicDir, storedName);
  await copyFile(storagePath, publicFilePath);

  return { storagePath, publicPath: `/uploads/${subDir}/${storedName}` };
}

/**
 * Write ONEDRIVE_PATH and DATABASE_URL into .env so they persist across restarts.
 *
 * The two go to different places on purpose. Uploads belong in the chosen
 * storage folder, including a synced one -- a gel image is written once and
 * sync copies it correctly. The database does not: see db-location.ts for why
 * a live SQLite file in OneDrive or Dropbox loses experiments silently. When
 * the chosen folder is synced, the database goes to the machine's own data
 * directory instead and only the uploads follow the user's choice.
 */
export async function persistStoragePath(storagePath: string) {
  const envPath = path.join(process.cwd(), '.env');
  let contents = '';
  try { contents = await readFile(envPath, 'utf8'); } catch { /* no .env yet */ }

  const synced = isCloudSynced(storagePath);
  const dbPath = synced
    ? defaultDatabasePath()
    : path.join(storagePath, 'database', 'genenet.db');

  // Update or add ONEDRIVE_PATH
  if (contents.includes('ONEDRIVE_PATH=')) {
    contents = contents.replace(/^ONEDRIVE_PATH=.*$/m, `ONEDRIVE_PATH="${storagePath}"`);
  } else {
    contents += `\nONEDRIVE_PATH="${storagePath}"`;
  }

  // Update or add DATABASE_URL
  if (contents.includes('DATABASE_URL=')) {
    contents = contents.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="file:${dbPath}"`);
  } else {
    contents += `\nDATABASE_URL="file:${dbPath}"`;
  }

  await fsWriteFile(envPath, contents.trim() + '\n');

  // Create folder structure. The database directory follows the database, which
  // is not necessarily under storagePath any more.
  await ensureDir(path.dirname(dbPath));
  await ensureDir(path.join(storagePath, 'uploads', 'gels'));
  await ensureDir(path.join(storagePath, 'uploads', 'sequences'));
  await ensureDir(path.join(storagePath, 'releases'));
  // Backups are finished files, so the synced folder is the right home for them.
  await ensureDir(backupDirFor(storagePath));

  // Copy current DB there if it doesn't exist yet
  const localDb = path.join(process.cwd(), 'prisma', 'dev.db');
  if (existsSync(localDb) && !existsSync(dbPath)) {
    await copyFile(localDb, dbPath);
  }
}
