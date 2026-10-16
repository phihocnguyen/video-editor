// Point the marketing page at the newest GitHub Release installer.
// Writes .env.local (gitignored). If no release is reachable, the page
// keeps the fallback link in KlipCutLanding.tsx.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const STABLE_NAME = "KlipCut-windows-setup.exe";

function repoSlug() {
  const direct =
    process.env.GITHUB_REPOSITORY ||
    process.env.KLIPCUT_GITHUB_REPOSITORY ||
    "";
  if (direct.includes("/")) return direct;

  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  if (owner && slug) return `${owner}/${slug}`;

  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // No git remote in this environment.
  }
  return "";
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return "";
  const rounded = mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
  return `~ ${rounded} MB`;
}

const repo = repoSlug();
if (!repo) {
  console.log("No GitHub repo detected; marketing download stays on the fallback link.");
  process.exit(0);
}

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "klipcut-marketing",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

const response = await fetch(
  `https://api.github.com/repos/${repo}/releases/latest`,
  { headers },
);
if (!response.ok) {
  console.log(
    `Latest release for ${repo} is not available (${response.status}); marketing download stays on the fallback link.`,
  );
  process.exit(0);
}

const release = await response.json();
const assets = Array.isArray(release.assets) ? release.assets : [];
const versioned = assets.find(
  (asset) =>
    typeof asset.name === "string" &&
    /setup\.exe$/i.test(asset.name) &&
    asset.name !== STABLE_NAME,
);
const stable = assets.find((asset) => asset.name === STABLE_NAME);
const chosen = versioned || stable;
if (!chosen) {
  console.log(`Release ${release.tag_name} has no Windows installer.`);
  process.exit(0);
}

const version = String(release.tag_name || "").replace(/^v/, "") || "0.1.0";
const size = formatSize(chosen.size);
const downloadUrl = chosen.browser_download_url;
const fileName = chosen.name;

const lines = [
  `VITE_APP_VERSION=${version}`,
  `VITE_DOWNLOAD_URL=${downloadUrl}`,
  `VITE_DOWNLOAD_NAME=${fileName}`,
];
if (size) lines.push(`VITE_DOWNLOAD_SIZE=${size}`);
writeFileSync(".env.local", `${lines.join("\n")}\n`);
console.log(`Marketing download: ${fileName} (${version}) from ${repo}`);
