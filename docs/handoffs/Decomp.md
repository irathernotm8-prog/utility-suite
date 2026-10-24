# Decomp: handoff for the Decomp chat

Decomp is the Utility Package's decompiler: drop in an app, installer, disc image, game pack or firmware file and it identifies it, unpacks every layer and hands the code to JADX, Vineflower, ILSpy or Ghidra, spreading the work over every core. It lives in `apps/decomp` inside `~/Downloads/Utility Package`. `apps/decomp/README.md` has the format list, how it uses the machine, the engines and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/decomp
npm install
npm start
npm test                       # 27 checks, no downloads
node src/cli.js some.apk       # headless run of the same pipeline
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note decomp "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/decomp`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test`: 27 Node checks — safe paths, ISO 9660/Joliet, raw 2352 images, CSO split decompression, LZ4, Xbox XDVDFS, GameCube FST, asar, Godot, RPG Maker v1/v3 decryption, PyInstaller + PYZ + marshal, .NET single-file bundles, .NET vs native detection, JAR/class details, WASM, tar.gz, plists, signature scan, strings/entropy, power modes, the scheduler's thread split, and whole jobs (ISO → nested zip with engines flagged, asar → beautified, CSO → ISO → files, firmware carving, WASM → WAT).
- Run for real on Linux (x64, 2 cores) with every engine installed through the app's own installer: 7-Zip 26.05, Temurin 25, JADX 1.5.6, Vineflower 1.12.0, .NET 10.0.13 + ilspycmd 11.1, Ghidra 12.2. Checked: ISO with a JAR, a .NET DLL and a nested zip (Vineflower + ILSpy + unzip in one job), raw BIN, an F-Droid APK (JADX, 153 files), a folder of 13 .NET DLLs (ILSpy, 1,706 C# files), an Electron zip (asar unpacked and beautified), a PyInstaller ELF (Python disassembly), a 7-Zip SFX installer, and a gcc ELF through Ghidra (C pseudocode for every function).
- `test/e2e/shots.js` screenshots every screen with real jobs.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **7-Zip on Windows** is installed by downloading `7zr.exe` and using it to unpack `7z.exe` + `7z.dll` from the official installer (a 7z self-extractor). If that fails, the fallback is to point Settings at an installed 7-Zip (`C:\Program Files\7-Zip\7z.exe` is picked up automatically).
  2. **Engine unpacking** uses `ditto` (Mac) and the built-in `tar.exe` (Windows 10/11) like Droid does. Java on Mac lands in `engines/jdk/jdk-25…/Contents/Home/bin/java`.
  3. **Ghidra** is started with Java directly (`ghidra.Ghidra ghidra.app.util.headless.AnalyzeHeadless`, VM args from `LaunchSupport -vmargs`), not through `analyzeHeadless(.bat)`, so there's no shell quoting on Windows. Ghidra 12.2 requires **Java 25**; `engines.usable('ghidra')` checks that and a system Java 21 won't be used for it.
  4. **Gatekeeper**: downloaded engines get `xattr -dr com.apple.quarantine`. 7-Zip's `7zz` and Temurin are signed; the Ghidra decompiler binary (`Ghidra/Features/Decompiler/os/mac_arm_64/decompile`) is made executable by `fixPermissions()`.
  5. **Big files**: the ISO reader, CSO and inspection all read with positions (nothing loads a whole disc). A 4–8 GB ISO should show every core busy during "Read disc" and "Inspect".

## Rules specific to Decomp

- **The window never runs commands.** Everything goes through `window.decomp.call(...)` → `ipcMain` handlers in `main.js` → `src/core/*`.
- **Never write outside the job's output folder**, and never into the input (folders are read in place). Archive member names go through `safeJoin()` (zip-slip, Windows reserved names).
- **Every engine call goes through the scheduler** (`ctx.scheduler.engine(label, fn)`), which hands out threads, heap and priority. Pass the thread count to the engine in its own terms and add `-XX:ActiveProcessorCount` for Java. Don't spawn engines directly.
- **Built-in readers are pool tasks.** A new container format needs `open(file) → { entries, extract(entry, dest), close }` with deterministic entry order, a line in `worker.js`'s `FORMATS`, and a handler in `pipeline.js`'s `HANDLERS`. Add a fixture builder in `test/fixtures.js` and a check in `test/run.js`.
- **Detection is bytes first.** `detect.quick()` runs on every file of an unpacked app, so keep it cheap; deep header parsing goes in `full()`. A string match must be scoped (e.g. NSIS/Inno only in the PE overlay — `7z.dll` mentions both).
- Engine versions are pinned with SHA-256 from their GitHub releases (`engines/catalog.js`); Java and .NET resolve their latest build at install time and check the vendor's hash. When bumping an engine, update the URL, size and hash together.
- Engines live in the app-data folder (`engines/`, `engines.json`); settings and job history are JSON beside it; results go to `~/Documents/Decomp` (Settings › Output).
- `asar` is off in `package.json` so worker threads, the Ghidra script and the wasm/beautify modules load from real files.
