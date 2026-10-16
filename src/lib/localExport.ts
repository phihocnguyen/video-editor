import type { ProjectDocument, RenderQualityPreset, RenderResolutionPreset } from "../domain";
import type { ExportJobStatus } from "./tauri";

const BASE = "http://127.0.0.1:1421";

export interface LocalExportHealth {
  ok: boolean;
  ffmpegFound: boolean;
  ffmpeg: string | null;
}

export async function localExportHealth(): Promise<LocalExportHealth> {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) return { ok: false, ffmpegFound: false, ffmpeg: null };
    const data = (await res.json()) as {
      ok?: boolean;
      ffmpegFound?: boolean;
      ffmpeg?: string;
    };
    return {
      ok: Boolean(data.ok),
      ffmpegFound: Boolean(data.ffmpegFound),
      ffmpeg: data.ffmpeg ?? null,
    };
  } catch {
    return { ok: false, ffmpegFound: false, ffmpeg: null };
  }
}

export async function localImportFile(file: File): Promise<{ path: string; name: string }> {
  const body = new FormData();
  body.append("file", file, file.name);
  const res = await fetch(`${BASE}/api/import`, { method: "POST", body });
  const data = (await res.json()) as { path?: string; name?: string; error?: string };
  if (!res.ok || !data.path) {
    throw new Error(data.error ?? "Local import failed — is `pnpm dev` running?");
  }
  return { path: data.path, name: data.name ?? file.name };
}

export async function localExtractAudio(
  path: string,
): Promise<{ hasAudio: boolean; path: string | null }> {
  const res = await fetch(`${BASE}/api/extract-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = (await res.json()) as {
    hasAudio?: boolean;
    path?: string | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Audio extract failed");
  return { hasAudio: Boolean(data.hasAudio), path: data.path ?? null };
}

export async function localStartExport(
  project: ProjectDocument,
  preset: RenderResolutionPreset,
  quality: RenderQualityPreset,
): Promise<ExportJobStatus> {
  const res = await fetch(`${BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project,
      preset,
      quality,
      outputName: project.name || "cutline-export",
    }),
  });
  const data = (await res.json()) as ExportJobStatus & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Local export failed");
  }
  return {
    id: data.id,
    state: data.state,
    progress: data.progress,
    message: data.message,
    outputPath: data.outputPath ?? null,
  };
}

export async function localGetExportStatus(id: string): Promise<
  ExportJobStatus & { downloadUrl?: string | null }
> {
  const res = await fetch(`${BASE}/api/export/${encodeURIComponent(id)}`);
  const data = (await res.json()) as ExportJobStatus & {
    error?: string;
    downloadUrl?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Status failed");
  }
  return {
    id: data.id,
    state: data.state,
    progress: data.progress,
    message: data.message,
    outputPath: data.outputPath ?? null,
    downloadUrl: data.downloadUrl ? `${BASE}${data.downloadUrl}` : null,
  };
}

export function localDownloadUrl(downloadUrl: string) {
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = "";
  a.click();
}
