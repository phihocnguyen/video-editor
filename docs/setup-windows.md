# Windows setup (MSVC + FFmpeg)

Cutline’s desktop shell needs a C++ linker and FFmpeg on `PATH`. Frontend-only `pnpm dev` works without them; `pnpm tauri:dev` / export do not.

## 1. Visual Studio Build Tools

1. Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. Select workload **Desktop development with C++**.
3. Confirm `link.exe` exists (Developer PowerShell or “x64 Native Tools”).

```powershell
where.exe link
```

## 2. FFmpeg / ffprobe

1. Download a release build (prefer an LGPL build for redistribution — see `docs/licensing.md`).
2. Add the `bin` folder to the user or system `PATH`.
3. Verify:

```powershell
ffmpeg -version
ffprobe -version
```

## 3. Run

```bash
pnpm install
pnpm tauri:dev
```

Package installer (after the above works):

```bash
pnpm tauri:build
```

NSIS output lands under `src-tauri/target/release/bundle/nsis/`.

## 4. Update strategy (MVP decision)

No auto-updater in MVP. Ship versioned NSIS installers; users install newer builds manually. Revisit after Phase 5 packaging is validated.
