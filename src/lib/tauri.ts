import { invoke } from "@tauri-apps/api/core";
import { toAppError, type AppError } from "./errors";

export interface AppInfo {
  name: string;
  version: string;
  offlineCapable: boolean;
}

export interface ProbeResult {
  path: string;
  available: boolean;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  message: string;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function probeMedia(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_media", { path });
}

export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: AppError | null }> {
  try {
    const data = await invoke<T>(command, args);
    return { data, error: null };
  } catch (error) {
    return { data: null, error: toAppError(error) };
  }
}
