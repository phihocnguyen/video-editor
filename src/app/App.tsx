import { useEffect } from "react";
import { EditorShell } from "../features/editor/EditorShell";
import { HomeScreen } from "../features/home/HomeScreen";
import { OnboardingScreen } from "../features/home/OnboardingScreen";
import { applyWindowForScreen } from "../lib/windowShell";
import { useAppShellStore } from "../stores/appShellStore";

export function App() {
  const screen = useAppShellStore((s) => s.screen);

  useEffect(() => {
    void applyWindowForScreen(screen);
  }, [screen]);

  if (screen === "onboarding") return <OnboardingScreen />;
  if (screen === "home") return <HomeScreen />;
  return <EditorShell />;
}
