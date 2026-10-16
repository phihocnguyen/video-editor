# Devlog

## 2026-10-16 — Detach A/V và keyframe opacity / transform

Phase 6 slice A–D đã có trong codebase. Phiên này hoàn tất hai hạng mục còn lại của Phase 6: tách soundtrack khỏi video, và keyframe tuyến tính cho opacity cùng transform. `PROJECT_SCHEMA_VERSION` giữ nguyên `1`. Các field mới là tùy chọn; project cũ vẫn mở được.

### Detach A/V

Soundtrack của video không còn đi cùng clip hình. Khi import hoặc mở project, ffprobe xác định audio stream. Có stream thì trích bằng `ffmpeg -vn -acodec copy` ra `.m4a`; stream copy thất bại thì encode AAC. Video gốc không bị encode lại.

- Browser: `POST /api/extract-audio` trên helper `:1421`, file nằm trong `.klipcut-cache/audio`.
- Desktop: lệnh Tauri `extract_audio_track`.
- Không có FFmpeg thì clip giữ playback audio nhúng như trước.

Model bổ sung `MediaAsset.extractedAudioAssetId`, `Clip.linkedClipId`, `Clip.linkLocked`, `Clip.suppressEmbeddedAudio`. `addMediaClip` với video đã trích soundtrack đặt clip audio liên kết trên track audio, cùng `startTicks` và cùng khoảng source.

Mặc định cặp không khóa: trim, split, move và delete chỉ áp dụng cho clip được chọn. `linkLocked` áp cùng delta thời gian, cùng điểm split, và xóa cả hai. Split khi không khóa giữ `linkedClipId` trên mảnh còn chồng timeline với partner; mảnh kia bỏ liên kết.

Preview mute phần tử video khi `suppressEmbeddedAudio`. Clip `kind === "audio"` vẫn phát qua `useTimelineAudio`. Export đặt `includeAudio` false trên video đã tách; soundtrack đi từ input audio riêng vào `amix`.

### Keyframe opacity và transform

Keyframe hiệu ứng màu và blur giữ nội suy hold. Opacity, vị trí, scale và rotation nằm ở `Clip.transformKeyframes`, nội suy tuyến tính theo progress timeline `0..1`.

Tham số: `opacity`, `x`, `y`, `scaleX`, `scaleY`, `rotation`. Trước keyframe đầu dùng `clip.transform`. Bật kim cương ghi giá trị đang resolve, không đưa tham số về mặc định. Trục đã có track dùng tọa độ canvas tuyệt đối; quy ước `0,0` là tâm khung không còn áp dụng cho trục đó. Split dùng `sliceTransformKeyframes`, lấy mẫu tại hai mép cắt giống effect keyframes.

Inspector có kim cương cho opacity, rotation, X, Y, scale X và scale Y. Tham số đã có track thì stepper và kéo trên canvas ghi keyframe tại playhead; tham số chưa có track vẫn ghi vào `clip.transform`. Preview đọc `transformAtProgress`. Opacity keyframe nhân với fade và transition. Timeline đánh dấu các điểm cùng chỗ với keyframe hiệu ứng.

Export không có track transform giữ `scale`, `rotate`, `pad` và `colorchannelmixer` tĩnh. Có track thì `scale` và `rotate` là biểu thức `eval=frame`; vị trí là offset `pad` theo thời gian trên full frame để `xfade` và `concat` giữ nguyên kích thước. Opacity dùng `geq` trên alpha vì `colorchannelmixer` không đánh giá theo frame. Text đưa position và opacity vào biểu thức `drawtext`; scale keyframe đổi `fontsize`. Blend mode vẫn tĩnh. Graph TypeScript và Rust được giữ cùng semantics. Bản desktop chưa được biên dịch trên máy này vì không có Rust toolchain.

### Còn mở

Phase 0–6 đã xong phần logic. Còn xác minh máy và đóng gói Windows (MSVC, `tauri:dev`, QA offline, NSIS), trình đồ thị đường cong keyframe, phụ đề SRT, color grading, proxy / GPU compositor, template, và đóng gói macOS / Linux. Chi tiết nằm trong `docs/phases.md`.
