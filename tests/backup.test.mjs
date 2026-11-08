import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBackup, inspectBackup, restoreBackup, rollbackRestore, commitRestore } from '../electron/backup.cjs';

const databaseBytes = (label) => Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from(label)]);
const imageName = '123e4567-e89b-12d3-a456-426614174000.png';
const jpegName = '123e4567-e89b-12d3-a456-426614174001.jpg';
const webpName = '123e4567-e89b-12d3-a456-426614174002.webp';

async function createDataDirectory(parent, label) {
  const directory = path.join(parent, label);
  await mkdir(path.join(directory, 'assets'), { recursive: true });
  await writeFile(path.join(directory, 'studio.sqlite'), databaseBytes(label));
  await writeFile(path.join(directory, 'assets', imageName), Buffer.from(`asset-${label}`));
  return directory;
}

test('backup is portable, verifies checksums and restores projects plus image assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iadesign-backup-'));
  try {
    const source = await createDataDirectory(root, 'source');
    await writeFile(path.join(source, 'assets', jpegName), Buffer.from('jpeg-asset-source'));
    await writeFile(path.join(source, 'assets', webpName), Buffer.from('webp-asset-source'));
    const destination = path.join(root, 'backups');
    const backup = await createBackup(source, destination, '1.0.0');
    const verified = await inspectBackup(backup.backupDirectory);
    assert.equal(verified.manifest.appVersion, '1.0.0');
    assert.equal(verified.manifest.assets.length, 3);
    assert.match(verified.manifest.credentials, /not included/);
    assert.equal(backup.totalBytes,
      (await readFile(path.join(backup.backupDirectory, 'studio.sqlite'))).length
      + (await readFile(path.join(backup.backupDirectory, 'assets', imageName))).length
      + (await readFile(path.join(backup.backupDirectory, 'assets', jpegName))).length
      + (await readFile(path.join(backup.backupDirectory, 'assets', webpName))).length);

    const target = await createDataDirectory(root, 'target');
    const restore = await restoreBackup(backup.backupDirectory, target);
    assert.deepEqual(await readFile(path.join(target, 'studio.sqlite')), databaseBytes('source'));
    assert.deepEqual(await readFile(path.join(target, 'assets', imageName)), Buffer.from('asset-source'));
    assert.deepEqual(await readFile(path.join(target, 'assets', jpegName)), Buffer.from('jpeg-asset-source'));
    assert.deepEqual(await readFile(path.join(target, 'assets', webpName)), Buffer.from('webp-asset-source'));
    assert.deepEqual(await readFile(path.join(restore.rollbackDirectory, 'studio.sqlite')), databaseBytes('target'));
    await commitRestore(restore.rollbackDirectory);
    await assert.rejects(readdir(restore.rollbackDirectory), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tampered backups are rejected before destination data is changed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iadesign-backup-tamper-'));
  try {
    const source = await createDataDirectory(root, 'source');
    const backup = await createBackup(source, path.join(root, 'backups'), '1.0.0');
    await writeFile(path.join(backup.backupDirectory, 'assets', imageName), Buffer.from('tampered'));
    const target = await createDataDirectory(root, 'target');
    await assert.rejects(restoreBackup(backup.backupDirectory, target), /checksum validation failed/);
    assert.deepEqual(await readFile(path.join(target, 'studio.sqlite')), databaseBytes('target'));
    assert.deepEqual(await readFile(path.join(target, 'assets', imageName)), Buffer.from('asset-target'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore rollback returns the previous database and assets after recovery failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iadesign-backup-rollback-'));
  try {
    const source = await createDataDirectory(root, 'source');
    const backup = await createBackup(source, path.join(root, 'backups'), '1.0.0');
    const target = await createDataDirectory(root, 'target');
    const restore = await restoreBackup(backup.backupDirectory, target);
    await rollbackRestore(restore.rollbackDirectory, target);
    assert.deepEqual(await readFile(path.join(target, 'studio.sqlite')), databaseBytes('target'));
    assert.deepEqual(await readFile(path.join(target, 'assets', imageName)), Buffer.from('asset-target'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
