/**
 * Local export helper for the browser client (no Tauri).
 * Serves import cache + FFmpeg export on http://127.0.0.1:1421
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import type { ProjectDocument } from "../src/domain/project.ts";
import type {
  RenderQualityPreset,
  RenderResolutionPreset,
} from "../src/domain/renderPlan.ts";
import {
  ffmpegMissingMessage,
  resolveFfmpegPath,
  probeHasAudioStream,
  sanitizePlanAudio,
} from "./resolve-ffmpeg.ts";

/** Fresh import each export so domain edits apply without restarting `pnpm dev`. */
async function loadExportModules() {
  const bust = `?t=${Date.now()}`;
  const [{ buildFfmpegArgs }, { buildRenderPlan }] = await Promise.all([
    import(`../src/domain/ffmpegArgs.ts${bust}`),
    import(`../src/domain/renderPlan.ts${bust}`),
  ]);
  return { buildFfmpegArgs, buildRenderPlan };
}

const PORT = Number(process.env.KLIPCUT_EXPORT_PORT ?? 1421);
const ROOT = resolve(process.cwd(), ".klipcut-cache");
const MEDIA = join(ROOT, "media");
const EXPORTS = join(ROOT, "exports");
const AUDIO = join(ROOT, "audio");

mkdirSync(MEDIA, { recursive: true });
mkdirSync(EXPORTS, { recursive: true });
mkdirSync(AUDIO, { recursive: true });

/** Only files written into the local cache may be streamed back to the browser. */
function cacheMediaFile(filePath: string): string | null {
  if (!filePath || filePath.startsWith("blob:")) return null;
  let real: string;
  let root: string;
  try {
    real = realpathSync(filePath);
    root = realpathSync(ROOT);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) return null;
  return real;
}

function mediaContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m4a":
    case ".aac":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

/** Stream a cache file, including byte ranges so the browser can seek a poster. */
function serveMediaFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const size = statSync(filePath).size;
  const type = mediaContentType(filePath);
  const range = req.headers.range;
  cors(res);
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    let end = match?.[2] ? Number(match[2]) : size - 1;
    if (!match || !Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  createReadStream(filePath).pipe(res);
}

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

async function handleExtractAudio(req: IncomingMessage, res: ServerResponse) {
  const raw = JSON.parse((await readBody(req)).toString("utf8")) as { path?: string };
  const source = raw.path ?? "";
  if (!source || source.startsWith("blob:") || !existsSync(source)) {
    sendJson(res, 400, { error: "Media path is not a local file" });
    return;
  }
  if (!probeHasAudioStream(source)) {
    sendJson(res, 200, { hasAudio: false, path: null });
    return;
  }
  const key = createHash("sha1").update(source).digest("hex").slice(0, 16);
  const dest = join(AUDIO, `${key}.m4a`);
  if (!existsSync(dest)) {
    const ffmpeg = resolveFfmpegPath();
    try {
      await runFfmpeg(ffmpeg, ["-y", "-i", source, "-vn", "-acodec", "copy", dest]);
    } catch {
      if (existsSync(dest)) unlinkSync(dest);
      await runFfmpeg(ffmpeg, [
        "-y",
        "-i",
        source,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        dest,
      ]);
    }
  }
  sendJson(res, 200, { hasAudio: true, path: dest });
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
  const { buildFfmpegArgs, buildRenderPlan } = await loadExportModules();
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
  const downloadName = `${(raw.outputName || project.name || "klipcut-export")
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
      const safePlan = sanitizePlanAudio(plan);
      const built = buildFfmpegArgs(safePlan, outputPath, { fileExists: existsSync });
      const textCount = safePlan.texts.length;
      job.message =
        textCount > 0
          ? `Rendering ${textCount} text overlay(s) with ${ffmpeg}…`
          : `Rendering with ${ffmpeg}…`;
      job.progress = 0.2;
      console.log(
        `[klipcut-export] job ${id}: ${safePlan.clips.length} clips, ${textCount} texts, ${safePlan.width}x${safePlan.height}`,
      );
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
    if (req.method === "GET" && url.pathname === "/api/media-ready") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/media-file") {
      const filePath = cacheMediaFile(url.searchParams.get("path") ?? "");
      if (!filePath) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      serveMediaFile(req, res, filePath);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/extract-audio") {
      await handleExtractAudio(req, res);
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
  console.log(`[klipcut-export] http://127.0.0.1:${PORT}`);
  console.log(`[klipcut-export] media cache: ${MEDIA}`);
  console.log(`[klipcut-export] exports: ${EXPORTS}`);
  console.log(
    found
      ? `[klipcut-export] ffmpeg: ${ffmpeg}`
      : `[klipcut-export] WARNING: ffmpeg not found — put tools/ffmpeg/bin/ffmpeg.exe or set FFMPEG_PATH`,
  );
});
