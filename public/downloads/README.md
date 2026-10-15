# Marketing downloads

Place the Windows installer here so the landing page can serve it:

```
Copy-Item src-tauri\target\release\bundle\nsis\Cutline_0.1.0_x64-setup.exe `
  public\downloads\Cutline_0.1.0_x64-setup.exe
```

`.exe` files in this folder are gitignored (too large). Rebuild with `pnpm tauri:build` then copy again after each release.
