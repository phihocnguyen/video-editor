/**
 * CLI export — no Tauri / MSVC required. Needs FFmpeg on PATH.
 *
 *   pnpm export:video -- path/to/project.cutline.json path/to/out.mp4
 *   pnpm export:video -- project.json out.mp4 --preset 720 --quality high
 *   pnpm export:video -- project.json out.mp4 --dry-run
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { buildFfmpegArgs } from "../src/domain/ffmpegArgs.ts";
import { buildRenderPlan } from "../src/domain/renderPlan.ts";
import { parseProjectJson } from "../src/domain/serialize.ts";
import type {
  RenderQualityPreset,
  RenderResolutionPreset,
} from "../src/domain/renderPlan.ts";
import { ffmpegMissingMessage, resolveFfmpegPath } from "./resolve-ffmpeg.ts";

function usage(): never {
  console.error(`Usage:
  pnpm export:video -- <project.json> <output.mp4> [--preset source|720|1080] [--quality draft|standard|high] [--dry-run]

Requires ffmpeg on PATH. Does not need Visual Studio or tauri:build.`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let preset: RenderResolutionPreset = "1080";
  let quality: RenderQualityPreset = "standard";
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--preset") {
      preset = argv[++i] as RenderResolutionPreset;
    } else if (arg === "--quality") {
      quality = argv[++i] as RenderQualityPreset;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 2) usage();
  return {
    projectPath: resolve(positional[0]),
    outputPath: resolve(positional[1]),
    preset,
    quality,
    dryRun,
  };
}

function runFfmpeg(program: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      reject(
        new Error(
          code === "ENOENT"
            ? ffmpegMissingMessage(program)
            : `Failed to start ${program} (${err.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

async function main() {
  const { projectPath, outputPath, preset, quality, dryRun } = parseArgs(
    process.argv.slice(2),
  );

  if (!existsSync(projectPath)) {
    throw new Error(`Project not found: ${projectPath}`);
  }

  const project = parseProjectJson(readFileSync(projectPath, "utf8"));
  const plan = buildRenderPlan(project, preset, quality);

  if (plan.clips.length === 0 && plan.texts.length === 0) {
    throw new Error("Project has no clips/text to export");
  }

  const ffmpeg = resolveFfmpegPath();
  if (ffmpeg === "ffmpeg" || !existsSync(ffmpeg)) {
    throw new Error(ffmpegMissingMessage(ffmpeg));
  }
  const built = buildFfmpegArgs(plan, outputPath, { fileExists: existsSync });
  console.log(
    `Export ${plan.width}x${plan.height} @ ${plan.frameRate}fps · ${plan.durationSec.toFixed(2)}s · ${plan.clips.length} media · ${plan.texts.length} text`,
  );
  console.log(`FFmpeg: ${ffmpeg}`);

  if (dryRun) {
    console.log(
      ffmpeg,
      built.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "),
    );
    return;
  }

  await runFfmpeg(ffmpeg, built.args);

  try {
    renameSync(built.tempOutput, outputPath);
  } catch {
    copyFileSync(built.tempOutput, outputPath);
    unlinkSync(built.tempOutput);
  }

  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
