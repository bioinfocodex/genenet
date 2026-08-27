import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { existsSync } from 'fs';
import { isCloudSynced, cloudProvider, describeDatabaseLocationRisk } from '../src/lib/db-location.ts';

/**
 * The point of these is the case that is invisible in the path text.
 *
 * A marker list catches ~/OneDrive and ~/Library/CloudStorage because the
 * provider's name is sitting right there. It cannot catch iCloud's "Desktop &
 * Documents Folders", which syncs ~/Desktop while leaving the path looking
 * entirely ordinary -- and that is the most common place on a Mac for a
 * project, so it is the one that actually loses people's data.
 */

describe('cloud sync detection', () => {
  test('named provider folders are caught', () => {
    for (const p of [
      '/Users/x/OneDrive - Acme/GeneNet/genenet.db',
      '/Users/x/Dropbox/lab/genenet.db',
      '/Users/x/Library/CloudStorage/GoogleDrive-x@y.com/genenet.db',
      'C:\\Users\\x\\OneDrive\\Desktop\\genenet.db',
      '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/genenet.db',
    ]) {
      assert.equal(isCloudSynced(p), true, p);
    }
  });

  test('an ordinary local path is not flagged', () => {
    for (const p of [
      '/Users/x/Library/Application Support/GeneNet/genenet.db',
      '/Users/x/Projects/lab/genenet.db',
      '/var/lib/genenet/genenet.db',
    ]) {
      assert.equal(isCloudSynced(p), false, p);
    }
  });

  test('the file: prefix does not hide a synced path', () => {
    assert.equal(isCloudSynced('file:/Users/x/Dropbox/g.db'), true);
  });

  test('a name that merely starts with Desktop is not inside it', () => {
    // Guards against a startsWith() implementation: ~/Desktopian is not ~/Desktop.
    const p = path.join(os.homedir(), 'Desktopian', 'notes.db');
    assert.equal(isCloudSynced(p), false);
  });

  // Only meaningful on a Mac that actually has the feature switched on.
  const mirrored = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop');
  const desktopIsSynced = process.platform === 'darwin' && existsSync(mirrored);

  test('iCloud Desktop & Documents is detected despite an ordinary-looking path', { skip: !desktopIsSynced }, () => {
    const p = path.join(os.homedir(), 'Desktop', 'lab', 'genenet.db');
    assert.equal(isCloudSynced(p), true);
    assert.match(cloudProvider(p) ?? '', /iCloud/);
    assert.notEqual(describeDatabaseLocationRisk(`file:${p}`), null);
  });

  test('the risk notice stays silent for a database that is fine', () => {
    assert.equal(describeDatabaseLocationRisk('file:/Users/x/Library/Application Support/GeneNet/genenet.db'), null);
  });

  test('a non-file datasource is not our problem', () => {
    assert.equal(describeDatabaseLocationRisk('postgresql://user@host:5432/genenet'), null);
    assert.equal(describeDatabaseLocationRisk(undefined), null);
  });
});
