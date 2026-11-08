# AI Design Studio 1.1.1 — Windows Backup and Restore Certification

**Decision: NOT CERTIFIED for commercial distribution.**

The native backup and restore workflow passed on the unpacked Windows x64 build. It did **not** pass in the installed NSIS application: installation/startup failed before the renderer became available, so the installed-UI workflow cannot be certified.

## Environment and artifacts

- OS: Windows 10 x64, build 10.0.19045.
- Windows UI locale observed: French.
- Application package version: 1.0.0, x64 NSIS target.
- Native UI evidence below is from the unpacked build, not an installed application.
- Diagnostic installer output: `release-backup-restore-certified-r3/AI Design Studio Setup 1.0.0.exe`.

## Results

| Check | Result | Evidence / limitation |
|---|---|---|
| Native folder picker — backup destination | PASS (unpacked build) | Windows folder picker opened and accepted a destination containing spaces and `é`. |
| Backup creation and manifest | PASS (unpacked build) | One backup directory was created; manifest version and non-zero size were checked. |
| Checksum and asset integrity | PASS (unpacked build) | The PNG asset bytes in the backup matched the source bytes. |
| Tampered backup rejection | PASS (unpacked build) | Modified asset bytes were rejected and the existing project remained present. |
| Native folder picker — restore source | PASS (unpacked build) | Backup directory selected through the Windows folder picker. |
| Restore confirmation, API restart, project/asset recovery | PASS (unpacked build) | Confirmation was accepted; the post-backup project disappeared, the original project returned, and its asset bytes matched. |
| Path with spaces and accented character | PASS (unpacked build) | Tested in backup and restore paths. Non-ASCII asset filenames were not tested. |
| Browser/renderer errors during unpacked workflow | PASS | 0 browser errors reported. |
| Installed NSIS app launch | FAIL | An earlier installer omitted Electron V8 snapshot files and exited with a V8 startup-snapshot fatal error. A later installer included the snapshot files, but the installed app still exited with code 1 before exposing its renderer/API. No installed-UI backup or restore was therefore performed. |
| Full installed-app acceptance workflow | NOT TESTED | Blocked by the installed-app launch failure; unpacked results are not a substitute. |
| Missing asset, invalid manifest, disk-full, interrupted backup/restore, app shutdown mid-operation | NOT TESTED | No evidence was gathered for these installed-UI failure cases. |
| Concurrent editing/autosave consistency and large multi-asset projects | NOT TESTED | The workflow fixture used one PNG asset and did not exercise an edit/autosave race. |
| English Windows locale, alternate drive, non-ASCII asset filename | NOT TESTED | Only French UI and a local path containing spaces/`é` were exercised. |

## Automated verification

- `npm.cmd test`: **19 passed, 0 failed**. Includes three backup helper tests covering portable backup/checksum restore, tamper rejection before destination changes, and rollback after restore failure.
- `node --check tests/windows-backup-restore.playwright.mjs`: passed.
- Windows native UI harness on the unpacked build: passed backup, manifest/checksum inspection, tamper rejection, restore confirmation, API restart, project/asset restoration, and accented/spaced paths.
- x64 NSIS package generation: completed. Successful packaging is not proof of successful installation or launch.

## Evidence images

### Native backup folder picker (unpacked build)

![Windows backup folder picker](artifacts/windows-backup-restore-certification/backup-folder-dialog.png)

### Native restore folder picker (unpacked build)

![Windows restore folder picker](artifacts/windows-backup-restore-certification/restore-folder-dialog.png)

### Restore confirmation (unpacked build)

![Restore confirmation](artifacts/windows-backup-restore-certification/restore-confirmation.png)

## Certification blockers and next required verification

1. Fix the installed x64 application's early exit after NSIS installation; capture its startup diagnostics and confirm the installed renderer and local API remain available.
2. Rerun the complete backup/restore harness against the installed application, not `win-unpacked`.
3. Add installed-UI evidence for rollback and failure scenarios, autosave consistency, and projects containing more than one supported asset type.
4. Re-run the full regression suite after the packaging fix.

Until those checks pass, the backup/restore feature remains **partially verified**, and commercial certification is withheld.

## Files changed in this certification pass

- `electron/main.cjs`
- `electron/preload.cjs`
- `src/App.tsx`
- `src/assets.d.ts`
- `tests/backup.test.mjs`
- `tests/windows-backup-restore.playwright.mjs`
- `package.json`
- `build/installer.nsh`
- `WINDOWS_BACKUP_RESTORE_CERTIFICATION_1.1.1.md`
