import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { inspectBackup } from '../electron/backup.cjs';

const installer = path.resolve(process.env.BACKUP_TEST_INSTALLER ?? process.argv[2] ?? path.join('release-backup-certification-isolated', 'AI Design Studio Setup 1.0.0.exe'));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'AI-Design-Studio-backup-certification-é-'));
const installRoot = await mkdtemp(path.join(os.tmpdir(), 'AI-Design-Studio-install-'));
const installDirectory = process.env.BACKUP_TEST_UNPACKED === '1' ? path.resolve('release-backup-certification-isolated', 'win-unpacked') : installRoot;
const dataDirectory = path.join(tempRoot, 'isolated project data');
const backupRoot = path.join(tempRoot, 'backups with spaces é');
const debugServer = createServer();
const appPort = 4182;
const apiOrigin = `http://127.0.0.1:${appPort}`;
const desktop = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const powershell = path.join(desktop, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
let debugPort;
let appProcess;
let appOutput = '';
let preserveInstall = false;
let browser;
let nativeScript;

async function allocatePort() {
  debugServer.listen(0, '127.0.0.1');
  await once(debugServer, 'listening');
  debugPort = debugServer.address().port;
  await new Promise((resolve, reject) => debugServer.close((error) => error ? reject(error) : resolve()));
}

function runPowerShell(script, args = []) {
  const result = spawnSync(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (result.status !== 0) throw new Error(`Windows UI automation failed (${result.status ?? result.error}): ${result.stderr || result.stdout}`);
}

async function captureDesktop(name) {
  const output = path.resolve('artifacts', 'windows-backup-restore-certification', name);
  await mkdir(path.dirname(output), { recursive: true });
  const script = path.join(tempRoot, 'capture-screen.ps1');
  await writeFile(script, `param([string]$OutputPath)\nAdd-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\n$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds\n$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height\n$graphics = [System.Drawing.Graphics]::FromImage($bitmap)\n$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)\n$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)\n$graphics.Dispose()\n$bitmap.Dispose()\n`, 'utf8');
  runPowerShell(script, [output]);
  assert.ok((await readFile(output)).length > 20_000, `Desktop screenshot was not captured: ${name}`);
  return output;
}

async function selectNativeFolder(title, folder, confirmationTitle) {
  const automation = path.join(tempRoot, 'native-folder-dialog.ps1');
  await writeFile(automation, `param([string]$DialogTitle, [string]$FolderPath, [string]$ConfirmationTitle, [string]$ScreenshotPath, [string]$TracePath)\nAdd-Type -AssemblyName UIAutomationClient\nAdd-Type -AssemblyName UIAutomationTypes\nAdd-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\nAdd-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command); [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId); [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId(); [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach); [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd); }'\n$root = [System.Windows.Automation.AutomationElement]::RootElement\n$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $DialogTitle)\n$dialog = $null\n$deadline = [DateTime]::UtcNow.AddSeconds(20)\nwhile (-not $dialog -and [DateTime]::UtcNow -lt $deadline) { $dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition); Start-Sleep -Milliseconds 200 }\nif (-not $dialog) { throw \"Native folder dialog not found: $DialogTitle\" }\n$edits = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))\n$combos = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ComboBox)))\n$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))\n$diagnostic = [ordered]@{ title=$dialog.Current.Name; edits=@(); combos=@(); buttons=@() }\nforeach ($edit in $edits) { $diagnostic.edits += [ordered]@{name=$edit.Current.Name; automationId=$edit.Current.AutomationId; offscreen=$edit.Current.IsOffscreen} }\nforeach ($combo in $combos) { $diagnostic.combos += [ordered]@{name=$combo.Current.Name; automationId=$combo.Current.AutomationId; offscreen=$combo.Current.IsOffscreen} }\nforeach ($button in $buttons) { $diagnostic.buttons += [ordered]@{name=$button.Current.Name; automationId=$button.Current.AutomationId; offscreen=$button.Current.IsOffscreen} }\n[System.IO.File]::WriteAllText((Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'native-dialog-elements.json'), (ConvertTo-Json $diagnostic -Depth 5))\n$windowHandle = [IntPtr]$dialog.Current.NativeWindowHandle\n$rect = $dialog.Current.BoundingRectangle\n$processId = [uint32]0\n$dialogThread = [NativeMouse]::GetWindowThreadProcessId($windowHandle, [ref]$processId)\n$foregroundHandle = [NativeMouse]::GetForegroundWindow()\n$foregroundProcessId = [uint32]0\n$foregroundThread = [NativeMouse]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)\n[NativeMouse]::AttachThreadInput($foregroundThread, $dialogThread, $true) | Out-Null\n[NativeMouse]::ShowWindow($windowHandle, 9) | Out-Null\n[NativeMouse]::BringWindowToTop($windowHandle) | Out-Null\n$foregroundResult = [NativeMouse]::SetForegroundWindow($windowHandle)\n$focusResult = 'attached-thread-input'\n[NativeMouse]::AttachThreadInput($foregroundThread, $dialogThread, $false) | Out-Null\n[System.IO.File]::WriteAllText($TracePath, "hwnd=$windowHandle thread=$dialogThread foreground=$foregroundResult focus=$focusResult bounds=$rect")\n$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds\n$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height\n$graphics = [System.Drawing.Graphics]::FromImage($bitmap)\n$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)\n$bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)\n$graphics.Dispose(); $bitmap.Dispose()\n[System.IO.File]::WriteAllText($TracePath, 'screenshot-captured')\n$rect = $dialog.Current.BoundingRectangle\n[NativeMouse]::SetCursorPos([int]($rect.Left + $rect.Width * 0.55), [int]($rect.Top + $rect.Height * 0.90)) | Out-Null\n[NativeMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [NativeMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)\n[System.Windows.Forms.Clipboard]::SetText($FolderPath)
[System.Windows.Forms.SendKeys]::SendWait('^a'); [System.Windows.Forms.SendKeys]::SendWait('^v')\n[System.IO.File]::WriteAllText($TracePath, "path-typed x=$([int]($rect.Left + $rect.Width * 0.55)) y=$([int]($rect.Top + $rect.Height * 0.90)) hwnd=$windowHandle thread=$dialogThread pid=$processId foreground=$foregroundResult bounds=$rect")
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()\nStart-Sleep -Milliseconds 300\n[NativeMouse]::SetCursorPos([int]($rect.Left + $rect.Width * 0.81), [int]($rect.Top + $rect.Height * 0.95)) | Out-Null; [NativeMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [NativeMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)\n$dialogStillOpen = $true; $deadline = [DateTime]::UtcNow.AddSeconds(15)\nwhile ($dialogStillOpen -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200; $dialogStillOpen = $null -ne $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition) }\nif ($dialogStillOpen) { throw 'Native folder dialog did not close after selecting the path.' }\nif ($ConfirmationTitle) {\n  $confirmCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $ConfirmationTitle)\n  $confirm = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $confirmCondition)\n  while (-not $confirm -and [DateTime]::UtcNow -lt $deadline) { $confirm = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $confirmCondition); Start-Sleep -Milliseconds 200 }\n  if (-not $confirm) { throw \"Restore confirmation dialog not found: $ConfirmationTitle\" }\n  $buttons = $confirm.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)\n  $restoreButton = $null\n  foreach ($button in $buttons) { if ($button.Current.IsEnabled -and $button.Current.Name -match 'Restore|Restaurer') { $restoreButton=$button; break } }\n  if (-not $restoreButton) { $controls=$confirm.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); $names=@(); foreach ($control in $controls) { $names += "$($control.Current.ControlType.ProgrammaticName)|$($control.Current.Name)" }; [System.IO.File]::WriteAllText((Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'native-dialog-elements.json'), (ConvertTo-Json @{ title=$confirm.Current.Name; controls=$names } -Depth 5)); throw "Restore confirmation button was not found: $($names -join '; ')" }\n  $confirmScreenshot = $ScreenshotPath.Replace('restore-folder-dialog.png', 'restore-confirmation.png'); $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bitmap.Save($confirmScreenshot, [System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose()
  $buttonBounds = $restoreButton.Current.BoundingRectangle
  $invokePattern = $null
  if ($restoreButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) { $invokePattern.Invoke() } else { [NativeMouse]::SetCursorPos([int]($buttonBounds.Left + $buttonBounds.Width / 2), [int]($buttonBounds.Top + $buttonBounds.Height / 2)) | Out-Null; [NativeMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [NativeMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 500
  if ($root.FindFirst([System.Windows.Automation.TreeScope]::Children, $confirmCondition)) { throw 'Restore confirmation remained open after activating its button.' }\n}\n`, 'utf8');
  const screenshot = path.resolve('artifacts', 'windows-backup-restore-certification', title.includes('Sélectionner') ? 'restore-folder-dialog.png' : 'backup-folder-dialog.png');
  await mkdir(path.dirname(screenshot), { recursive: true });
  const diagnostic = path.join(tempRoot, 'native-dialog-elements.json');
  const trace = path.join(tempRoot, 'native-folder-dialog.trace');
  try {
    runPowerShell(automation, [title, folder, confirmationTitle ?? '', screenshot, trace]);
  } finally {
    await copyFile(diagnostic, path.resolve('artifacts', 'windows-backup-restore-certification', 'native-dialog-elements.json')).catch(() => undefined);
    await copyFile(trace, path.resolve('artifacts', 'windows-backup-restore-certification', 'native-folder-dialog.trace')).catch(() => undefined);
  }
  return path.resolve('artifacts', 'windows-backup-restore-certification', title.includes('Sélectionner') ? 'restore-folder-dialog.png' : 'backup-folder-dialog.png');
}

async function createFixtureProject(page) {
  const projectId = 'windows-backup-certification-project';
  const created = await page.evaluate(async (id) => {
    const project = { id, name: 'Backup fixture é — saved design', width: 320, height: 240, updatedAt: new Date().toISOString(), nodes: [] };
    const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
    if (!response.ok) throw new Error(`Project creation failed: ${response.status} ${await response.text()}`);
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d83b72';
    context.fillRect(2, 2, 28, 20);
    const assetResponse = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: id, name: 'fixture-é.png', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, sourceName: 'fixture-é.png' }) });
    if (!assetResponse.ok) throw new Error(`Asset creation failed: ${assetResponse.status} ${await assetResponse.text()}`);
    const asset = await assetResponse.json();
    const updated = { ...project, updatedAt: new Date(Date.now() + 2_000).toISOString(), nodes: [{ id: 'backup-fixture-image', type: 'image', name: 'fixture-é.png', src: asset.src, x: 24, y: 30, width: 96, height: 72, rotation: 0, opacity: 1, visible: true, locked: false }] };
    const saveResponse = await fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(updated) });
    if (!saveResponse.ok) throw new Error(`Project update failed: ${saveResponse.status} ${await saveResponse.text()}`);
    return { project: await saveResponse.json(), asset };
  }, projectId);
  return created;
}

async function openBackupManager(page) {
  const modal = page.locator('.backup-manager-modal');
  if (await modal.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /Backup and recovery/ }).click();
  await modal.waitFor({ state: 'visible' });
}

async function clickNativeFolderAction(page, label) {
  const action = page.getByRole('button', { name: label });
  await action.waitFor({ state: 'visible' });
  await action.click({ noWaitAfter: true });
}

try {
  await allocatePort();
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  if (process.env.BACKUP_TEST_UNPACKED !== '1') {
    const installLog = path.join(tempRoot, 'nsis-install.log');
    const install = spawnSync(installer, ['/S', `/D=${installDirectory}`], { stdio: 'inherit', timeout: 300_000, windowsHide: true });
    const installLogContent = await readFile(installLog).catch(() => null);
    if (installLogContent) await writeFile(path.resolve('artifacts', 'windows-backup-restore-certification', 'nsis-install.log'), installLogContent);
    if (install.status !== 0) throw new Error(`Windows installer exited with ${install.status ?? install.error}: ${installLogContent?.toString() ?? ''}`);
  }
  const executable = path.join(installDirectory, 'AI Design Studio.exe');
  await access(executable);
  await access(path.join(installDirectory, 'resources', 'app.asar'));
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, DESIGN_STUDIO_DATA: dataDirectory, PORT: String(appPort) } });
  appProcess.stdout.on('data', (chunk) => { appOutput += chunk.toString(); });
  appProcess.stderr.on('data', (chunk) => { appOutput += chunk.toString(); });
  let health;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      preserveInstall = true;
      const chromiumLog = await readFile(path.join(installDirectory, 'debug.log')).catch(() => null);
      if (chromiumLog) await writeFile(path.resolve('artifacts', 'windows-backup-restore-certification', 'installed-app-debug.log'), chromiumLog);
      throw new Error(`Installed application exited early (${appProcess.exitCode}): ${appOutput} | install=${await readdir(installDirectory).catch((error) => error.message)} | resources=${await readdir(path.join(installDirectory, 'resources')).catch((error) => error.message)}`);
    }
    try {
      health = await fetch(`${apiOrigin}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) break;
    } catch {}
    await delay(300);
  }
  assert.equal(health?.status, 200, 'Installed local API did not start with isolated data.');
  let debugReady = false;
  const debugDeadline = Date.now() + 30_000;
  while (Date.now() < debugDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { debugReady = true; break; }
    } catch {}
    await delay(250);
  }
  assert.equal(debugReady, true, 'Installed Electron remote debugging endpoint did not start.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const browserContext = browser.contexts()[0];
  let page = browserContext.pages()[0];
  const pageDeadline = Date.now() + 45_000;
  while (!page && Date.now() < pageDeadline) {
    await delay(250);
    page = browserContext.pages()[0];
  }
  assert.ok(page, 'Installed Electron renderer did not expose a page over CDP.');
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.waitForURL(`${apiOrigin}/`, { timeout: 45_000 });
  await page.waitForSelector('canvas', { timeout: 45_000 });
  const fixture = await createFixtureProject(page);
  const originalAssetBytes = Buffer.from(await (await fetch(`${apiOrigin}${fixture.asset.src}`)).arrayBuffer());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 45_000 });
  assert.equal((await (await fetch(`${apiOrigin}/api/projects`)).json()).some((project) => project.id === fixture.project.id), true);

  await openBackupManager(page);
  await clickNativeFolderAction(page, /Créer une sauvegarde|Create backup/);
  await selectNativeFolder('Choisir le dossier de sauvegarde', backupRoot, '');
  await page.getByRole('status').filter({ hasText: /Sauvegarde créée|Backup created/ }).waitFor({ timeout: 60_000 });
  const backupNames = await readdir(backupRoot);
  assert.equal(backupNames.length, 1, 'The native picker should have created one backup directory.');
  const actualBackupDirectory = path.join(backupRoot, backupNames[0]);
  const verified = await inspectBackup(actualBackupDirectory);
  assert.equal(verified.manifest.assets.length, 1);
  assert.equal(verified.manifest.appVersion, '1.0.0');
  assert.ok(verified.totalBytes > 0);
  assert.ok((await readFile(path.join(actualBackupDirectory, 'manifest.json'))).length > 0);
  assert.deepEqual(await readFile(path.join(actualBackupDirectory, 'assets', `${fixture.asset.id}.png`)), originalAssetBytes);

  const corruptDirectory = path.join(tempRoot, 'corrupted backup é');
  await mkdir(corruptDirectory, { recursive: true });
  await cp(actualBackupDirectory, corruptDirectory, { recursive: true });
  await writeFile(path.join(corruptDirectory, 'assets', `${fixture.asset.id}.png`), Buffer.from('tampered asset'));
  await openBackupManager(page);
  await clickNativeFolderAction(page, /Restaurer|Restore backup/);
  await selectNativeFolder('Sélectionner un dossier de sauvegarde AI Design Studio', corruptDirectory, '');
  await page.getByRole('status').filter({ hasText: /checksum|intégrité/i }).waitFor({ timeout: 30_000 });
  const unchangedProjects = await (await fetch(`${apiOrigin}/api/projects`)).json();
  assert.ok(unchangedProjects.some((project) => project.id === fixture.project.id));
  assert.deepEqual(browserErrors, []);

  await rm(corruptDirectory, { recursive: true, force: true });
  const extraProject = { id: 'windows-backup-after-snapshot', name: 'Must disappear after restore', width: 100, height: 100, updatedAt: new Date().toISOString(), nodes: [] };
  const extraResponse = await fetch(`${apiOrigin}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(extraProject) });
  assert.equal(extraResponse.status, 201);
  await openBackupManager(page);
  await clickNativeFolderAction(page, /Restaurer|Restore backup/);
  const restoreNavigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
  const restoreDialog = await selectNativeFolder('Sélectionner un dossier de sauvegarde AI Design Studio', actualBackupDirectory, 'Restaurer la sauvegarde');
  const navigation = await restoreNavigation;
  if (!navigation) await page.getByRole('status').filter({ hasText: /Échec|failed|error/i }).waitFor({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForSelector('canvas', { timeout: 60_000 });
  let restoredProjects;
  const restoredDeadline = Date.now() + 30_000;
  while (Date.now() < restoredDeadline) {
    try {
      const response = await fetch(`${apiOrigin}/api/projects`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const projects = await response.json();
        if (projects.some((project) => project.id === fixture.project.id) && !projects.some((project) => project.id === extraProject.id)) { restoredProjects = projects; break; }
      }
    } catch {}
    await delay(300);
  }
  assert.ok(restoredProjects, 'Restored project state did not replace the post-backup project set.');
  assert.ok(restoredProjects.some((project) => project.id === fixture.project.id), 'The original backed-up project was not restored.');
  assert.equal(restoredProjects.some((project) => project.id === extraProject.id), false, 'Project created after backup was not removed by the confirmed restore.');
  const restoredFixture = restoredProjects.find((project) => project.id === fixture.project.id);
  assert.equal(restoredFixture.nodes[0].src, fixture.asset.src);
  const restoredAssetResponse = await fetch(`${apiOrigin}${fixture.asset.src}`);
  assert.equal(restoredAssetResponse.status, 200);
  assert.deepEqual(Buffer.from(await restoredAssetResponse.arrayBuffer()), originalAssetBytes);
  const sqliteAfterRestore = await readFile(path.join(dataDirectory, 'studio.sqlite'));
  assert.ok(sqliteAfterRestore.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')));
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ launchMode: process.env.BACKUP_TEST_UNPACKED === '1' ? 'unpacked-build' : 'installed-app', installation: process.env.BACKUP_TEST_UNPACKED === '1' ? 'not-run' : 'passed', nativeFolderBackup: 'passed', manifestAndChecksums: 'passed', assetIntegrity: 'passed', tamperedBackupRejected: 'passed', nativeFolderRestoreAndConfirmation: 'passed', apiRestart: 'passed', projectAndAssetRestore: 'passed', nonAsciiAndSpacedPaths: 'passed', browserErrors: browserErrors.length, screenshots: [path.resolve('artifacts/windows-backup-restore-certification/backup-folder-dialog.png'), path.resolve('artifacts/windows-backup-restore-certification/restore-folder-dialog.png'), restoreDialog] }, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  if (appProcess?.pid) spawnSync(path.join(desktop, 'taskkill.exe'), ['/pid', String(appProcess.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  await delay(500);
  const uninstaller = path.join(installDirectory, 'Uninstall AI Design Studio.exe');
  if (!preserveInstall) { try { await access(uninstaller); spawnSync(uninstaller, ['/S'], { stdio: 'inherit', timeout: 120_000, windowsHide: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  if (nativeScript) await rm(nativeScript, { force: true });
  if (!preserveInstall) await rm(installRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
