/**
 * Local export helper for the browser client (no Tauri).
 * Serves import cache + FFmpeg export on http://127.0.0.1:1421
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { buildFfmpegArgs } from "../src/domain/ffmpegArgs.ts";
import type { ProjectDocument } from "../src/domain/project.ts";
import {
  buildRenderPlan,
  type RenderQualityPreset,
  type RenderResolutionPreset,
} from "../src/domain/renderPlan.ts";
import { ffmpegMissingMessage, resolveFfmpegPath } from "./resolve-ffmpeg.ts";

const PORT = Number(process.env.CUTLINE_EXPORT_PORT ?? 1421);
const ROOT = resolve(process.cwd(), ".cutline-cache");
const MEDIA = join(ROOT, "media");
const EXPORTS = join(ROOT, "exports");

mkdirSync(MEDIA, { recursive: true });
mkdirSync(EXPORTS, { recursive: true });

type Job = {
  id: string;
  state: "running" | "succeeded" | "failed";
  progress: number;
  message: string;
  outputPath: string | null;
  downloadName: string | null;
};

const jobs = new Map<string, Job>();

function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(
  buf: Buffer,
  boundary: string,
): { filename: string; data: Buffer } | null {
  const marker = Buffer.from(`--${boundary}`);
  let start = buf.indexOf(marker);
  while (start !== -1) {
    const next = buf.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = buf.subarray(start + marker.length, next);
    start = next;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.subarray(0, headerEnd).toString("utf8");
    if (!/name="file"/i.test(header)) continue;
    const nameMatch = /filename="([^"]+)"/i.exec(header);
    const filename = nameMatch?.[1] || "upload.bin";
    let data = part.subarray(headerEnd + 4);
    if (data.subarray(-2).toString() === "\r\n") data = data.subarray(0, -2);
    return { filename, data };
  }
  return null;
}

function runFfmpeg(program: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(new Error(ffmpegMissingMessage(program)));
        return;
      }
      reject(e);
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(err.slice(-800) || `ffmpeg exit ${code}`));
    });
  });
}

async function handleImport(req: IncomingMessage, res: ServerResponse) {
  const ctype = req.headers["content-type"] ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
  if (!m) {
    sendJson(res, 400, { error: "Expected multipart/form-data" });
    return;
  }
  const boundary = (m[1] || m[2] || "").trim();
  const buf = await readBody(req);
  const parsed = parseMultipart(buf, boundary);
  if (!parsed) {
    sendJson(res, 400, { error: "Missing file field" });
    return;
  }
  const safe = parsed.filename.replace(/[^\w.\-()+ ]+/g, "_");
  const dest = join(MEDIA, `${randomUUID()}-${safe}`);
  writeFileSync(dest, parsed.data);
  sendJson(res, 200, { path: dest, name: safe });
}

async function handleExport(req: IncomingMessage, res: ServerResponse) {
  const raw = JSON.parse((await readBody(req)).toString("utf8")) as {
    project: ProjectDocument;
    preset?: RenderResolutionPreset;
    quality?: RenderQualityPreset;
    outputName?: string;
  };
  const project = raw.project;
  const preset = raw.preset ?? "1080";
  const quality = raw.quality ?? "standard";
  const plan = buildRenderPlan(project, preset, quality);

  if (plan.missingAssetIds.length > 0) {
    sendJson(res, 400, { error: "Missing media in project" });
    return;
  }
  if (plan.clips.some((c) => c.assetPath.startsWith("blob:"))) {
    sendJson(res, 400, {
      error: "Blob media cannot export. Re-import while the export helper is running.",
    });
    return;
  }
  if (plan.clips.length === 0 && plan.texts.length === 0) {
    sendJson(res, 400, { error: "Nothing to export" });
    return;
  }

  const id = randomUUID();
  const downloadName = `${(raw.outputName || project.name || "cutline-export")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 64)}.mp4`;
  const outputPath = join(EXPORTS, `${id}-${downloadName}`);
  const job: Job = {
    id,
    state: "running",
    progress: 0.05,
    message: "Starting FFmpeg…",
    outputPath: null,
    downloadName,
  };
  jobs.set(id, job);
  sendJson(res, 200, {
    id,
    state: job.state,
    progress: job.progress,
    message: job.message,
    outputPath: null,
  });

  void (async () => {
    try {
      const ffmpeg = resolveFfmpegPath();
      const built = buildFfmpegArgs(plan, outputPath, { fileExists: existsSync });
      job.message = `Rendering with ${ffmpeg}…`;
      job.progress = 0.2;
      await runFfmpeg(ffmpeg, built.args);
      try {
        renameSync(built.tempOutput, outputPath);
      } catch {
        copyFileSync(built.tempOutput, outputPath);
        unlinkSync(built.tempOutput);
      }
      job.state = "succeeded";
      job.progress = 1;
      job.message = "Export complete";
      job.outputPath = outputPath;
    } catch (error) {
      job.state = "failed";
      job.message = error instanceof Error ? error.message : String(error);
      job.progress = 0;
    }
  })();
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const ffmpeg = resolveFfmpegPath();
      const ffmpegFound = ffmpeg !== "ffmpeg" && existsSync(ffmpeg);
      sendJson(res, 200, {
        ok: true,
        media: MEDIA,
        exports: EXPORTS,
        ffmpeg,
        ffmpegFound,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      await handleImport(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/export") {
      await handleExport(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/export/")) {
      const id = url.pathname.slice("/api/export/".length);
      const job = jobs.get(id);
      if (!job) {
        sendJson(res, 404, { error: "Unknown job" });
        return;
      }
      sendJson(res, 200, {
        id: job.id,
        state: job.state,
        progress: job.progress,
        message: job.message,
        outputPath: job.outputPath,
        downloadUrl:
          job.state === "succeeded" ? `/api/download/${encodeURIComponent(job.id)}` : null,
      });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/download/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/download/".length));
      const job = jobs.get(id);
      if (!job?.outputPath || !existsSync(job.outputPath)) {
        sendJson(res, 404, { error: "Not ready" });
        return;
      }
      cors(res);
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${job.downloadName ?? "export.mp4"}"`,
      });
      createReadStream(job.outputPath).pipe(res);
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const ffmpeg = resolveFfmpegPath();
  const found = ffmpeg !== "ffmpeg" && existsSync(ffmpeg);
  console.log(`[cutline-export] http://127.0.0.1:${PORT}`);
  console.log(`[cutline-export] media cache: ${MEDIA}`);
  console.log(`[cutline-export] exports: ${EXPORTS}`);
  console.log(
    found
      ? `[cutline-export] ffmpeg: ${ffmpeg}`
      : `[cutline-export] WARNING: ffmpeg not found — put tools/ffmpeg/bin/ffmpeg.exe or set FFMPEG_PATH`,
  );
});
