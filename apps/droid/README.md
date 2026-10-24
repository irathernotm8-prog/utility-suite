# Droid

Virtual Android phones and tablets on a Mac or Windows PC. Part of the Utility Suite.

Droid runs Google's own Android Emulator (the one inside Android Studio) and wraps it in a cleaner app: a dashboard of saved devices, a builder for new ones, a phone window per running device, and ways to get apps onto them. You never install Android Studio; Droid downloads the emulator, adb and Android versions straight from Google's repository into its own folder.

## What it does

- **Dashboard** of saved devices with live screenshots, status, specs, pinning, duplicate, cold boot, factory reset and delete. Several devices can run at once, each on its own ports and in its own window.
- **New device builder** (Look → Android version → Hardware → Network & location → Review) with a live preview.
  - **Look:** Pixel-style, Galaxy-style, Island-style (an iPhone-like frame; Android inside), Tablet or Custom, each with a few finishes, plus a card colour.
  - **Android version:** every stable version Google publishes for this computer (Android 7 to 17), in three flavours: *Google Play* (Play Store and Google sign-in), *Google APIs*, *Pure Android*. Previews and special builds behind a checkbox.
  - **Hardware:** 1080p / 1440p (1200p / 1600p for tablets) or any custom resolution, density (auto or picked), RAM 2–16 GB, 2/4/6/8 cores, storage 32–256 GB or custom, graphics (auto / hardware / software), Quick Boot, sound, shared clipboard, microphone. Options the computer can't spare are greyed out.
  - **Network:** Internet, Isolated (no network at all), or an HTTP proxy.
  - **Location:** Actual (approximate, from the internet connection), Simulated (a city, standing still, walking or driving), or Pick on map (search or click, OpenStreetMap).
- **Phone window**: a fixed-size window (no free resizing) that draws the phone at an exact size: Actual pixels when it fits, otherwise 80%, 67%, 50%… of the device's pixels (Size button, or ⌘+ / ⌘−). Frames arrive at full resolution and are scaled once on the GPU, so text stays sharp. The frame with the live screen, mouse as touch, keyboard typing, scroll wheel, Option/Alt-drag pinch, right-click = Back, clickable side buttons, rotate, back/home/recents, screenshot (saved to Pictures/Droid and copied), screen recording, sound, shared clipboard, keep on top.
  - **Drag and drop:** drop APK / APKM / XAPK / APKS onto the screen to install (splits for other processors are skipped, OBB game data is copied); drop any other file to put it in the device's Downloads.
  - **Files panel:** browse the device's storage, drag files out to the desktop, save, delete, add files, new folder.
  - **Apps panel:** installed apps with open and uninstall, install from the library, open the Play Store.
  - **Location and Network panels** change things live (Isolated ↔ Internet uses airplane mode right away; full isolation and proxy apply on next start).
  - **More:** saved states (named snapshots: save, restore, delete), battery level and charging, send a text message, device info, restart, cold boot.
- **Get apps**
  - Search F-Droid (real API, signed builds) and install in one click, with app details and screenshots. Processor-specific builds are picked automatically.
  - Play Store apps: on Google Play devices, open the Play Store on the device; on others, one click installs **Aurora Store** (Play Store apps without a Google account).
  - APKMirror, APKPure, Uptodown and F-Droid open in Droid's built-in browser; any app file you download there lands in the library and (optionally) installs on the chosen device by itself.
- **App library**: every APK/bundle you've downloaded or dropped, with package and version read from the file, install on any device, show in folder, remove.
- **Android versions**: what's downloaded and which devices use it, sizes, remove unused versions, emulator and adb versions, update the emulator, hardware-acceleration check, data folder (movable), share an existing Android Studio SDK, clear the download cache.

## How it works

```
Droid (Electron)
 ├─ main.js ─ windows, IPC, starting devices, installs, files, location, browser downloads
 ├─ core/
 │   repo.js       Google's SDK repository XML → emulator / platform-tools / system images for this computer
 │   sdk.js        downloads (resume + SHA-1), unpacks with ditto / tar, installs into <data>/sdk
 │   avd.js        writes the emulator's AVD files (config.ini) from a Droid device record
 │   emulator.js   one emulator process per device: ports, discovery file + gRPC token, boot wait, stop with Quick Boot save
 │   grpc.js       the emulator's gRPC API: screen frames, touch/keys/wheel, GPS, clipboard, audio, rotation, snapshots
 │   adb.js        install / install-multiple, push / pull, ls, packages, airplane mode
 │   apk.js        zip reader + binary AndroidManifest parser; APKM / XAPK / APKS bundles with OBB
 │   sources.js    F-Droid search + builds, starter apps, APK sites
 │   location.js   approximate location, place search, simulated movement
 │   devices.js    devices.json + validation; host.js computer limits and acceleration check
 ├─ demo/          a pretend emulator (gRPC) and adb for DROID_DEMO=1 and the tests
 └─ renderer/      index.html (dashboard, builder, apps, library, versions, settings) and device.html (phone window)
```

- Apple Silicon Macs run **arm64** Android images natively (Hypervisor.framework). Windows PCs run **x86_64** images with Windows Hypervisor Platform (WHPX) or the AEHD driver.
- The emulator runs with its own window hidden (`-qt-hide-window`); frames come over gRPC at full resolution as RGB and are drawn with WebGL2 (mipmapped downscale; WebGL1 / 2D fallback). Input (touch, keys, wheel) goes down one ordered `streamInputEvent` stream, as in Android Studio. Touches are sent in the panel's natural orientation; rotated frames are mapped back (checked against a real emulator).
- Droid keeps its AVDs in `<data>/avd` (`ANDROID_AVD_HOME`), so they never mix with Android Studio's.

## Where things live

| What | Where |
|---|---|
| Devices list, settings | app-data folder (`~/Library/Application Support/Droid`, `%APPDATA%\Droid`) |
| Emulator, adb, Android versions | `<data>/sdk` (or a shared Android Studio SDK) |
| Each device's disk, snapshots | `<data>/avd/droid_<id>.avd` |
| App library | `<data>/apks` |
| Screenshots and recordings | `~/Pictures/Droid` |

`<data>` is the app-data folder unless moved in Android versions › Data folder (useful for an external drive: each Android version is 1–2 GB and each device grows as you use it).

## Develop

```bash
npm install
npm start                 # real emulator (downloads it on first device start)
npm run demo              # DROID_DEMO=1: pretend emulator, no downloads
npm test                  # 22 Node checks, including a full start/stream/install/stop against the pretend emulator
```

End-to-end runs (Linux under Xvfb works too):

```bash
DROID_DEMO=1 DROID_USER_DATA=/tmp/d DROID_E2E=$PWD/test/e2e/shots.js npx electron .      # screenshots of every screen
DROID_USER_DATA=/tmp/r DROID_SDK=/path/to/sdk DROID_IMAGE="system-images;android-28;default;x86" \
  DROID_TEST_APK=/path/to/any.apk DROID_E2E=$PWD/test/e2e/real.js npx electron .           # against a real emulator
```

`DROID_EMU_ARGS` adds emulator flags (e.g. `-accel off` on a machine without virtualization).
