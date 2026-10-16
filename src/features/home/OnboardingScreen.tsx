import { useEffect, useState } from "react";
import { KlipCutLogo } from "@/components/KlipCutLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DiamondIcon,
  ExportIcon,
  LockIcon,
  MediaIcon,
  RampIcon,
  SlidersIcon,
  SplitIcon,
  UndoIcon,
} from "@/components/icons";
import { useAppShellStore } from "../../stores/appShellStore";

const STEPS = [
  {
    kicker: "Welcome",
    title: "Cut, arrange, export — on your PC",
    body: "KlipCut is a local-first video editor. Import footage from disk, cut it on a multi-track timeline, and export a finished MP4. No account, no cloud, no upload.",
    points: [
      { Icon: MediaIcon, label: "Import local media" },
      { Icon: SplitIcon, label: "Trim, split & arrange" },
      { Icon: ExportIcon, label: "Export MP4" },
    ],
  },
  {
    kicker: "Private by design",
    title: "Everything stays on this machine",
    body: "Drafts and imported media copies live in AppData on this PC. Work fully offline — originals stay untouched, and missing files can be relinked.",
    points: [
      { Icon: LockIcon, label: "Offline capable" },
      { Icon: UndoIcon, label: "Autosave + undo" },
      { Icon: MediaIcon, label: "Originals untouched" },
    ],
  },
  {
    kicker: "Edit like a pro",
    title: "Tracks, transitions & speed ramps",
    body: "Layer video, images and titles. Blend clips with transitions, grade with effects and keyframes, and bend time with speed-ramp curves — preview and export stay in sync.",
    points: [
      { Icon: DiamondIcon, label: "Transitions" },
      { Icon: SlidersIcon, label: "Effects + keyframes" },
      { Icon: RampIcon, label: "Speed ramps" },
    ],
  },
] as const;

export function OnboardingScreen() {
  const completeOnboarding = useAppShellStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const last = step >= STEPS.length - 1;

  const next = () => {
    if (last) completeOnboarding();
    else setStep((s) => s + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else if (e.key === "Escape") completeOnboarding();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className={cn(
        "relative grid h-full w-full place-items-center overflow-auto px-6 py-10",
        "bg-[radial-gradient(ellipse_70%_45%_at_50%_0%,rgba(62,166,255,0.12),transparent_60%),var(--bg-app)]",
      )}
    >
      <div className="grid w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Brand panel — product mock, accent blue only */}
        <div className="relative hidden flex-col justify-between gap-8 overflow-hidden bg-[linear-gradient(160deg,rgba(62,166,255,0.16),rgba(62,166,255,0.03)_55%,transparent),var(--bg-rail)] p-7 md:flex">
          <div className="flex items-center gap-2.5">
            <KlipCutLogo className="size-9" />
            <span className="text-sm font-extrabold tracking-[0.18em] text-foreground uppercase">
              KlipCut
            </span>
          </div>

          <div aria-hidden className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <div className="h-8 flex-1 rounded-md bg-[var(--track-video-bg)]" />
              <div className="h-8 w-1/3 rounded-md bg-[var(--track-video-bg)] opacity-70" />
            </div>
            <div className="flex items-center gap-2 pl-4">
              <div className="h-6 w-2/3 rounded-md bg-[var(--track-audio-bg)]" />
              <div className="h-6 flex-1 rounded-md bg-[var(--track-audio-bg)] opacity-70" />
            </div>
            <div className="flex items-center gap-2 pl-8">
              <div className="h-5 w-1/2 rounded-md bg-[var(--track-text-bg)]" />
            </div>
            <div className="mt-1 h-px w-full bg-primary/40" />
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Local projects · MP4 export · Works offline
          </p>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-col p-7 sm:p-8">
          <div className="mb-6 flex items-center gap-3 md:hidden">
            <KlipCutLogo className="size-9" />
            <span className="text-sm font-extrabold tracking-[0.18em] text-foreground uppercase">
              KlipCut
            </span>
          </div>

          <p className="mb-2 text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
            {current.kicker} · {step + 1} of {STEPS.length}
          </p>
          <h1
            key={step}
            className="mb-3 text-2xl font-bold tracking-tight text-foreground animate-in fade-in slide-in-from-right-2 duration-200"
          >
            {current.title}
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
            {current.body}
          </p>

          <ul className="mb-8 flex flex-col gap-2">
            {current.points.map(({ Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  <Icon size={14} />
                </span>
                {label}
              </li>
            ))}
          </ul>

          <div className="mb-6 flex gap-2" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === step ? "w-6 bg-primary" : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>

          <div className="mt-auto flex items-center justify-between gap-3">
            <div className="flex gap-1">
              <Button variant="ghost" onClick={completeOnboarding}>
                Skip
              </Button>
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                  Back
                </Button>
              ) : null}
            </div>
            <Button size="lg" onClick={next}>
              {last ? "Get started" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
