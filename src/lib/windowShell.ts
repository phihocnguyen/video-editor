import { LogicalSize } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import type { AppScreen } from "../stores/appShellStore";
import { isTauriRuntime } from "./tauri";

/** Compact first-run onboarding window (logical px). */
export const ONBOARDING_WINDOW = {
  width: 420,
  height: 640,
  minWidth: 360,
  minHeight: 520,
} as const;

/** Home + editor workspace. */
export const WORKSPACE_WINDOW = {
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 620,
} as const;

/**
 * Fraction of the monitor work area the window may occupy.
 * Keeps taskbar/dock visible and avoids spilling off small laptop screens.
 */
const FIT_MARGIN_W = 0.96;
const FIT_MARGIN_H = 0.94;

async function workAreaLogical(): Promise<{ width: number; height: number } | null> {
  try {
    const monitor = (await currentMonitor()) ?? (await primaryMonitor());
    if (!monitor) return null;
    const logical = monitor.workArea.size.toLogical(monitor.scaleFactor);
    if (!Number.isFinite(logical.width) || !Number.isFinite(logical.height)) return null;
    return { width: logical.width, height: logical.height };
  } catch {
    return null;
  }
}

/** Clamp a desired window size so it fits inside the monitor work area. */
export function fitWindowToScreen(
  wantWidth: number,
  wantHeight: number,
  area: { width: number; height: number } | null,
): { width: number; height: number } {
  if (!area || area.width <= 0 || area.height <= 0) {
    return { width: Math.round(wantWidth), height: Math.round(wantHeight) };
  }
  return {
    width: Math.max(320, Math.min(wantWidth, Math.floor(area.width * FIT_MARGIN_W))),
    height: Math.max(240, Math.min(wantHeight, Math.floor(area.height * FIT_MARGIN_H))),
  };
}

/** Clamp a minimum window size so it never exceeds the (possibly fitted) size. */
export function fitMinSizeToWindow(
  minWidth: number,
  minHeight: number,
  size: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.max(320, Math.min(minWidth, size.width)),
    height: Math.max(240, Math.min(minHeight, size.height)),
  };
}

export async function applyWindowForScreen(screen: AppScreen): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const win = getCurrentWindow();
    if (screen === "onboarding") {
      const area = await workAreaLogical();
      const size = fitWindowToScreen(
        ONBOARDING_WINDOW.width,
        ONBOARDING_WINDOW.height,
        area,
      );
      const min = fitMinSizeToWindow(
        ONBOARDING_WINDOW.minWidth,
        ONBOARDING_WINDOW.minHeight,
        size,
      );
      await win.setMinSize(new LogicalSize(min.width, min.height));
      await win.setSize(new LogicalSize(size.width, size.height));
      await win.center();
      return;
    }
    const area = await workAreaLogical();
    const size = fitWindowToScreen(
      WORKSPACE_WINDOW.width,
      WORKSPACE_WINDOW.height,
      area,
    );
    const min = fitMinSizeToWindow(
      WORKSPACE_WINDOW.minWidth,
      WORKSPACE_WINDOW.minHeight,
      size,
    );
    await win.setMinSize(new LogicalSize(min.width, min.height));
    await win.setSize(new LogicalSize(size.width, size.height));
    await win.center();
  } catch {
    /* Browser / capability missing — ignore */
  }
}
