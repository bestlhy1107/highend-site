#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_RUNTIME_PATHS = ["data", "public/uploads"];
const DEFAULT_BACKUP_DIR = ".runtime-backups";
const DEFAULT_KEEP = 20;

function parseArgs(argv) {
  const result = new Map();

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const [key, ...valueParts] = arg.slice(2).split("=");
    result.set(key, valueParts.length ? valueParts.join("=") : "true");
  }

  return result;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

async function collectPathSummary(relativePath) {
  const absolutePath = resolve(PROJECT_ROOT, relativePath);

  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      exists: false,
      files: 0,
      bytes: 0,
    };
  }

  const entry = await stat(absolutePath);

  if (entry.isFile()) {
    return {
      path: relativePath,
      exists: true,
      files: 1,
      bytes: entry.size,
    };
  }

  let files = 0;
  let bytes = 0;

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const item of entries) {
      const itemPath = resolve(dir, item.name);

      if (item.isDirectory()) {
        await walk(itemPath);
        continue;
      }

      if (!item.isFile()) continue;

      const itemStat = await stat(itemPath);
      files += 1;
      bytes += itemStat.size;
    }
  }

  await walk(absolutePath);

  return {
    path: relativePath,
    exists: true,
    files,
    bytes,
  };
}

async function cleanupOldBackups(backupDir, keep) {
  const entries = await readdir(backupDir, { withFileTypes: true });
  const archives = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tar.gz")) continue;

    const archivePath = resolve(backupDir, entry.name);
    const archiveStat = await stat(archivePath);
    archives.push({
      archivePath,
      manifestPath: `${archivePath}.json`,
      mtimeMs: archiveStat.mtimeMs,
    });
  }

  archives.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of archives.slice(keep)) {
    await rm(item.archivePath, { force: true });
    await rm(item.manifestPath, { force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const reason = String(args.get("reason") || "manual");
const keep = Math.max(1, Number(args.get("keep") || process.env.RUNTIME_BACKUP_KEEP || DEFAULT_KEEP));
const backupDir = resolve(
  PROJECT_ROOT,
  String(args.get("dir") || process.env.RUNTIME_BACKUP_DIR || DEFAULT_BACKUP_DIR)
);
const runtimePaths = String(args.get("paths") || DEFAULT_RUNTIME_PATHS.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const existingRuntimePaths = runtimePaths.filter((item) => existsSync(resolve(PROJECT_ROOT, item)));

if (!existingRuntimePaths.length) {
  console.log("没有找到可备份的运行时目录。");
  process.exit(0);
}

await mkdir(backupDir, { recursive: true });

const safeReason = slugify(reason);
const archiveName = [
  "runtime-data",
  timestamp(),
  safeReason,
].filter(Boolean).join("-") + ".tar.gz";
const archivePath = resolve(backupDir, archiveName);

const tar = spawnSync("tar", ["-czf", archivePath, ...existingRuntimePaths], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
});

if (tar.status !== 0) {
  console.error("运行时数据备份失败。");
  process.exit(tar.status || 1);
}

const paths = await Promise.all(runtimePaths.map(collectPathSummary));
const manifest = {
  archive: basename(archivePath),
  archivePath,
  createdAt: new Date().toISOString(),
  reason,
  projectRoot: PROJECT_ROOT,
  runtimePaths,
  paths,
};

await writeFile(`${archivePath}.json`, JSON.stringify(manifest, null, 2), "utf8");
await cleanupOldBackups(backupDir, keep);

console.log(`运行时数据已备份：${archivePath}`);
