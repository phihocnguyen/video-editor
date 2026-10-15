import { create } from "zustand";

export type AppScreen = "onboarding" | "home" | "editor";

const ONBOARDING_KEY = "cutline.onboardingDone";
const HOME_TIP_KEY = "cutline.homeTipDismissed";

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* ignore quota */
  }
}

function initialScreen(): AppScreen {
  if (typeof window === "undefined") return "home";
  return readBool(ONBOARDING_KEY) ? "home" : "onboarding";
}

interface AppShellState {
  screen: AppScreen;
  onboardingDone: boolean;
  homeTipDismissed: boolean;
  setScreen: (screen: AppScreen) => void;
  completeOnboarding: () => void;
  dismissHomeTip: () => void;
  goHome: () => void;
  goEditor: () => void;
}

export const useAppShellStore = create<AppShellState>((set) => ({
  screen: initialScreen(),
  onboardingDone: typeof window !== "undefined" ? readBool(ONBOARDING_KEY) : false,
  homeTipDismissed: typeof window !== "undefined" ? readBool(HOME_TIP_KEY) : false,
  setScreen: (screen) => set({ screen }),
  completeOnboarding: () => {
    writeBool(ONBOARDING_KEY, true);
    set({ onboardingDone: true, screen: "home" });
  },
  dismissHomeTip: () => {
    writeBool(HOME_TIP_KEY, true);
    set({ homeTipDismissed: true });
  },
  goHome: () => set({ screen: "home" }),
  goEditor: () => set({ screen: "editor" }),
}));
