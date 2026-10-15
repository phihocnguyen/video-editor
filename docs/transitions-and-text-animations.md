# Video Transitions & Text Animations

Catalog animation khả thi cho Cutline, gắn với preview (CSS) và export (FFmpeg). Dựa trên hiện trạng codebase.

## Hiện trạng

### Video transitions

File: [`src/domain/transitions.ts`](../src/domain/transitions.ts)

| Type | Label | Preview | FFmpeg `xfade` |
|------|-------|---------|----------------|
| `none` | Cut | Hard cut | concat |
| `dissolve` | Dissolve | Crossfade opacity | `fade` |
| `fade` | Fade | Through black | `fadeblack` |
| `fadeWhite` | Fade White | Through white | `fadewhite` |

- Model: `Clip.transitionIn` (`type` + `durationTicks`)
- Preview: opacity only (`transitionOpacityPair` / `CompositeLayers`)
- Export: per-track `xfade` trong [`ffmpegArgs.ts`](../src/domain/ffmpegArgs.ts)
- Docs cũ (`phases.md`) từng ghi `wipeLeft` / `wipeRight` — **chưa có trong code**

### Text overlays

Files: [`src/domain/project.ts`](../src/domain/project.ts) (`TextStyle`), [`TextOverlayLayer.tsx`](../src/features/preview/TextOverlayLayer.tsx)

- Static: content, font, size, color, align, transform (position / opacity)
- **Không** có entrance / exit animation
- `Clip.effects.fadeInSec` / `fadeOutSec` có trên model nhưng **chưa gắn** cho text (preview + export)
- Export: FFmpeg `drawtext` (alpha tĩnh)
- Legacy key `animation` bị strip khi load (`validate.ts`)

---

## A. Video transitions — catalog

### A1. Đã có (giữ nguyên)

Nhóm UI: `cut`, `fade`.

| type | Hint |
|------|------|
| `none` | Hard cut |
| `dissolve` | Crossfade |
| `fade` | Through black |
| `fadeWhite` | Through white |

### A2. Phase 1 — Wipe + Slide (ưu tiên)

Nhóm UI mới: `wipe`, `slide`.

| type | Hint | Preview | xfade |
|------|------|---------|-------|
| `wipeLeft` | Curtain ← | `clip-path` / mask | `wipeleft` |
| `wipeRight` | Curtain → | `clip-path` / mask | `wiperight` |
| `wipeUp` | Curtain ↑ | `clip-path` / mask | `wipeup` |
| `wipeDown` | Curtain ↓ | `clip-path` / mask | `wipedown` |
| `slideLeft` | Push ← | dual-layer `translate` | `slideleft` |
| `slideRight` | Push → | dual-layer `translate` | `slideright` |
| `slideUp` | Push ↑ | dual-layer `translate` | `slideup` |
| `slideDown` | Push ↓ | dual-layer `translate` | `slidedown` |

### A3. Phase 2 — Shape / soft

| type | Hint | xfade |
|------|------|-------|
| `circleOpen` | Iris open | `circleopen` |
| `circleClose` | Iris close | `circleclose` |
| `radial` | Radial wipe | `radial` |
| `smoothLeft` | Soft wipe ← | `smoothleft` |
| `smoothRight` | Soft wipe → | `smoothright` |
| `hblur` | Blur dissolve | `hblur` |
| `pixelize` | Pixel dissolve | `pixelize` |

### A4. Ngoài scope gần

- 3D cube / flip, light leak, film burn, morph, glitch phức tạp
- Custom shader transitions

### Extension points (transitions)

| Layer | File / change |
|-------|----------------|
| Domain | Mở rộng `TransitionType`, `TRANSITION_DEFS`; `transitionPreviewVisual()` → `clipPath` / `translate` / `mask` |
| Preview | [`CompositeLayers.tsx`](../src/features/preview/CompositeLayers.tsx) — không chỉ opacity |
| Export | Map `xfade` trong [`ffmpegArgs.ts`](../src/domain/ffmpegArgs.ts) |
| UI | [`EffectThumb`](../src/features/effects/EffectThumb.tsx) keyframes + groups trong PropertiesPanel |

---

## B. Text effects — catalog

### Schema đề xuất

Field mới trên `TextStyle` (tránh tên `animation` bị strip, trừ khi bỏ strip trong `validate.ts`):

```ts
textAnimation: {
  in: TextAnimType;   // entrance
  out: TextAnimType;  // exit
  inDurationSec: number;
  outDurationSec: number;
}
```

### B0. Quick win

Wire `effects.fadeInSec` / `fadeOutSec` cho text:

- Preview: `fadeOpacityMultiplier` trong `TextOverlayLayer`
- Export: `drawtext` `alpha=` theo `t`

### B1. Phase 1 — Opacity / motion

| type | Hành vi | Preview | Export |
|------|---------|---------|--------|
| `none` | Static | — | static alpha |
| `fade` | Fade in / out | opacity theo local time | `drawtext` `alpha=` theo `t` |
| `slideUp` | Trượt lên vào / ra | `transform` + opacity | `y` expr theo `t` |
| `slideDown` | Trượt xuống | `transform` + opacity | `y` expr |
| `slideLeft` | Trượt trái | `transform` + opacity | `x` expr |
| `slideRight` | Trượt phải | `transform` + opacity | `x` expr |
| `scalePop` | Scale 0.8→1 + fade | CSS transform | hạn chế drawtext → fade nhẹ hoặc bake |

### B2. Phase 2 — Typography reveal

| type | Hành vi | Preview | Export |
|------|---------|---------|--------|
| `typewriter` | Hiện từng ký tự | substring theo progress | ASS / nhiều drawtext |
| `wordByWord` | Hiện từng từ | split words | ASS tốt hơn drawtext |
| `blurIn` | Blur → sharp + fade | CSS filter | ASS / pre-render |

### B3. Phase 3+

| type | Ghi chú |
|------|---------|
| `bounce` / `spring` | Preview dễ; export cần bake |
| `karaoke` | Phụ thuộc captions pipeline |
| Stroke grow, neon pulse, scramble | Thường cần canvas / ASS |

### Extension points (text)

| Layer | File / change |
|-------|----------------|
| Schema | `TextStyle.textAnimation` + normalize / validate |
| Preview | [`TextOverlayLayer.tsx`](../src/features/preview/TextOverlayLayer.tsx) — drive từ playhead local time |
| Export | `RenderTextPlan` + drawtext exprs; typewriter → ASS nếu cần |
| Inspector | Section “Text animation” khi `kind === "text"` |

---

## Lộ trình đề xuất

1. **Transitions A2** — 4 wipe + 4 slide: domain → preview → xfade → thumbs → tests
2. **Text B0** — gắn `fadeInSec` / `fadeOutSec` cho text
3. **Text B1** — schema `textAnimation` + fade / slide + inspector
4. **Transitions A3** / **Text B2** — theo nhu cầu product

### Quy tắc mỗi animation mới

- Preview ≈ export (parity)
- Thumb trong PresetGrid (transitions) hoặc inspector chips (text)
- Normalize / validate project load
- Unit test timing (progress window, duration clamp)
