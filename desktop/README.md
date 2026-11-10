# Nucleas Desktop

Native Windows shell, shared Nucleas platform. No second database or copied project records.

## Run locally

From the repository root:

```
npm ci --prefix desktop
npm run desktop:dev
```

If npm is configured to skip dependency install scripts, run `node desktop/node_modules/electron/install.js` once.

The floating launcher is bundled locally. App windows load `https://nucleas.app/os/desktop`; deploy that route from this change before using the app windows in production. Sign in once in an app window using the normal Nucleas login. All app windows share an isolated persistent cookie profile. Your browser login is not imported.

- The microphone in the launcher starts voice: it opens Ask and listens there. Other app windows do not show a microphone.
- Alt+Space toggles the launcher. The tray remains available if another app owns that shortcut.
- Drag the header to position the launcher. Collapse it to a compact strip or hide it to the tray.
- Apps are independent native windows with normal minimize, maximize, Snap and taskbar behavior.
- Reopening the same app and context focuses its existing window. Company-specific windows retain their context.
- Window bounds survive restarts and are brought back on-screen when a monitor is removed.
- The catalog is generated from the existing module registry during every desktop build.
- The launcher leads with Companies, then Team (delegate to and guide each company’s specialists), then Review & work (Responsibilities, Build and Tools). Growth (Marketing and Content) is reached from a team member and no longer has its own launcher tile. Settings combines AI Engine, Budgets and Spend. Existing deep links and original modules still work.

## Build and verify

```
npm run desktop:test
npm run desktop:build
```

Installer: `desktop/release/Nucleas-Setup-0.1.0.exe` (version changes in CI).
Unpacked runnable build: `desktop/release/win-unpacked/Nucleas.exe`.
Native smoke check: `desktop/node_modules/electron/dist/electron.exe desktop --smoke-test` from repository root. It captures the launcher, opens two real windows, and checks duplicate handling, then exits. Results are in `desktop/release/`.

## Updates and releases

The native updater checks on startup and on subsequent launches of an already-running instance. It downloads automatically. With no app windows open, it installs and restarts automatically. With work windows open, it offers a restart and otherwise installs at normal quit. Failed update checks do not block the application. The app modules themselves always load the current web deployment.

`.github/workflows/desktop.yml` builds on desktop changes pushed to main and through manual workflow dispatch. It generates an increasing `0.1.<run_number>` version and always retains the installer as a workflow artifact. Unsigned releases are explicitly supported for this initial rollout. The updater verifies the manifest SHA-512 checksum over HTTPS; Authenticode verification is disabled in the Windows build configuration. It uploads the installer and blockmap before publishing `latest.yml` to the existing Vercel Blob store. No source repository access token is distributed to desktops.

Release prerequisites (GitHub Actions secrets, not developer-local environment variables):

- `BLOB_READ_WRITE_TOKEN`: access to the same Blob store used by the Nucleas deployment.

The website already uses `BLOB_READ_WRITE_TOKEN`. `/desktop/releases/windows/[asset]` serves only allowlisted release filenames and is intentionally public. A first release must be published before startup updates can succeed. No signing certificate is required. Set `win.verifyUpdateCodeSignature` back to true when adopting signed installers.

## Native boundary

Remote app content has sandboxing, context isolation and web security enabled, with Node integration disabled. It can request only a validated module window; local launcher IPC additionally controls its own visibility and updater. Native IPC validates the top-level sender and exact application origin. External links open in the normal browser, and arbitrary protocol handlers, filesystem access and generic IPC are not exposed. Camera/microphone/notification requests require an explicit native confirmation. Server permissions and the desktop route's role checks remain authoritative.

The initial release is Windows x64. macOS/Linux installers, native system-wide computer control and offline business data are not part of this change.


## Web and native entry points

The web home uses one full-workspace app view and a floating switcher. Old saved window positions no longer create nested draggable windows there. Apps can still pop out into separate browser windows.

The **Windows app** action downloads the native installer from `/desktop/download`, which follows the published updater manifest. A browser-installed PWA is a separate, older installation and does not provide the native launcher. The automatic PWA install prompt is disabled.

The desktop release workflow also runs when the download route or its web entry button changes, so publishing that entry point builds and publishes its installer in the same push. If publishing fails, GitHub still retains the installer artifact; the public download will report that no installer is available.
