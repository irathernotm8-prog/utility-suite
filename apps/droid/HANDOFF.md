# Droid: handoff for the Droid chat

Droid is the Utility Package's virtual Android app: saved phones and tablets (Pixel-, Galaxy-, Island-style, tablet, custom) that run real Android through Google's Android Emulator, several at once, each in its own phone window, with drag-and-drop installs, F-Droid search, Play Store / Aurora Store, and APK sites in a built-in browser. It lives in `apps/droid` inside `~/Downloads/Utility Package`. `apps/droid/README.md` has the feature list, code map and where data lives.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/droid
npm install
npm start          # npm run demo runs on a pretend emulator (no downloads)
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note droid "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/droid`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test` runs 22 Node checks: repository parsing (per-host archives, stable filter), device validation, stale discovery files, AVD config, emulator flags, error explanations, touch mapping in every rotation, toybox `ls` parsing, APK manifest + XAPK/APKM bundles with OBB, simulated movement, and a full start → boot → stream → rotate → install → stop against `src/demo/fake-emulator.js`.
- `test/e2e/shots.js` (demo) screenshots every screen. `test/e2e/real.js` drives a **real** emulator end to end: it was run on Linux with emulator 37.2.12 and an Android 9 x86 image under software emulation (boot, live frames, swipe, Esc = Back, drop an APK and a file, files panel, F-Droid install, apps panel, manual GPS, screenshot, rotation, named snapshot, dashboard thumbnail, turn off with Quick Boot save): 15/15 pass. That run caught and fixed two real issues: a stale discovery file from an earlier emulator on the same port (wrong gRPC token), and snapshot names with spaces.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **First device on the Mac** downloads the emulator (~420 MB), adb (~16 MB) and the Android version (~1.9 GB for Android 16 Google Play arm64) into `~/Library/Application Support/Droid/sdk`. Downloads resume; unpacking uses `ditto` (keeps the emulator's symlinks and exec bits).
  2. **`-qt-hide-window`** keeps Google's emulator window hidden; a "qemu-system-aarch64" Dock icon may still appear while a device runs. Settings › Phone windows can switch to headless (`-no-window`) or show Google's window too.
  3. **Windows** needs Windows Hypervisor Platform turned on (Windows Features). Android versions › Hardware acceleration › Check runs `emulator -accel-check`; failures to start are translated by `explainFailure()` in `core/emulator.js`.
  4. **Discovery file**: the emulator writes `pid_<pid>.ini` (gRPC port + token). Droid reads the path from the emulator's "Advertising in:" log line and falls back to the known folders in `discoveryDirs()`; it matches by `port.serial`, because on Windows the PID is the qemu child's.
  5. **adb auth**: Google Play images need adb keys. Droid leaves `~/.android` alone (only `ANDROID_AVD_HOME` is redirected), so the emulator and adb share the usual key.
  6. **Sharpness and size (0.1.1)**: the phone window is fixed-size. `layout()` in `renderer/device.js` draws the screen so one screen pixel shows exactly `V.n` device pixels (`STEPS`), on whole pixels, and asks the emulator for full-resolution frames, which WebGL2 shrinks once with mipmaps. If big devices (1440p, tablets) feel heavy, request frames at `2 × canvas` size instead of full resolution there.
  7. **Clicks (0.1.1)**: nothing with `-webkit-app-region: drag` may overlap the screen canvas: macOS can swallow clicks under a drag region even where a child says no-drag. The window drags by four bezel strips (`#grab`) and the toolbar. Input goes down one ordered `streamInputEvent` stream (unary calls could arrive out of order and lose taps); errors surface as a toast instead of failing silently.

## Rules specific to Droid

- **Windows never run commands.** Everything goes through `window.droid.call(...)` → `ipcMain` handlers in `main.js` → `src/core/*`.
- **Touches use the panel's natural orientation.** The emulator sends rotated frames (`Rotation` in each image); `Frames.toDevice()` maps a point on the displayed frame back. This was verified on a real emulator: keep the test in `test/run.js` passing.
- **Never `fs.rm` outside Droid's own folders.** System images are removed only through `sdk.removeImage()` (it checks the path is under `<sdk>/system-images`), and only when no device uses them. Device files are removed only as `<data>/avd/droid_<id>.avd`.
- **AVDs are rewritten before every start** from the device record (`writeAvd`), keeping lines the emulator added. Changing a device's Android version deletes its userdata (the old data won't boot).
- **Pure core modules** (`repo`, `avd`, `catalog`, `devices.normalize`, `emulator.buildArgs`, `apk`) have no Electron imports so `npm test` covers them. Add a check when you change one.
- If you add an emulator gRPC call, add it to `src/demo/fake-emulator.js` too so the demo and tests keep working. The bundled `src/proto/*.proto` are the emulator's own (Apache 2.0); the installed emulator's copies in `<sdk>/emulator/lib` are preferred when present.
- Devices, settings and window positions are JSON in the app-data folder; the app library is `<data>/apks`; captures go to `~/Pictures/Droid`.
