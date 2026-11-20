# Windows taskbar bar

The installed desktop app enables a small local bar on Windows 11 x64/ARM64. Left to right: Office, an Ask field, and minimized Nucleas windows. It occupies the measured gap before the notification area, with a native overflow menu when the window buttons do not fit. Very narrow or vertical taskbars show an Ask button instead of the text field. Right-click the Nucleas tray icon to disable the bar or retry a failed attachment. Windows 10 keeps the existing tray/Alt+Space launcher.

## Implementation

- `deskband11lib@1.5.1` (MIT) hosts a sandboxed local Electron window via Win32 parenting and measures taskbar buttons using UI Automation. It does not reserve space or move Windows' buttons. Its layout engine clips the bar to the remaining gap. This is an unsupported Windows integration, not a Microsoft extension API.
- No Explorer injection, shell commands, registry changes, system-wide window enumeration, or server requests from the bar. Only existing Nucleas windows may be restored. Local IPC checks both the exact window and its main-frame URL; authenticated Ask uses a separate restricted bridge.
- Window lists update on minimize, restore, close, and title events. The renderer has no animation loop or network. The host measures layout every 500 ms and polls native events every 250 ms, with high-refresh animation disabled. Unchanged window lists do not rebuild the DOM.
- Questions and the unfinished draft live in process memory. The draft survives taskbar recreation. Questions wait for sign-in, history loading, and any current answer; the main Ask window acknowledges each before sending through the existing assistant API/model routing. Queries are never added to window URLs or persisted in desktop settings. Exiting Nucleas clears unsent questions.
- Host failure removes the bar and exposes Retry in the tray. Explorer/DPI/monitor changes are handled by the pinned library's recreation controller. The existing tray and Alt+Space remain available independently.
- The installer unpacks the host DLL and Koffi native addon outside `app.asar`. The usual desktop updater delivers updates to both.

## Validation

`npm --prefix desktop test` checks input bounds, platform gating, queue acknowledgement/FIFO behavior, and restoration of the correct company window. `npm --prefix desktop run pack` builds a packaged app with the native dependencies.

Windows 11 acceptance still requires a real Explorer session: type and submit (including IME); left/centered taskbars; grow pinned buttons until the bar is clipped; auto-hide/fullscreen behavior; DPI changes; monitor changes; restart Explorer; verify theme and restored window focus. The Windows 10 development host cannot establish those Windows 11 behaviors. Do not label them verified solely from a renderer preview.

Upstream: https://github.com/airtaxi/Deskband11Lib/tree/master/bindings/node
