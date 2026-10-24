# Decomp

Take any app apart. Drop in a program, installer, disc image, game pack or firmware file and Decomp works out what it is, unpacks every layer and hands the code to the right decompiler — using every core the computer has.

## What it opens

| Family | Kinds | How |
|---|---|---|
| Apps & programs | Windows EXE/DLL, Linux ELF, Mac/iOS Mach-O (universal too), Mac `.app` folders, AppImage, UPX-packed programs | Headers, imports, resources (7-Zip); **Ghidra** → C pseudocode |
| Android & iOS | APK, AAB, XAPK/APKM/APKS, AAR, DEX, IPA | **JADX** → Java + decoded resources; IPA: Info.plist, binaries, frameworks |
| Java & Kotlin | JAR/WAR/EAR, class files, fat jars | **Vineflower** → Java |
| .NET & Unity | .NET assemblies, .NET single-file apps, NuGet, Unity (Mono) games | **ILSpy** → C# projects; Unity IL2CPP → Ghidra on GameAssembly |
| Python, Electron & web | PyInstaller apps, .pyc, wheels, Electron apps and `.asar`, WebAssembly, minified JS, Chrome/Firefox/VS Code extensions | PyInstaller/PYZ unpacked to `.pyc` (pycdc or Python disassembly); asar unpacked + beautified; WASM → WAT |
| Installers & packages | MSI, MSIX/AppX, NSIS, Inno Setup (innoextract), 7z/ZIP/RAR self-extractors, Mac `.pkg` (incl. pbzx payloads), DEB, RPM, CAB, Snap | 7-Zip + built-in readers |
| Disc & disk images | ISO 9660 / Joliet / Rock Ridge, raw 2352-byte BIN/IMG/MDF, El Torito boot images, UDF, DMG, VHD/VHDX/VMDK/VDI/QCOW2, WIM/ESD, FAT/NTFS/ext/HFS+/APFS/MBR/GPT images | Built-in ISO reader (parallel); 7-Zip for the rest |
| Games & consoles | CSO/ZSO (PSP/PS2), Xbox/Xbox 360 XDVDFS, GameCube, Wii (header), Godot `.pck` (also embedded in the exe), RPG Maker `rgssad/rgss2a/rgss3a` (decrypted), Flash SWF, Unreal `.pak` (header), Lua bytecode, NES/GB/GBA/NDS ROM headers | Built-in readers |
| Firmware & raw | Router/IoT firmware, U-Boot images, SquashFS, CramFS, Intel HEX, anything unknown | Signature scan on every core, embedded files carved out and opened |
| Archives | ZIP (incl. zip64, SFX offsets), 7z, RAR, tar(.gz/.xz/.bz2/.zst), gz/xz/bz2/zstd/lz4, LZH/ARJ/CPIO/AR/CHM | Built-in ZIP/tar; 7-Zip |

"Go all the way down" (on by default) repeats this for everything found inside: an ISO with a setup.exe with a .NET DLL inside becomes three layers of results, all in one job.

## How it uses the computer

- **Power modes** (sidebar card, live per-core meter): Full (every thread, 70% of RAM for engines), Balanced (75%), Background (40%, low priority).
- **Worker pool**: one worker thread per allowed core does Decomp's own work — hashing, strings, entropy, signature scans (the file is split into slices), ZIP/ISO/Xbox/GameCube/asar/Godot extraction (entries split by size across workers), CSO/ZSO decompression (blocks split across workers), JS beautifying, WAT conversion and search.
- **Engine scheduler**: JADX, Vineflower, ILSpy and Ghidra are multi-threaded. A single engine gets every thread; when several are queued (all the DLLs in a Unity game, every JAR in a folder) they run side by side and split the threads and heap evenly. Thread limits are passed in each engine's own terms (`-j`, `--thread-count`, `DOTNET_PROCESSOR_COUNT`, `-max-cpu`, `-XX:ActiveProcessorCount`).
- **7-Zip** gets `-mmt`; big non-solid archives are split across several 7-Zip processes.

## Engines

Downloaded on demand into Decomp's own data folder (nothing system-wide), pinned versions with SHA-256 checks:

| Engine | Version | Size | For |
|---|---|---|---|
| 7-Zip | 26.05 | 2 MB | Fetched automatically on first launch |
| Java (Temurin) | 25 LTS | ~200 MB | JADX, Vineflower, Ghidra (Ghidra 12 needs Java 25) |
| JADX | 1.5.6 | 73 MB | Android |
| Vineflower | 1.12.0 | 1.6 MB | Java |
| .NET runtime | 10 | ~35 MB | ILSpy |
| ILSpy (ilspycmd) | 11.1 | 4.6 MB | .NET |
| Ghidra | 12.2 | 570 MB | Native code |
| UPX | 5.2.1 | 0.7 MB | Windows/Linux only (no Mac build; Homebrew's is used if present) |

Programs already on the computer are used when "Use programs already on this computer" is on: Java ≥ 17, .NET 10, 7-Zip, UPX, plus `pycdc` (Python), `innoextract` (Inno Setup) and Python 3 (disassembly fallback), which Decomp never installs itself.

## Results

Each job writes `~/Documents/Decomp/<name> (<date time>)/`:

```
Source/      decompiled code (Java, C#, C pseudocode, beautified JS, .py, .wat…)
Unpacked/    everything that was inside, nested containers as "<name> (unpacked)"
Analysis/    strings.txt, overview.json (hashes, entropy, interesting strings, signatures), header dumps
Overview.md  what it was, every step, notes
report.json  the full job record
```

The app shows the same folder with a fast code viewer (syntax highlighting, hex view, images), an overview (facts, entropy chart, hashes, URLs/emails/IPs/paths/keys found in strings, embedded files) and search across everything on all worker threads.

## Working on it

```bash
cd apps/decomp
npm install
npm start
npm test                    # 27 Node checks (formats, scheduler, whole jobs) — no downloads
node src/cli.js <file>      # headless run: --engines DIR --out DIR --mode max|balanced|quiet --no-deep --no-native
```

`DECOMP_SHOTS=1 SAMPLES=a.iso,b.apk npm start` drives the window through every screen and saves screenshots (`test/e2e/shots.js`).

## Code map

```
src/main.js              window, settings, IPC, job history, live power meter
src/preload.js           window.decomp bridge
src/cli.js               headless runner
src/core/detect.js       identification (quick for every file, full for the dropped one)
src/core/types.js        the 67 kinds and their families
src/core/pipeline.js     Job: inspect → unit handlers → explore (deep) → report
src/core/scheduler.js    engine slots + thread/heap split; light-job limiter
src/core/pool.js, worker.js   worker-thread pool and its tasks
src/core/power.js        power modes and the per-core sampler
src/core/runners.js      7-Zip, JADX, Vineflower, ILSpy, Ghidra (launched via Java directly), UPX, pycdc, innoextract
src/core/engines/        catalog (pinned URLs + hashes) and installer
src/core/ghidra/DecompExport.java   Ghidra post-script: parallel decompile → <name>.c + functions.tsv
src/core/formats/        iso9660, cso, xiso, gcm, zip, tar, asar, pe, elf, macho, plist, axml, javaish,
                         python (PyInstaller, PYZ, marshal), dotnetbundle, godot, wasm, misc (RGSS, pbzx, SWF)
src/core/analysis.js     strings, entropy, signature scan, hashes (range-based, for the pool)
src/renderer/            index.html, ui.css (suite tokens), app.css, app.js, views.js, job.js, viewer.js, icons.js
build/make-icon.py       regenerates build/icon.png
```
