# Bundled fonts (OFL — no fallback needed on export)

These TTFs ship with the app (Tauri `resources`) so `drawtext` renders the
exact preview face instead of falling back to Arial. Preview renders text at
weight 700, so the bundled export faces are the static Bold instances:

- `Manrope-Bold.ttf` — Manrope Bold by Michael Sharanda
  (via https://github.com/expo/google-fonts, OFL)
- `Manrope-Variable.ttf` — Manrope variable (reference spare)
- `JetBrainsMono-Bold.ttf` — JetBrains Mono Bold by JetBrains
  (via https://github.com/JetBrains/JetBrainsMono, OFL)
- `JetBrainsMono-Variable.ttf` — JetBrains Mono variable (reference spare)

Source: https://github.com/google/fonts
(`ofl/manrope/Manrope[wght].ttf`, `ofl/jetbrainsmono/JetBrainsMono[wght].ttf`)

All are licensed under the SIL Open Font License 1.1, which allows
bundling in desktop apps. Keep this note and the upstream source links when
redistributing.
