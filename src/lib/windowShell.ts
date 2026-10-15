import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  minWidth: 1024,
  minHeight: 700,
} as const;

export async function applyWindowForScreen(screen: AppScreen): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const win = getCurrentWindow();
    if (screen === "onboarding") {
      await win.setMinSize(
        new LogicalSize(ONBOARDING_WINDOW.minWidth, ONBOARDING_WINDOW.minHeight),
      );
      await win.setSize(
        new LogicalSize(ONBOARDING_WINDOW.width, ONBOARDING_WINDOW.height),
      );
      await win.center();
      return;
    }
    await win.setMinSize(
      new LogicalSize(WORKSPACE_WINDOW.minWidth, WORKSPACE_WINDOW.minHeight),
    );
    await win.setSize(
      new LogicalSize(WORKSPACE_WINDOW.width, WORKSPACE_WINDOW.height),
    );
    await win.center();
  } catch {
    /* Browser / capability missing — ignore */
  }
}
