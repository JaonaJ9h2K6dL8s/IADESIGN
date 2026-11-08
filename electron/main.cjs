const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { createBackup, inspectBackup, restoreBackup, rollbackRestore, commitRestore } = require('./backup.cjs');

let apiProcess;
let backupInProgress = false;
let mainWindow;
const useDevServer = process.env.APP_DEV_SERVER === '1' || process.argv.includes('--app-dev-server');
const apiPort = Number(process.env.PORT || 4174);
const dataDirectory = process.env.DESIGN_STUDIO_DATA || (app.isPackaged ? app.getPath('userData') : path.resolve(process.cwd(), 'data'));

function localizedBackupError(error, language) {
  const message = error instanceof Error ? error.message : 'Unable to complete the backup operation.';
  if (language !== 'fr') return message;
  const translations = new Map([
    ['Unable to create the backup.', 'Impossible de créer la sauvegarde.'],
    ['The local project database is unavailable or too large to back up.', 'La base de données locale des projets est indisponible ou trop volumineuse.'],
    ['Backup manifest is invalid.', 'Le manifeste de sauvegarde est invalide.'],
    ['This backup version is not supported.', 'Cette version de sauvegarde n’est pas prise en charge.'],
    ['Backup database metadata is invalid.', 'Les métadonnées de la base de données sont invalides.'],
    ['Backup database file is missing or has changed.', 'Le fichier de base de données est manquant ou a été modifié.'],
    ['Backup database checksum validation failed.', 'La vérification d’intégrité de la base de données a échoué.'],
    ['Backup asset count does not match its manifest.', 'Le nombre de fichiers image ne correspond pas au manifeste.'],
    ['Backup asset checksum validation failed.', 'La vérification d’intégrité des fichiers image a échoué.'],
    ['Backup exceeds the total size limit.', 'La sauvegarde dépasse la taille maximale autorisée.'],
    ['Local design services did not stop safely.', 'Les services locaux ne se sont pas arrêtés correctement.'],
    ['Local design services did not start', 'Les services locaux n’ont pas pu démarrer'],
  ]);
  if (translations.has(message)) return translations.get(message);
  if (error?.code === 'ENOSPC') return 'Espace disque insuffisant pour terminer la sauvegarde ou la restauration.';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'Accès refusé au dossier de sauvegarde ou aux fichiers du projet.';
  return `Échec de la sauvegarde ou de la restauration : ${message}`;
}

function trustedSender(event) {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/') || url.startsWith(`http://127.0.0.1:${apiPort}/`);
}

ipcMain.handle('backup:create', async (event, language = 'en') => {
  const french = language === 'fr';
  if (!trustedSender(event) || backupInProgress) return { error: localizedBackupError(new Error('Backup is unavailable.'), language) };
  if (useDevServer) return { error: french ? 'La sauvegarde cohérente est disponible dans l’application de bureau installée.' : 'Consistent backups are available in the packaged desktop app.' };
  backupInProgress = true;
  let result;
  try {
    const selection = await dialog.showOpenDialog(mainWindow, { title: french ? 'Choisir le dossier de sauvegarde' : 'Choose backup folder', properties: ['openDirectory', 'createDirectory'], buttonLabel: french ? 'Choisir le dossier' : 'Select folder' });
    if (selection.canceled || !selection.filePaths[0]) result = { canceled: true };
    else {
      await stopApi();
      result = await createBackup(dataDirectory, selection.filePaths[0], app.getVersion());
    }
  } catch (error) {
    result = { error: localizedBackupError(error, language) };
  } finally {
    if (!apiProcess && !useDevServer) {
      startApi();
      try {
        await waitForApi();
      } catch (error) {
        result = { ...result, error: localizedBackupError(error, language), restartFailed: true };
      }
    }
    backupInProgress = false;
  }
  return result ?? { error: localizedBackupError(new Error('Unable to create the backup.'), language) };
});

ipcMain.handle('backup:restore', async (event, language = 'en') => {
  const french = language === 'fr';
  if (!trustedSender(event) || backupInProgress) return { error: localizedBackupError(new Error('Restore is unavailable.'), language) };
  if (useDevServer) return { error: french ? 'La récupération est disponible dans l’application de bureau installée.' : 'Backup recovery is available in the packaged desktop app.' };
  backupInProgress = true;
  let restore;
  try {
    const selection = await dialog.showOpenDialog(mainWindow, { title: french ? 'Sélectionner un dossier de sauvegarde AI Design Studio' : 'Select an AI Design Studio backup folder', properties: ['openDirectory'], buttonLabel: french ? 'Sélectionner le dossier' : 'Select folder' });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const verified = await inspectBackup(selection.filePaths[0]);
    const confirmation = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: french ? ['Annuler', 'Restaurer'] : ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0, title: french ? 'Restaurer la sauvegarde' : 'Restore backup', message: french ? `La restauration remplacera les projets et images locaux par la sauvegarde vérifiée du ${new Date(verified.manifest.createdAt).toLocaleString('fr-FR')}. Une copie de retour est conservée jusqu’au redémarrage réussi des services.` : `Restoring replaces the current projects and local image assets with the verified backup created ${new Date(verified.manifest.createdAt).toLocaleString('en-US')}. A rollback copy is retained until the local services restart successfully.` });
    if (confirmation.response !== 1) return { canceled: true };
    await stopApi();
    restore = await restoreBackup(selection.filePaths[0], dataDirectory);
    startApi();
    await waitForApi();
    await commitRestore(restore.rollbackDirectory);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    return { restored: true, createdAt: restore.manifest.createdAt, assetCount: restore.manifest.assets.length };
  } catch (error) {
    await stopApi();
    if (restore) await rollbackRestore(restore.rollbackDirectory, dataDirectory).catch(() => undefined);
    startApi();
    await waitForApi().catch(() => undefined);
    return { error: localizedBackupError(error, language) };
  } finally {
    backupInProgress = false;
  }
});


function startApi() {
  const serverFile = path.join(app.getAppPath(), 'dist-electron', 'server.cjs');
  apiProcess = spawn(process.execPath, [serverFile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DESIGN_STUDIO_DATA: dataDirectory, PORT: String(apiPort) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

function stopApi() {
  if (!apiProcess) return Promise.resolve();
  const child = apiProcess;
  apiProcess = undefined;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local design services did not stop safely.')), 5_000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill();
  });
}

function waitForApi() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
        if (response.ok) return resolve();
      } catch {}
      if (Date.now() - startedAt > 15000) return reject(new Error('Local design services did not start'));
      setTimeout(check, 250);
    };
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#f6f5f1',
    title: 'AI Design Studio',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(app.getAppPath(), 'electron', 'preload.cjs') },
  });
  if (useDevServer) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadURL(`http://127.0.0.1:${apiPort}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:5173') && !url.startsWith(`http://127.0.0.1:${apiPort}`)) event.preventDefault();
  });
}

app.whenReady().then(async () => {
  if (!useDevServer) startApi();
  await waitForApi();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch((error) => {
  console.error('Unable to start AI Design Studio', error);
  app.quit();
});
app.on('before-quit', () => apiProcess?.kill());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
