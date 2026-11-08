const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT_VERSION = 1;
const MAX_ASSET_COUNT = 100_000;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000');

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = require('node:fs').createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function listAssetFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (entries.length > MAX_ASSET_COUNT) throw new Error('Backup contains too many assets.');
  const assets = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.(?:png|jpe?g|webp)$/i.test(entry.name)) throw new Error('Asset folders may contain only regular PNG, JPEG, or WebP asset files.');
    const filePath = path.join(directory, entry.name);
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || stat.size > MAX_ASSET_BYTES) throw new Error('An asset is linked or exceeds the backup size limit.');
    assets.push({ name: entry.name, size: stat.size, sha256: await sha256(filePath) });
  }
  assets.sort((left, right) => left.name.localeCompare(right.name));
  return assets;
}

async function inspectBackup(backupDirectory) {
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 20 * 1024 * 1024) throw new Error('Backup manifest is invalid.');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.formatVersion !== FORMAT_VERSION || typeof manifest.appVersion !== 'string' || typeof manifest.createdAt !== 'string') throw new Error('This backup version is not supported.');
  if (!manifest.database || !/^[a-f0-9]{64}$/.test(manifest.database.sha256) || !Number.isSafeInteger(manifest.database.size) || manifest.database.size < SQLITE_HEADER.length || manifest.database.size > MAX_TOTAL_BYTES) throw new Error('Backup database metadata is invalid.');
  if (!Array.isArray(manifest.assets) || manifest.assets.length > MAX_ASSET_COUNT) throw new Error('Backup asset list is invalid.');
  const databasePath = path.join(backupDirectory, 'studio.sqlite');
  const databaseStat = await fs.lstat(databasePath);
  if (!databaseStat.isFile() || databaseStat.isSymbolicLink() || databaseStat.size !== manifest.database.size) throw new Error('Backup database file is missing or has changed.');
  const database = await fs.open(databasePath, 'r');
  const header = Buffer.alloc(SQLITE_HEADER.length);
  await database.read(header, 0, header.length, 0);
  await database.close();
  if (!header.equals(SQLITE_HEADER) || await sha256(databasePath) !== manifest.database.sha256) throw new Error('Backup database checksum validation failed.');
  const assetDirectory = path.join(backupDirectory, 'assets');
  const actualAssets = await listAssetFiles(assetDirectory);
  const listedAssets = [...manifest.assets].sort((left, right) => String(left?.name).localeCompare(String(right?.name)));
  if (actualAssets.length !== listedAssets.length) throw new Error('Backup asset count does not match its manifest.');
  let totalBytes = databaseStat.size;
  for (let index = 0; index < actualAssets.length; index += 1) {
    const actual = actualAssets[index];
    const listed = listedAssets[index];
    if (actual.name !== listed?.name || actual.size !== listed?.size || actual.sha256 !== listed?.sha256 || !/^[a-f0-9]{64}$/.test(listed.sha256)) throw new Error('Backup asset checksum validation failed.');
    totalBytes += actual.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Backup exceeds the total size limit.');
  }
  return { manifest, databasePath, assetDirectory, totalBytes };
}

async function createBackup(dataDirectory, destinationRoot, appVersion) {
  const databasePath = path.join(dataDirectory, 'studio.sqlite');
  const databaseStat = await fs.stat(databasePath);
  if (!databaseStat.isFile() || databaseStat.size > MAX_TOTAL_BYTES) throw new Error('The local project database is unavailable or too large to back up.');
  const now = new Date();
  const label = now.toISOString().replace(/[:.]/g, '-');
  await fs.mkdir(destinationRoot, { recursive: true });
  const backupDirectory = path.join(destinationRoot, `AI-Design-Studio-Backup-${label}`);
  await fs.mkdir(backupDirectory, { recursive: false });
  try {
    await fs.copyFile(databasePath, path.join(backupDirectory, 'studio.sqlite'), require('node:fs').constants.COPYFILE_EXCL);
    const sourceAssets = path.join(dataDirectory, 'assets');
    await fs.mkdir(path.join(backupDirectory, 'assets'), { recursive: true });
    for (const asset of await listAssetFiles(sourceAssets)) {
      await fs.copyFile(path.join(sourceAssets, asset.name), path.join(backupDirectory, 'assets', asset.name), require('node:fs').constants.COPYFILE_EXCL);
    }
    const assets = await listAssetFiles(path.join(backupDirectory, 'assets'));
    const database = { size: databaseStat.size, sha256: await sha256(path.join(backupDirectory, 'studio.sqlite')) };
    const totalBytes = database.size + assets.reduce((sum, asset) => sum + asset.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Backup exceeds the total size limit.');
    const manifest = { formatVersion: FORMAT_VERSION, appVersion: String(appVersion), createdAt: now.toISOString(), database, assets, credentials: 'Operating-system keyring credentials are intentionally not included.' };
    await fs.writeFile(path.join(backupDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await inspectBackup(backupDirectory);
    return { backupDirectory, assetCount: assets.length, totalBytes };
  } catch (error) {
    await fs.rm(backupDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function restoreBackup(backupDirectory, dataDirectory) {
  const verified = await inspectBackup(backupDirectory);
  const parentDirectory = path.dirname(dataDirectory);
  const id = crypto.randomUUID();
  const stageDirectory = path.join(parentDirectory, `.studio-restore-${id}`);
  const rollbackDirectory = path.join(parentDirectory, `.studio-rollback-${id}`);
  const currentAssetDirectory = path.join(dataDirectory, 'assets');
  const currentDatabasePath = path.join(dataDirectory, 'studio.sqlite');
  const existed = { database: false, assets: false };
  await fs.mkdir(path.join(stageDirectory, 'assets'), { recursive: true });
  await fs.mkdir(rollbackDirectory, { recursive: false });
  try {
    await fs.copyFile(verified.databasePath, path.join(stageDirectory, 'studio.sqlite'));
    for (const asset of verified.manifest.assets) await fs.copyFile(path.join(verified.assetDirectory, asset.name), path.join(stageDirectory, 'assets', asset.name));
    await fs.mkdir(dataDirectory, { recursive: true });
    try { await fs.rename(currentDatabasePath, path.join(rollbackDirectory, 'studio.sqlite')); existed.database = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(currentAssetDirectory, path.join(rollbackDirectory, 'assets')); existed.assets = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(path.join(stageDirectory, 'studio.sqlite'), currentDatabasePath);
    await fs.rename(path.join(stageDirectory, 'assets'), currentAssetDirectory);
    await fs.rm(stageDirectory, { recursive: true, force: true });
    return { rollbackDirectory, manifest: verified.manifest };
  } catch (error) {
    await fs.rm(currentDatabasePath, { force: true });
    await fs.rm(currentAssetDirectory, { recursive: true, force: true });
    if (existed.database) await fs.rename(path.join(rollbackDirectory, 'studio.sqlite'), currentDatabasePath);
    if (existed.assets) await fs.rename(path.join(rollbackDirectory, 'assets'), currentAssetDirectory);
    await fs.rm(stageDirectory, { recursive: true, force: true });
    await fs.rm(rollbackDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function rollbackRestore(rollbackDirectory, dataDirectory) {
  const currentDatabasePath = path.join(dataDirectory, 'studio.sqlite');
  const currentAssetDirectory = path.join(dataDirectory, 'assets');
  await fs.rm(currentDatabasePath, { force: true });
  await fs.rm(currentAssetDirectory, { recursive: true, force: true });
  try { await fs.rename(path.join(rollbackDirectory, 'studio.sqlite'), currentDatabasePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.rename(path.join(rollbackDirectory, 'assets'), currentAssetDirectory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rm(rollbackDirectory, { recursive: true, force: true });
}

async function commitRestore(rollbackDirectory) {
  await fs.rm(rollbackDirectory, { recursive: true, force: true });
}

module.exports = { createBackup, inspectBackup, restoreBackup, rollbackRestore, commitRestore };
